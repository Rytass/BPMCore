#!/usr/bin/env node
/**
 * BPMCore local dev supervisor.
 *
 * Runs the dev stack under one parent process, keeps per-service logs, and
 * makes service exits visible without requiring a tmux session.
 */

import {
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  unlinkSync,
  chmodSync,
  readFileSync,
  appendFileSync,
  statSync,
  openSync,
  readSync,
  writeSync,
  closeSync,
} from 'node:fs';
import { join } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { createServer, connect } from 'node:net';
import type { ChildProcess } from 'node:child_process';
import type { Server, Socket } from 'node:net';

type ServiceId = 'api' | 'client';

type ServiceKind = 'http' | 'worker';
type ServiceStatus =
  | 'idle'
  | 'starting'
  | 'ready'
  | 'running'
  | 'exited'
  | 'restarting'
  | 'stopping';
type AutoRestartMode = 'off' | 'workers' | 'all';

interface ServiceDefinition {
  readonly id: ServiceId;
  readonly label: string;
  readonly command: readonly string[];
  readonly kind: ServiceKind;
  readonly healthUrl: string | null;
  /** Human-facing URL printed in status output (clickable in most terminals). */
  readonly url: string | null;
  readonly restartKey: string;
  /**
   * Control-channel restart-readiness strategy, in priority order (see
   * waitForServiceReady): (1) a port derived from `url`/`healthUrl` is
   * TCP-probed if present; (2) otherwise, if `readyPattern` is set, readiness
   * is only declared once that pattern appears in the service's own new log
   * output; (3) otherwise `aliveThresholdMs` (default
   * CONTROL_WORKER_ALIVE_THRESHOLD_MS) is used as a last-resort "survived N ms
   * without exiting" fallback.
   *
   * Both current services (`api`, `client`) declare a port, so both always
   * take branch (1) and neither field below is exercised today — they exist
   * for a future port-less service (e.g. a queue worker). If one is added,
   * `readyPattern` must match a banner the service's OWN application code
   * prints once it has actually finished bootstrapping — never a build-tool
   * banner like webpack's "compiled successfully" or Next.js's "Ready in
   * Nms", both of which fire before/independent of the app code's own crash
   * window (see CRASH_PATTERNS below for why `client`'s Turbopack compile
   * banner specifically cannot be trusted as a readiness signal either).
   */
  readonly readyPattern?: RegExp;
  /**
   * Last-resort readiness fallback, used only when neither a port nor a
   * readyPattern is configured. Provides no functional-readiness guarantee:
   * responses using this path report `readinessConfidence: 'low'`.
   */
  readonly aliveThresholdMs?: number;
}

interface ServiceRuntime {
  readonly definition: ServiceDefinition;
  /** Raw fd for the service's log file (see appendToServiceLog / rotateServiceLog). */
  logFd: number;
  /**
   * Bytes written to the log since the last size check. Used to throttle how
   * often we statSync the log file (see LOG_SIZE_CHECK_INTERVAL_BYTES) —
   * checking on every write would mean a statSync syscall per stdout chunk,
   * which is wasteful for chatty dev processes.
   */
  logBytesWritten: number;
  /**
   * Bumped every time rotateServiceLog() rewrites the log file. LogTailReader
   * instances pin this at creation time and compare on each read so a
   * rotation mid-restart-wait is detected even if the reader's cursor
   * happens to still be numerically below the post-rotation file size (see
   * resyncReaderIfRotated).
   */
  logGeneration: number;
  process: ChildProcess | null;
  status: ServiceStatus;
  exitCode: number | null;
  restartCount: number;
  stopping: boolean;
  healthTimer: NodeJS.Timeout | null;
  logRemainder: string;
  startedAt: number | null;
}

// --- Control channel (Unix domain socket) types -----------------------------
//
// Lets other local processes (in particular a Claude Code agent editing this
// repo) query status and request restarts without touching the interactive
// keyboard. See scripts/dev-ctl.mts for the CLI client.

type ControlServiceState = 'running' | 'starting' | 'crashed' | 'stopped';

interface ControlServiceStatus {
  readonly name: ServiceId;
  readonly state: ControlServiceState;
  readonly pid: number | null;
  readonly port: number | null;
  readonly uptimeMs: number | null;
  readonly lastExitCode: number | null;
}

interface ControlRequestBase {
  readonly clientPid?: number;
}

type ControlRequest = ControlRequestBase &
  (
    | { readonly cmd: 'ping' }
    | { readonly cmd: 'status' }
    | {
        readonly cmd: 'restart';
        readonly service: ServiceId | 'all';
        readonly timeoutMs?: number;
        readonly logLines?: number;
      }
    | {
        readonly cmd: 'logs';
        readonly service: ServiceId;
        readonly lines?: number;
      }
  );

interface PingResponse {
  readonly ok: true;
  readonly pid: number;
  readonly project: string;
}

interface StatusResponse {
  readonly ok: true;
  readonly services: readonly ControlServiceStatus[];
}

interface LogsResponse {
  readonly ok: true;
  readonly lines: readonly string[];
}

// 'crashed' is distinct from 'exited': the service process is still alive
// but its own log output matched a known failure pattern, so we stop waiting
// rather than block until the timeout. See CRASH_PATTERNS below.
type RestartFailureReason = 'exited' | 'timeout' | 'crashed';

// 'high': readiness was confirmed via a port TCP-probe or an
// application-printed readyPattern — both are positive signals that the
// service's own code actually ran. 'low': readiness fell back to
// aliveThresholdMs ("the process survived N ms without exiting"), which is
// not a functional-readiness guarantee. Callers should treat a 'low'
// confidence `ok: true` as "probably fine, but re-check status/logs if the
// next action depends on this service actually working."
type ReadinessConfidence = 'high' | 'low';

interface RestartServiceResult {
  readonly service: ServiceId;
  readonly ok: boolean;
  readonly reason?: RestartFailureReason;
  readonly exitCode?: number | null;
  readonly readyMs?: number;
  readonly readinessConfidence?: ReadinessConfidence;
  readonly logTail: readonly string[];
}

interface RestartSuccessResponse {
  readonly ok: true;
  readonly service: ServiceId | 'all';
  readonly readyMs: number;
  readonly readinessConfidence: ReadinessConfidence;
  readonly logTail: readonly string[];
  readonly results?: readonly RestartServiceResult[];
}

interface RestartFailureResponse {
  readonly ok: false;
  readonly service: ServiceId | 'all';
  readonly reason: RestartFailureReason;
  readonly exitCode: number | null;
  readonly logTail: readonly string[];
  readonly results?: readonly RestartServiceResult[];
}

interface ErrorResponse {
  readonly ok: false;
  readonly reason: string;
}

type ControlResponse =
  | PingResponse
  | StatusResponse
  | LogsResponse
  | RestartSuccessResponse
  | RestartFailureResponse
  | ErrorResponse;

interface CliOptions {
  readonly autoRestart: AutoRestartMode;
  readonly dryRun: boolean;
  readonly help: boolean;
  readonly skipPrebuild: boolean;
}

// Both services expose a `url`/`healthUrl` port, so both always resolve to
// the port-probe readiness strategy (see ServiceDefinition.readyPattern doc
// comment) — neither `readyPattern` nor `aliveThresholdMs` is set below.
const SERVICES: readonly ServiceDefinition[] = [
  {
    id: 'api',
    label: 'API',
    command: ['pnpm', 'api'],
    kind: 'http',
    healthUrl: 'http://localhost:17603/health',
    url: 'http://localhost:17603/graphql',
    restartKey: 'a',
  },
  {
    id: 'client',
    label: 'Client',
    command: ['pnpm', 'client'],
    kind: 'http',
    healthUrl: 'http://localhost:17602',
    url: 'http://localhost:17602',
    restartKey: 'c',
  },
];

function collectDevPorts(): readonly number[] {
  const ports = new Set<number>();
  for (const service of SERVICES) {
    for (const raw of [service.healthUrl, service.url]) {
      if (raw === null) {
        continue;
      }
      try {
        const parsed = Number(new URL(raw).port);
        if (Number.isInteger(parsed) && parsed > 0) {
          ports.add(parsed);
        }
      } catch {
        // Non-URL values are ignored.
      }
    }
  }
  return Array.from(ports).sort((a, b): number => a - b);
}

const DEV_PORTS = collectDevPorts();

function listListenerPids(port: number): readonly number[] {
  try {
    const out = execFileSync('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return out
      .split('\n')
      .map((line): number => Number(line.trim()))
      .filter((pid): boolean => Number.isInteger(pid) && pid > 1);
  } catch {
    // lsof exits non-zero when nothing is listening; treat as none.
    return [];
  }
}

function reclaimStalePorts(): void {
  if (process.platform === 'win32' || DEV_PORTS.length === 0) {
    return;
  }

  for (const port of DEV_PORTS) {
    const pids = listListenerPids(port).filter(
      (pid): boolean => pid !== process.pid,
    );
    for (const pid of pids) {
      try {
        process.kill(pid, 'SIGKILL');
        printSupervisorMessage(
          'supervisor',
          `reclaimed port ${port} from stale pid ${pid}`,
        );
      } catch (error: unknown) {
        if (!isProcessLookupError(error)) {
          printSupervisorMessage(
            'supervisor',
            `failed to reclaim port ${port} (pid ${pid}): ${toErrorMessage(error)}`,
          );
        }
      }
    }
  }
}

function updatePidFile(): void {
  const groups = Array.from(serviceRuntimes.values())
    .map((runtime): number | undefined => runtime.process?.pid)
    .filter((pid): pid is number => typeof pid === 'number');
  try {
    writeFileSync(
      PID_FILE,
      `${JSON.stringify({ supervisor: process.pid, ports: DEV_PORTS, groups }, null, 2)}\n`,
    );
  } catch {
    // Best-effort; dev:clean still falls back to port reclaim.
  }
}

function clearPidFile(): void {
  try {
    rmSync(PID_FILE, { force: true });
  } catch {
    // Best-effort.
  }
}

const ROOT = process.cwd();
const LOG_ROOT = join(ROOT, 'tmp', 'dev-supervisor');
const PID_FILE = join(LOG_ROOT, 'pids.json');
const HEALTH_INTERVAL_MS = 2_000;
const SHUTDOWN_TIMEOUT_MS = 5_000;
const AUTO_RESTART_DELAY_MS = 1_000;

// Log rotation. A single service log must never exceed LOG_MAX_BYTES; once it
// does, rotateServiceLog() rewrites the file keeping only the last
// LOG_KEEP_BYTES (crash output is almost always at the tail, so we discard
// the head, not the whole file). LOG_SIZE_CHECK_INTERVAL_BYTES throttles how
// often we actually statSync the file to check its size: we track bytes
// written in-memory per service and only stat once that counter crosses this
// threshold, rather than on every single write (see appendToServiceLog).
const LOG_MAX_BYTES = 1024 * 1024;
const LOG_KEEP_BYTES = 512 * 1024;
const LOG_SIZE_CHECK_INTERVAL_BYTES = 64 * 1024;

// Control channel (Unix domain socket) constants. Declared here (rather than
// alongside the control-channel functions further down) because
// setupControlServer() is invoked from the top-level init flow below, before
// the rest of the file's control-channel section would otherwise run.
const CONTROL_SOCKET_PATH = join(LOG_ROOT, 'control.sock');
const CONTROL_LOG_PATH = join(LOG_ROOT, 'control.log');
const CONTROL_SOCKET_PATH_MAX_BYTES = 100;
const CONTROL_DEFAULT_RESTART_TIMEOUT_MS = 60_000;
const CONTROL_DEFAULT_LOG_LINES = 40;
const CONTROL_POLL_INTERVAL_MS = 250;
const CONTROL_PORT_PROBE_TIMEOUT_MS = 300;
const CONTROL_WORKER_ALIVE_THRESHOLD_MS = 3_000;
// Sliding window (chars) kept in memory per restart wait to test crash
// patterns against, so a pattern split across two poll cycles' worth of
// stdout/stderr chunks still matches.
const CONTROL_CRASH_PATTERN_WINDOW_CHARS = 4_096;

// Log lines that mean "this restart attempt has failed" even though the
// service's process may still be alive. Calibrated against this project's
// actual dev tooling — both the real tmp/dev-supervisor/api.log /
// client.log from a `pnpm dev` run AND the installed source of the tools
// that produce them (node_modules), NOT copied from another project's
// supervisor:
//
// - `api` runs via Nx's @nx/js:node executor (webpack build -> run). The
//   real log confirms "NX Daemon is not running. Node process will not
//   restart automatically after file changes." — unlike a webpack-dev-server
//   watch loop, this project's api process does NOT auto-rebuild/restart
//   itself on file edits, so a watch-mode restart banner (e.g. "waiting for
//   changes to restart", used by some other projects' supervisors) would
//   never appear here. What CAN still fail on a control-channel restart is
//   the webpack build step that runs before Nest ever boots; the real log
//   shows the success banner "webpack compiled successfully (<hash>)" via
//   webpack's DefaultStatsPrinterPlugin
//   (node_modules/webpack/lib/stats/DefaultStatsPrinterPlugin.js), which
//   emits "compiled with ${red('N error(s)')}" on failure — the digit and
//   word are wrapped together in an ANSI color span (confirmed from that
//   source: `red(`${errorsCount} ${plural(...)}`)`). Log output is run
//   through stripAnsi() before either CRASH_PATTERNS entry is tested (see
//   matchesCrashPattern below), so the pattern itself can stay a plain,
//   readable match on the banner text instead of accounting for where the
//   escape sequences land. This exact failure text was not observed live (no
//   real build failure occurred during log capture), but both the banner
//   template and its ANSI wrapping are read from the installed webpack
//   source actually used by `apps/api`, not guessed.
// - `client` runs `next dev --turbopack`. Next.js keeps its HTTP port open
//   even after a compile error (the dev server serves an error overlay
//   instead of crashing), so the port-probe readiness strategy alone cannot
//   see a broken build — this pattern is the only signal for "server is up
//   but broken." Reading the installed Next.js source
//   (node_modules/next/dist/build/output/log.js) shows every error-level
//   log line — including Turbopack compile errors
//   (server/lib/router-utils/setup-dev-bundler.js's `logErrorWithOriginalStack`,
//   which is also what backs the `uncaughtException`/`unhandledRejection`
//   handlers installed by next-dev-server.js, and
//   server/dev/hot-reloader-turbopack.js's own compile-issue reporting) —
//   goes through the same `prefixedLog('error', ...)` helper, which always
//   prepends `red(bold('⨯'))` before the message. Same as the api pattern
//   above, stripAnsi() runs first, so matching the glyph alone needs no
//   extra ANSI handling here.
//   `/Failed to compile/` (an earlier draft of this pattern) was dropped:
//   grepping the installed `next` package found that exact string only in
//   the production `webpack-build` path, not in any file `next dev
//   --turbopack` actually exercises, so it would never have matched.
const CRASH_PATTERNS: readonly RegExp[] = [
  // apps/api: webpack-cli's failure banner, the counterpart to the
  // "webpack compiled successfully" banner seen in a real run's log. Tested
  // against ANSI-stripped text (see stripAnsi/matchesCrashPattern), so this
  // stays the plain banner text rather than accounting for escape sequences.
  /compiled with \d+ errors?/i,
  // apps/client: Next.js's universal error-level marker (glyph, not text),
  // used for both Turbopack compile errors and runtime
  // uncaughtException/unhandledRejection reporting — see comment above.
  /⨯/,
];

let controlServer: Server | null = null;

const options = parseCliOptions(process.argv.slice(2));

if (options.help) {
  printHelp();
  process.exit(0);
}

if (options.dryRun) {
  printDryRun();
  process.exit(0);
}

mkdirSync(LOG_ROOT, { recursive: true });

const serviceRuntimes = new Map<ServiceId, ServiceRuntime>(
  SERVICES.map((definition): readonly [ServiceId, ServiceRuntime] => [
    definition.id,
    {
      definition,
      // 'w' (not 'a') so each supervisor start clears the previous run's log
      // — logs from a killed/crashed prior session shouldn't accumulate
      // across restarts of the supervisor itself. Opened once and reused
      // (via sync writeSync calls, see appendToServiceLog) rather than a
      // WriteStream so that rotateServiceLog can safely close+reopen it
      // synchronously with no risk of losing buffered-but-unflushed writes.
      logFd: openSync(join(LOG_ROOT, `${definition.id}.log`), 'w'),
      logBytesWritten: 0,
      logGeneration: 0,
      process: null,
      status: 'idle',
      exitCode: null,
      restartCount: 0,
      stopping: false,
      healthTimer: null,
      logRemainder: '',
      startedAt: null,
    },
  ]),
);

printBanner();
setupSignals();
setupControlServer();
process.on('exit', (): void => {
  removeControlSocketFile();
});

void (async (): Promise<void> => {
  reclaimStalePorts();
  updatePidFile();

  if (!options.skipPrebuild) {
    await prebuildSharedLibs();
  }

  startAll();
  updatePidFile();
  setupInput();
})();

function parseCliOptions(args: readonly string[]): CliOptions {
  const autoArg = args.find((arg): boolean =>
    arg.startsWith('--auto-restart='),
  );
  const autoValue = autoArg?.split('=')[1];

  return {
    autoRestart:
      autoValue === 'all' || autoValue === 'workers' || autoValue === 'off'
        ? autoValue
        : args.includes('--auto') || args.includes('--auto-workers')
          ? 'workers'
          : 'off',
    dryRun: args.includes('--dry-run'),
    help: args.includes('--help') || args.includes('-h'),
    skipPrebuild: args.includes('--skip-prebuild'),
  };
}

function printHelp(): void {
  console.log(`Usage: pnpm dev [options]

Options:
  --auto, --auto-workers       Automatically restart worker processes only.
  --auto-restart=off|workers|all
                               Configure automatic restart behavior.
  --dry-run                    Print the managed services without starting them.
  --skip-prebuild              Skip the one-off shared-lib build before services start.
  -h, --help                   Show this help.

Interactive keys:
  a/c                          Restart API or client service.
  s                            Print status.
  R                            Restart every service.
  q                            Stop every service and exit.

Logs:
  tmp/dev-supervisor/<service>.log
`);
}

function printDryRun(): void {
  console.log('BPMCore dev supervisor dry run');
  console.log(`autoRestart: ${options.autoRestart}`);
  console.log(`logRoot: ${LOG_ROOT}`);
  console.log('');
  for (const service of SERVICES) {
    console.log(
      `${service.id.padEnd(19)} ${service.command.join(' ')}${service.url === null ? '' : ` url=${service.url}`}${service.healthUrl === null ? '' : ` health=${service.healthUrl}`}`,
    );
  }
}

function printBanner(): void {
  const urls = SERVICES.filter((service): boolean => service.url !== null).map(
    (service): string => `${service.id} ${service.url}`,
  );

  console.log('BPMCore dev supervisor');
  console.log(`autoRestart: ${options.autoRestart}`);
  console.log(`logs: ${LOG_ROOT}`);
  console.log(`urls: ${urls.join('  ')}`);
  console.log(
    'keys: [s] status  [R] restart all  [a/c] restart service  [q] quit',
  );
  console.log('');
}

/**
 * Builds every shared lib once before the services spawn. Each `nx serve`/
 * `nx dev` builds its lib dependency graph independently; with both apps
 * starting at once those concurrent builds race on the same dist outputs /
 * local cache and can intermittently fail. One warm-up pass makes every
 * later build a cache hit.
 */
async function prebuildSharedLibs(): Promise<void> {
  const appProjects = SERVICES.map((service): string => service.id);

  printSupervisorMessage(
    'supervisor',
    'prebuilding shared libs (one-off warm-up)',
  );

  const exitCode = await new Promise<number | null>((resolve): void => {
    const child = spawn(
      'pnpm',
      [
        'exec',
        'nx',
        'run-many',
        '-t',
        'build',
        '--all',
        `--exclude=${appProjects.join(',')}`,
      ],
      {
        cwd: ROOT,
        env: process.env,
        stdio: ['ignore', 'inherit', 'inherit'],
      },
    );

    child.on('error', (): void => resolve(null));
    child.on('exit', (code: number | null): void => resolve(code));
  });

  if (exitCode === 0) {
    printSupervisorMessage('supervisor', 'prebuild done, starting services');
    return;
  }

  printSupervisorMessage(
    'supervisor',
    `prebuild failed (exit=${exitCode === null ? 'spawn-error' : exitCode}); starting services anyway — individual serves will retry their own builds`,
  );
}

function startAll(): void {
  for (const runtime of serviceRuntimes.values()) {
    startService(runtime);
  }
}

function startService(runtime: ServiceRuntime): void {
  const [command, ...args] = runtime.definition.command;

  if (command === undefined) {
    throw new Error(`Missing command for ${runtime.definition.id}`);
  }

  runtime.stopping = false;
  runtime.exitCode = null;
  runtime.status = 'starting';
  printSupervisorMessage(
    runtime.definition.id,
    `starting: ${runtime.definition.command.join(' ')}`,
  );

  const childProcess = spawn(command, args, {
    cwd: ROOT,
    env: process.env,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  runtime.process = childProcess;
  runtime.startedAt = Date.now();
  updatePidFile();
  runtime.status =
    runtime.definition.kind === 'worker' ? 'running' : 'starting';

  childProcess.stdout?.on('data', (chunk: Buffer): void => {
    writeServiceLog(runtime, 'stdout', chunk);
  });

  childProcess.stderr?.on('data', (chunk: Buffer): void => {
    writeServiceLog(runtime, 'stderr', chunk);
  });

  childProcess.on('error', (error: Error): void => {
    runtime.status = 'exited';
    runtime.exitCode = null;
    printSupervisorMessage(
      runtime.definition.id,
      `failed to start: ${error.message}`,
    );
  });

  childProcess.on(
    'exit',
    (code: number | null, signal: NodeJS.Signals | null): void => {
      onServiceExit(runtime, code, signal);
    },
  );

  if (
    runtime.definition.kind === 'http' &&
    runtime.definition.healthUrl !== null
  ) {
    scheduleHealthCheck(runtime);
  }
}

function writeServiceLog(
  runtime: ServiceRuntime,
  streamName: 'stdout' | 'stderr',
  chunk: Buffer,
): void {
  const text = chunk.toString('utf8');
  appendToServiceLog(runtime, text);

  const combined = `${runtime.logRemainder}${text}`;
  const lines = combined.split(/\r?\n/);
  runtime.logRemainder = lines[lines.length - 1] ?? '';

  for (const line of lines.slice(0, -1)) {
    if (line.trim().length > 0) {
      console.log(
        `[${runtime.definition.id}] ${streamName === 'stderr' ? 'ERR ' : ''}${line}`,
      );
    }
  }
}

/**
 * Synchronously appends `text` to the service's log fd and enforces
 * LOG_MAX_BYTES. Uses writeSync (not a WriteStream) specifically so rotation
 * can close/rewrite/reopen the file with no pending buffered writes that
 * could be lost or interleaved — since Node is single-threaded and this
 * function only runs synchronously from a child process's 'data' handler,
 * there is no way for another write to interleave mid-rotation.
 *
 * Size is checked by accumulated bytes-written rather than on every call —
 * statSync on every chunk would be a syscall per stdout write, which adds up
 * for chatty dev processes; instead we only stat once LOG_SIZE_CHECK_INTERVAL_BYTES
 * worth of writes have accumulated since the last check.
 */
function appendToServiceLog(runtime: ServiceRuntime, text: string): void {
  const logPath = join(LOG_ROOT, `${runtime.definition.id}.log`);

  try {
    const written = writeSync(runtime.logFd, text);
    runtime.logBytesWritten += written;
  } catch (error: unknown) {
    printSupervisorMessage(
      runtime.definition.id,
      `failed to write log: ${toErrorMessage(error)}`,
    );
    return;
  }

  if (runtime.logBytesWritten < LOG_SIZE_CHECK_INTERVAL_BYTES) {
    return;
  }

  runtime.logBytesWritten = 0;

  let size: number;
  try {
    size = statSync(logPath).size;
  } catch {
    return;
  }

  if (size > LOG_MAX_BYTES) {
    rotateServiceLog(runtime, logPath);
  }
}

/**
 * Rewrites a service's log file in place, keeping only the last
 * LOG_KEEP_BYTES (crash output is almost always at the tail — discarding the
 * whole file would destroy exactly the evidence a crash investigation needs).
 * Entirely synchronous (openSync/readSync/writeSync/closeSync) and invoked
 * only from appendToServiceLog's synchronous call path, so there is no
 * window where a concurrent write from the child process's stdout handler
 * could interleave with the close -> read-tail -> truncate -> reopen
 * sequence below.
 *
 * Bumps runtime.logGeneration so any LogTailReader watching this service
 * detects the rotation on its next read (see resyncReaderIfRotated) instead
 * of silently reading stale/out-of-range offsets.
 */
function rotateServiceLog(runtime: ServiceRuntime, logPath: string): void {
  let tail = Buffer.alloc(0);

  try {
    const size = statSync(logPath).size;
    const start = Math.max(0, size - LOG_KEEP_BYTES);
    const length = size - start;

    if (length > 0) {
      const readFd = openSync(logPath, 'r');
      try {
        const buffer = Buffer.alloc(length);
        readSync(readFd, buffer, 0, length, start);
        tail = buffer;
      } finally {
        closeSync(readFd);
      }
    }
  } catch (error: unknown) {
    printSupervisorMessage(
      runtime.definition.id,
      `log rotation: failed to read tail, rotating to empty file: ${toErrorMessage(error)}`,
    );
  }

  try {
    closeSync(runtime.logFd);
  } catch {
    // Already closed / invalid fd; nothing to clean up before reopening.
  }

  try {
    const newFd = openSync(logPath, 'w');
    const marker = Buffer.from(
      `[supervisor] log rotated (kept last ${tail.length} bytes)\n`,
      'utf8',
    );
    writeSync(newFd, marker);
    if (tail.length > 0) {
      writeSync(newFd, tail);
    }
    runtime.logFd = newFd;
    runtime.logGeneration += 1;
    printSupervisorMessage(
      runtime.definition.id,
      `log exceeded ${LOG_MAX_BYTES} bytes; rotated, kept last ${tail.length} bytes`,
    );
  } catch (error: unknown) {
    // Rotation itself failed (disk full, permissions, ...). Fall back to
    // reopening the original path in append mode so subsequent writes don't
    // throw and take the whole supervisor down with them — the log will keep
    // growing unbounded until a future rotation attempt succeeds, but that is
    // strictly better than crashing the dev stack over a logging problem.
    printSupervisorMessage(
      runtime.definition.id,
      `log rotation failed, falling back to append mode: ${toErrorMessage(error)}`,
    );
    try {
      runtime.logFd = openSync(logPath, 'a');
    } catch (fallbackError: unknown) {
      printSupervisorMessage(
        runtime.definition.id,
        `log fallback reopen also failed; further log writes will be dropped: ${toErrorMessage(fallbackError)}`,
      );
    }
  }
}

function onServiceExit(
  runtime: ServiceRuntime,
  code: number | null,
  signal: NodeJS.Signals | null,
): void {
  clearHealthCheck(runtime);
  runtime.process = null;
  updatePidFile();
  runtime.exitCode = code;

  if (runtime.logRemainder.trim().length > 0) {
    console.log(`[${runtime.definition.id}] ${runtime.logRemainder}`);
    runtime.logRemainder = '';
  }

  if (runtime.stopping) {
    runtime.status = 'stopping';
    printSupervisorMessage(
      runtime.definition.id,
      `stopped${signal === null ? '' : ` by ${signal}`}`,
    );
    return;
  }

  runtime.status = 'exited';
  printSupervisorMessage(
    runtime.definition.id,
    `exited with ${code === null ? `signal ${signal ?? 'unknown'}` : `code ${code}`}`,
  );

  if (shouldAutoRestart(runtime.definition)) {
    runtime.status = 'restarting';
    runtime.restartCount += 1;
    printSupervisorMessage(
      runtime.definition.id,
      `auto restart #${runtime.restartCount} in ${AUTO_RESTART_DELAY_MS}ms`,
    );
    setTimeout((): void => startService(runtime), AUTO_RESTART_DELAY_MS);
    return;
  }

  printSupervisorMessage(
    runtime.definition.id,
    `press "${runtime.definition.restartKey}" to restart this service or "R" to restart all`,
  );
}

function shouldAutoRestart(definition: ServiceDefinition): boolean {
  return (
    options.autoRestart === 'all' ||
    (options.autoRestart === 'workers' && definition.kind === 'worker')
  );
}

function scheduleHealthCheck(runtime: ServiceRuntime): void {
  clearHealthCheck(runtime);

  const runCheck = async (): Promise<void> => {
    if (runtime.process === null || runtime.stopping) {
      return;
    }

    const healthUrl = runtime.definition.healthUrl;

    if (healthUrl === null) {
      return;
    }

    const healthy = await isHttpHealthy(healthUrl);

    if (!healthy) {
      // Still coming up; keep polling until the service answers once.
      if (runtime.status !== 'starting') {
        runtime.status = 'starting';
        printSupervisorMessage(
          runtime.definition.id,
          `waiting for ${healthUrl}`,
        );
      }
      return;
    }

    // The supervisor only needs the one-off starting -> ready transition.
    // Ongoing failures are handled by the process exit event (see
    // onServiceExit), not by HTTP polling — an unhealthy-but-alive probe never
    // triggered any action anyway. So announce readiness once and stop the
    // interval to keep dev logs quiet.
    if (runtime.status !== 'ready') {
      runtime.status = 'ready';
      printSupervisorMessage(
        runtime.definition.id,
        `ready: ${runtime.definition.url ?? healthUrl}`,
      );
    }

    clearHealthCheck(runtime);
  };

  runtime.healthTimer = setInterval((): void => {
    runCheck().catch((error: unknown): void => {
      printSupervisorMessage(
        runtime.definition.id,
        `health check error: ${toErrorMessage(error)}`,
      );
    });
  }, HEALTH_INTERVAL_MS);

  runCheck().catch((error: unknown): void => {
    printSupervisorMessage(
      runtime.definition.id,
      `health check error: ${toErrorMessage(error)}`,
    );
  });
}

async function isHttpHealthy(url: string): Promise<boolean> {
  const controller = new AbortController();
  const timeout = setTimeout((): void => controller.abort(), 1_000);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'manual',
    });

    return response.status >= 200 && response.status < 500;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

function clearHealthCheck(runtime: ServiceRuntime): void {
  if (runtime.healthTimer !== null) {
    clearInterval(runtime.healthTimer);
    runtime.healthTimer = null;
  }
}

function setupInput(): void {
  if (!process.stdin.isTTY) {
    return;
  }

  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (key: string): void => {
    handleKeypress(key).catch((error: unknown): void => {
      printSupervisorMessage('supervisor', toErrorMessage(error));
    });
  });
}

async function handleKeypress(key: string): Promise<void> {
  if (key === '' || key === 'q') {
    await shutdown(0);
    return;
  }

  if (key === 's') {
    printStatus();
    return;
  }

  if (key === 'R') {
    await restartAll();
    return;
  }

  const runtime = Array.from(serviceRuntimes.values()).find(
    (candidate): boolean => candidate.definition.restartKey === key,
  );

  if (runtime !== undefined) {
    await restartService(runtime);
  }
}

async function restartAll(): Promise<void> {
  printSupervisorMessage('supervisor', 'restarting all services');

  for (const runtime of serviceRuntimes.values()) {
    await stopService(runtime);
  }

  for (const runtime of serviceRuntimes.values()) {
    runtime.restartCount += 1;
    startService(runtime);
  }
}

async function restartService(runtime: ServiceRuntime): Promise<void> {
  printSupervisorMessage(runtime.definition.id, 'manual restart requested');
  await stopService(runtime);
  runtime.restartCount += 1;
  startService(runtime);
}

async function stopService(runtime: ServiceRuntime): Promise<void> {
  clearHealthCheck(runtime);

  const childProcess = runtime.process;

  if (childProcess === null) {
    runtime.status = 'idle';
    runtime.stopping = false;
    return;
  }

  runtime.stopping = true;
  runtime.status = 'stopping';

  await new Promise<void>((resolve): void => {
    const timeout = setTimeout((): void => {
      killChildProcess(childProcess, 'SIGKILL');
      resolve();
    }, SHUTDOWN_TIMEOUT_MS);

    childProcess.once('exit', (): void => {
      clearTimeout(timeout);
      resolve();
    });

    killChildProcess(childProcess, 'SIGTERM');
  });

  runtime.process = null;
  runtime.stopping = false;
}

function killChildProcess(
  childProcess: ChildProcess,
  signal: NodeJS.Signals,
): void {
  if (childProcess.pid === undefined) {
    return;
  }

  try {
    if (process.platform === 'win32') {
      childProcess.kill(signal);
      return;
    }

    process.kill(-childProcess.pid, signal);
  } catch (error: unknown) {
    if (isProcessLookupError(error)) {
      return;
    }

    printSupervisorMessage(
      'supervisor',
      `failed to send ${signal}: ${toErrorMessage(error)}`,
    );
  }
}

function isProcessLookupError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    typeof error.code === 'string' &&
    error.code === 'ESRCH'
  );
}

function printStatus(): void {
  console.log('');
  console.log('Service status');

  for (const runtime of serviceRuntimes.values()) {
    const pid =
      runtime.process?.pid === undefined ? '-' : String(runtime.process.pid);
    const exitCode = runtime.exitCode === null ? '-' : String(runtime.exitCode);
    const url =
      runtime.definition.url === null ? '' : `  ${runtime.definition.url}`;
    console.log(
      `${runtime.definition.id.padEnd(19)} ${runtime.status.padEnd(10)} pid=${pid.padEnd(7)} restarts=${runtime.restartCount} exit=${exitCode}${url}`,
    );
  }

  console.log('');
}

function setupSignals(): void {
  process.on('SIGINT', (): void => {
    shutdown(0).catch((error: unknown): void => {
      console.error(toErrorMessage(error));
      process.exit(1);
    });
  });

  process.on('SIGTERM', (): void => {
    shutdown(0).catch((error: unknown): void => {
      console.error(toErrorMessage(error));
      process.exit(1);
    });
  });
}

async function shutdown(exitCode: number): Promise<void> {
  printSupervisorMessage('supervisor', 'stopping services');

  if (process.stdin.isTTY) {
    process.stdin.setRawMode(false);
    process.stdin.pause();
  }

  for (const runtime of serviceRuntimes.values()) {
    await stopService(runtime);
    try {
      closeSync(runtime.logFd);
    } catch {
      // Best-effort; the process is exiting anyway.
    }
  }

  closeControlServer();
  clearPidFile();
  process.exit(exitCode);
}

function printSupervisorMessage(
  serviceId: ServiceId | 'supervisor',
  message: string,
): void {
  console.log(`[${serviceId}] ${message}`);
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// --- Control channel (Unix domain socket) -----------------------------------
//
// Newline-delimited JSON, one request per line, one response per line. See
// scripts/dev-ctl.mts for the CLI client and its exit-code contract.
// (Constants and `controlServer` are declared earlier, near LOG_ROOT, since
// setupControlServer() runs from the top-level init flow before this point.)

function getServicePort(definition: ServiceDefinition): number | null {
  const raw = definition.url ?? definition.healthUrl;

  if (raw === null) {
    return null;
  }

  try {
    const parsed = Number(new URL(raw).port);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  } catch {
    return null;
  }
}

async function probeTcp(
  host: string,
  port: number,
  timeoutMs: number,
): Promise<boolean> {
  return new Promise<boolean>((resolve): void => {
    const socket = connect({ host, port });
    const done = (ok: boolean): void => {
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', (): void => done(true));
    socket.once('timeout', (): void => done(false));
    socket.once('error', (): void => done(false));
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise<void>((resolve): void => {
    setTimeout(resolve, ms);
  });
}

function readLogTail(
  runtime: ServiceRuntime,
  lines: number,
): readonly string[] {
  const logPath = join(LOG_ROOT, `${runtime.definition.id}.log`);

  try {
    const content = readFileSync(logPath, 'utf8');
    const allLines = content
      .split(/\r?\n/)
      .filter((line): boolean => line.length > 0);
    return allLines.slice(-lines);
  } catch {
    return [];
  }
}

function getLogFileSize(runtime: ServiceRuntime): number {
  const logPath = join(LOG_ROOT, `${runtime.definition.id}.log`);
  try {
    return statSync(logPath).size;
  } catch {
    return 0;
  }
}

/** Reads exactly the bytes in [start, end) from a file via a synchronous fd. */
function readLogBytesSync(logPath: string, start: number, end: number): string {
  const length = end - start;

  if (length <= 0) {
    return '';
  }

  const fd = openSync(logPath, 'r');
  try {
    const buffer = Buffer.alloc(length);
    readSync(fd, buffer, 0, length, start);
    return buffer.toString('utf8');
  } finally {
    closeSync(fd);
  }
}

/**
 * Tracks how much of a service's log file has already been read during a
 * restart wait. `startOffset` pins the byte position at the moment this
 * restart began (so logTail never bleeds in output from a previous restart or
 * the pre-restart crash that prompted this one); `cursor` + `tailBuffer` are
 * the incremental read state used for crash-pattern matching so each poll
 * only reads the bytes appended since the last poll, not the whole file.
 * `generation` pins the service's logGeneration at creation time so a
 * rotation mid-wait (see rotateServiceLog) can be detected deterministically
 * — see resyncReaderIfRotated. Log files are now capped at LOG_MAX_BYTES by
 * rotation, so `startOffset`/`cursor` are no longer `readonly`:
 * resyncReaderIfRotated must be able to reset them back to 0 when the pinned
 * position is invalidated by a rotation.
 */
interface LogTailReader {
  startOffset: number;
  cursor: number;
  tailBuffer: string;
  generation: number;
}

function createLogTailReader(runtime: ServiceRuntime): LogTailReader {
  const offset = getLogFileSize(runtime);
  return {
    startOffset: offset,
    cursor: offset,
    tailBuffer: '',
    generation: runtime.logGeneration,
  };
}

/**
 * Detects whether the service's log file has been rotated (rotateServiceLog)
 * since `reader` last observed it, and if so resets the reader to the top of
 * the new file.
 *
 * This is the fix for a subtle but critical bug: rotation rewrites the log
 * file from scratch (bytes before the kept tail are discarded and every
 * remaining byte shifts to a new offset within the file), so a pinned
 * `cursor`/`startOffset` from before rotation cannot be trusted to still
 * point at the same content — even when it is still numerically *smaller*
 * than the post-rotation file size. A naive `currentSize < cursor` check (as
 * used defensively inside pollLogTailReader below) only catches the case
 * where the cursor happens to now exceed the new, smaller file; it silently
 * misses the case where the cursor was already below LOG_KEEP_BYTES and so
 * still looks "in range" after rotation, even though the bytes at that
 * offset are now completely different content. The logGeneration counter
 * (bumped once per rotateServiceLog call) is the only reliable signal, since
 * it is set precisely when — and only when — a rotation actually happened.
 *
 * On detection, the reader is resynced to offset 0 (the new file's start,
 * which begins with the rotation marker line written by rotateServiceLog)
 * and a `[supervisor] log rotated ...` line is appended to tailBuffer so a
 * caller reading logTail can tell "content was discarded by rotation" apart
 * from "the service produced no output" — otherwise crash detection could
 * silently go blind for the rest of this restart wait.
 */
function resyncReaderIfRotated(
  runtime: ServiceRuntime,
  reader: LogTailReader,
): void {
  if (reader.generation === runtime.logGeneration) {
    return;
  }

  reader.generation = runtime.logGeneration;
  reader.cursor = 0;
  reader.startOffset = 0;
  reader.tailBuffer = `${reader.tailBuffer}[supervisor] log rotated; earlier output in this window was discarded\n`;
}

/**
 * Reads any log bytes appended since the reader's cursor into its bounded
 * sliding window (used by both crash-pattern and readyPattern matching).
 * Cheap to call every poll tick: only newly appended bytes are read, not the
 * whole log file.
 */
function pollLogTailReader(
  runtime: ServiceRuntime,
  reader: LogTailReader,
): void {
  resyncReaderIfRotated(runtime, reader);

  const logPath = join(LOG_ROOT, `${runtime.definition.id}.log`);
  let size: number;

  try {
    size = statSync(logPath).size;
  } catch {
    return;
  }

  if (size < reader.cursor) {
    // Defensive fallback only — resyncReaderIfRotated above should already
    // have caught any rotation via the generation counter. This just avoids
    // a negative-length read if that invariant is ever violated.
    reader.cursor = size;
  }

  if (size <= reader.cursor) {
    return;
  }

  const newText = readLogBytesSync(logPath, reader.cursor, size);
  reader.cursor = size;
  reader.tailBuffer = `${reader.tailBuffer}${newText}`.slice(
    -CONTROL_CRASH_PATTERN_WINDOW_CHARS,
  );
}

/**
 * Strips ANSI color codes so CRASH_PATTERNS/readyPattern don't have to
 * account for escape sequences landing mid-phrase — e.g. webpack wraps the
 * error count in `compiled with ${red('N error(s)')}` (see CRASH_PATTERNS
 * comment above), so an unstripped literal match on "compiled with N
 * errors" would silently never fire once the count is actually colorized.
 */
function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex -- deliberately matching ANSI CSI codes.
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}

function matchesCrashPattern(text: string): boolean {
  return CRASH_PATTERNS.some((pattern): boolean => pattern.test(text));
}

/**
 * Same shape as readLogTail, but scoped to bytes appended after
 * `reader.startOffset` (a restart's pinned starting position) — never falls
 * back to pre-restart content, so a short new tail is returned as-is rather
 * than padded with stale lines.
 *
 * Takes the reader itself (not a raw offset) so it can independently run
 * resyncReaderIfRotated — this is normally already a no-op by the time this
 * is called (waitForServiceReady's poll loop calls pollLogTailReader every
 * tick, which already resyncs on rotation), but calling it here too closes
 * the gap for any future caller that reads a tail without having polled
 * first, so a rotation can never silently produce a stale/out-of-range read.
 */
function readLogTailSince(
  runtime: ServiceRuntime,
  reader: LogTailReader,
  lines: number,
): readonly string[] {
  resyncReaderIfRotated(runtime, reader);

  const logPath = join(LOG_ROOT, `${runtime.definition.id}.log`);
  let size: number;

  try {
    size = statSync(logPath).size;
  } catch {
    return [];
  }

  if (size <= reader.startOffset) {
    return [];
  }

  const text = readLogBytesSync(logPath, reader.startOffset, size);
  const allLines = text
    .split(/\r?\n/)
    .filter((line): boolean => line.length > 0);
  return allLines.slice(-lines);
}

function toControlState(runtime: ServiceRuntime): ControlServiceState {
  switch (runtime.status) {
    case 'ready':
    case 'running':
      return 'running';
    case 'starting':
    case 'restarting':
      return 'starting';
    case 'exited':
      return 'crashed';
    case 'idle':
    case 'stopping':
      return 'stopped';
    default:
      return 'stopped';
  }
}

function buildControlStatus(): readonly ControlServiceStatus[] {
  return SERVICES.map((definition): ControlServiceStatus => {
    const runtime = serviceRuntimes.get(definition.id);

    if (runtime === undefined) {
      throw new Error(`Missing runtime for ${definition.id}`);
    }

    return {
      name: definition.id,
      state: toControlState(runtime),
      pid: runtime.process?.pid ?? null,
      port: getServicePort(definition),
      uptimeMs:
        runtime.startedAt === null ? null : Date.now() - runtime.startedAt,
      lastExitCode: runtime.exitCode,
    };
  });
}

type ReadyOutcome =
  | {
      readonly ok: true;
      readonly readyMs: number;
      readonly readinessConfidence: ReadinessConfidence;
    }
  | {
      readonly ok: false;
      readonly reason: RestartFailureReason;
      readonly exitCode: number | null;
    };

/**
 * Waits for a just-restarted service to become ready. Three readiness
 * strategies, in strict priority order (see ServiceDefinition.readyPattern
 * doc comment for the full rationale) — a service never falls through to a
 * lower-priority strategy just because a higher one hasn't fired yet:
 *
 *   1. port (getServicePort !== null)   → TCP-probe it. readinessConfidence: 'high'.
 *   2. readyPattern (no port)           → wait for it in new log output.    'high'.
 *   3. aliveThresholdMs (neither above) → "survived N ms without exiting".  'low'.
 *
 * Both current services (`api`, `client`) declare a port and always take
 * branch 1; branches 2 and 3 exist for a future port-less service.
 *
 * The crash-pattern check runs on every poll tick *before* any of the three
 * strategies above and regardless of which one is active, so a crash is
 * caught even while still waiting on a port/pattern/threshold. It is a
 * mitigation, not a full guarantee: a hang or crash that never prints a
 * matching log line is still only caught by the timeout.
 */
async function waitForServiceReady(
  runtime: ServiceRuntime,
  timeoutMs: number,
  logReader: LogTailReader,
): Promise<ReadyOutcome> {
  const start = Date.now();
  const definition = runtime.definition;
  const port = getServicePort(definition);
  const readyPattern = definition.readyPattern ?? null;
  const aliveThresholdMs =
    definition.aliveThresholdMs ?? CONTROL_WORKER_ALIVE_THRESHOLD_MS;
  const deadline = start + timeoutMs;

  while (Date.now() < deadline) {
    if (runtime.status === 'exited') {
      return { ok: false, reason: 'exited', exitCode: runtime.exitCode };
    }

    pollLogTailReader(runtime, logReader);

    // Strip once per tick and reuse: crash-pattern and readyPattern matching
    // both test this same poll's log output (see stripAnsi doc comment).
    const strippedTail = stripAnsi(logReader.tailBuffer);

    if (matchesCrashPattern(strippedTail)) {
      return { ok: false, reason: 'crashed', exitCode: runtime.exitCode };
    }

    if (port !== null) {
      const up = await probeTcp(
        '127.0.0.1',
        port,
        CONTROL_PORT_PROBE_TIMEOUT_MS,
      );
      if (up) {
        return {
          ok: true,
          readyMs: Date.now() - start,
          readinessConfidence: 'high',
        };
      }
    } else if (readyPattern !== null) {
      if (readyPattern.test(strippedTail)) {
        return {
          ok: true,
          readyMs: Date.now() - start,
          readinessConfidence: 'high',
        };
      }
    } else if (
      runtime.process !== null &&
      runtime.startedAt !== null &&
      Date.now() - runtime.startedAt >= aliveThresholdMs
    ) {
      return {
        ok: true,
        readyMs: Date.now() - start,
        readinessConfidence: 'low',
      };
    }

    await sleep(CONTROL_POLL_INTERVAL_MS);
  }

  if (runtime.status === 'exited') {
    return { ok: false, reason: 'exited', exitCode: runtime.exitCode };
  }

  pollLogTailReader(runtime, logReader);

  if (matchesCrashPattern(stripAnsi(logReader.tailBuffer))) {
    return { ok: false, reason: 'crashed', exitCode: runtime.exitCode };
  }

  return { ok: false, reason: 'timeout', exitCode: null };
}

async function handleRestartCommand(
  serviceArg: ServiceId | 'all',
  timeoutMs: number,
  logLines: number,
): Promise<RestartSuccessResponse | RestartFailureResponse | ErrorResponse> {
  if (serviceArg === 'all') {
    const start = Date.now();

    // Capture each service's log-tail reader (and thus its startOffset)
    // *before* restartAll() stops/starts anything, so the eventual logTail
    // for each service covers exactly this restart's stop+start output and
    // never bleeds in whatever was in the log file beforehand.
    const logReaders = new Map<ServiceId, LogTailReader>(
      SERVICES.map((definition): readonly [ServiceId, LogTailReader] => {
        const runtime = serviceRuntimes.get(definition.id);
        return [
          definition.id,
          runtime === undefined
            ? { startOffset: 0, cursor: 0, tailBuffer: '', generation: 0 }
            : createLogTailReader(runtime),
        ];
      }),
    );

    await restartAll();

    const results = await Promise.all(
      SERVICES.map(async (definition): Promise<RestartServiceResult> => {
        const runtime = serviceRuntimes.get(definition.id);
        const logReader = logReaders.get(definition.id);

        if (runtime === undefined || logReader === undefined) {
          return {
            service: definition.id,
            ok: false,
            reason: 'timeout',
            exitCode: null,
            logTail: [],
          };
        }

        const outcome = await waitForServiceReady(
          runtime,
          timeoutMs,
          logReader,
        );
        const logTail = readLogTailSince(runtime, logReader, logLines);

        return outcome.ok
          ? {
              service: definition.id,
              ok: true,
              readyMs: outcome.readyMs,
              readinessConfidence: outcome.readinessConfidence,
              logTail,
            }
          : {
              service: definition.id,
              ok: false,
              reason: outcome.reason,
              exitCode: outcome.exitCode,
              logTail,
            };
      }),
    );

    const allOk = results.every((result): boolean => result.ok);
    const readyMs = Date.now() - start;
    const firstFailure = results.find((result): boolean => !result.ok);
    const combinedLogTail = (firstFailure ?? results[0])?.logTail ?? [];
    // Aggregate confidence: 'low' if any service's readiness fell back to
    // aliveThresholdMs, so a caller can't miss a weak signal buried inside an
    // otherwise-'high' batch.
    const aggregateConfidence: ReadinessConfidence = results.some(
      (result): boolean => result.readinessConfidence === 'low',
    )
      ? 'low'
      : 'high';

    if (allOk) {
      return {
        ok: true,
        service: 'all',
        readyMs,
        readinessConfidence: aggregateConfidence,
        logTail: combinedLogTail,
        results,
      };
    }

    return {
      ok: false,
      service: 'all',
      reason: firstFailure?.reason ?? 'timeout',
      exitCode: firstFailure?.exitCode ?? null,
      logTail: combinedLogTail,
      results,
    };
  }

  const runtime = serviceRuntimes.get(serviceArg);

  if (runtime === undefined) {
    return { ok: false, reason: 'unknown-service' };
  }

  // Capture the log-tail reader before restartService() so the "new content"
  // window covers the old process's shutdown output and the new process's
  // startup output, but nothing from before this restart began.
  const logReader = createLogTailReader(runtime);
  await restartService(runtime);
  const outcome = await waitForServiceReady(runtime, timeoutMs, logReader);
  const logTail = readLogTailSince(runtime, logReader, logLines);

  return outcome.ok
    ? {
        ok: true,
        service: serviceArg,
        readyMs: outcome.readyMs,
        readinessConfidence: outcome.readinessConfidence,
        logTail,
      }
    : {
        ok: false,
        service: serviceArg,
        reason: outcome.reason,
        exitCode: outcome.exitCode,
        logTail,
      };
}

function describeClientPid(request: ControlRequest): string {
  return request.clientPid === undefined
    ? 'unknown'
    : String(request.clientPid);
}

interface ControlLogEntry {
  readonly cmd: string;
  readonly service?: string;
  readonly ok: boolean;
  readonly reason?: string | undefined;
  readonly durationMs: number;
  readonly clientPid?: number | undefined;
}

/**
 * Persists a one-line audit trail of every control command to
 * tmp/dev-supervisor/control.log, independent of printSupervisorMessage
 * (which only reaches the supervisor's interactive stdout/scrollback). This
 * is the only place an agent's control-channel actions survive after the
 * terminal is closed.
 */
function appendControlLog(entry: ControlLogEntry): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry });
  try {
    appendFileSync(CONTROL_LOG_PATH, `${line}\n`);
  } catch {
    // Best-effort; the audit log is not on the critical path for restarts.
  }
}

async function handleControlLine(socket: Socket, line: string): Promise<void> {
  const receivedAt = Date.now();
  let request: ControlRequest;

  try {
    request = JSON.parse(line) as ControlRequest;
  } catch {
    writeControlResponse(socket, { ok: false, reason: 'invalid-json' });
    return;
  }

  const clientLabel = describeClientPid(request);

  switch (request.cmd) {
    case 'ping': {
      printSupervisorMessage(
        'supervisor',
        `control: ping (from pid ${clientLabel})`,
      );
      writeControlResponse(socket, {
        ok: true,
        pid: process.pid,
        project: 'BPMCore',
      });
      appendControlLog({
        cmd: 'ping',
        ok: true,
        durationMs: Date.now() - receivedAt,
        clientPid: request.clientPid,
      });
      return;
    }

    case 'status': {
      printSupervisorMessage(
        'supervisor',
        `control: status (from pid ${clientLabel})`,
      );
      writeControlResponse(socket, {
        ok: true,
        services: buildControlStatus(),
      });
      appendControlLog({
        cmd: 'status',
        ok: true,
        durationMs: Date.now() - receivedAt,
        clientPid: request.clientPid,
      });
      return;
    }

    case 'logs': {
      const runtime = serviceRuntimes.get(request.service);

      if (runtime === undefined) {
        writeControlResponse(socket, { ok: false, reason: 'unknown-service' });
        appendControlLog({
          cmd: 'logs',
          service: request.service,
          ok: false,
          reason: 'unknown-service',
          durationMs: Date.now() - receivedAt,
          clientPid: request.clientPid,
        });
        return;
      }

      const lines = request.lines ?? CONTROL_DEFAULT_LOG_LINES;
      printSupervisorMessage(
        'supervisor',
        `control: logs ${request.service} lines=${lines} (from pid ${clientLabel})`,
      );
      writeControlResponse(socket, {
        ok: true,
        lines: readLogTail(runtime, lines),
      });
      appendControlLog({
        cmd: 'logs',
        service: request.service,
        ok: true,
        durationMs: Date.now() - receivedAt,
        clientPid: request.clientPid,
      });
      return;
    }

    case 'restart': {
      if (
        request.service !== 'all' &&
        serviceRuntimes.get(request.service) === undefined
      ) {
        writeControlResponse(socket, { ok: false, reason: 'unknown-service' });
        appendControlLog({
          cmd: 'restart',
          service: request.service,
          ok: false,
          reason: 'unknown-service',
          durationMs: Date.now() - receivedAt,
          clientPid: request.clientPid,
        });
        return;
      }

      const timeoutMs = request.timeoutMs ?? CONTROL_DEFAULT_RESTART_TIMEOUT_MS;
      const logLines = request.logLines ?? CONTROL_DEFAULT_LOG_LINES;

      printSupervisorMessage(
        'supervisor',
        `control: restart ${request.service} (from pid ${clientLabel})`,
      );

      const response = await handleRestartCommand(
        request.service,
        timeoutMs,
        logLines,
      );
      writeControlResponse(socket, response);
      appendControlLog({
        cmd: 'restart',
        service: request.service,
        ok: response.ok,
        reason: response.ok ? undefined : response.reason,
        durationMs: Date.now() - receivedAt,
        clientPid: request.clientPid,
      });
      return;
    }

    default: {
      // Reached when the parsed JSON has a `cmd` value outside the known
      // union (request is typed `never` here since the switch is otherwise
      // exhaustive); recover the raw fields for logging via an unknown-cmd
      // view instead of the narrowed type.
      const unrecognized = request as unknown as {
        readonly cmd?: unknown;
        readonly clientPid?: number;
      };
      writeControlResponse(socket, { ok: false, reason: 'unknown-command' });
      appendControlLog({
        cmd: String(unrecognized.cmd),
        ok: false,
        reason: 'unknown-command',
        durationMs: Date.now() - receivedAt,
        clientPid: unrecognized.clientPid,
      });
    }
  }
}

function writeControlResponse(socket: Socket, response: ControlResponse): void {
  try {
    socket.write(`${JSON.stringify(response)}\n`);
  } catch {
    // Client may have disconnected already; nothing to recover.
  }
  socket.end();
}

function removeControlSocketFile(): void {
  try {
    if (existsSync(CONTROL_SOCKET_PATH)) {
      unlinkSync(CONTROL_SOCKET_PATH);
    }
  } catch {
    // Best-effort cleanup; a stale socket file is harmless on next start.
  }
}

function setupControlServer(): void {
  if (
    Buffer.byteLength(CONTROL_SOCKET_PATH, 'utf8') >
    CONTROL_SOCKET_PATH_MAX_BYTES
  ) {
    printSupervisorMessage(
      'supervisor',
      `control socket path too long (${CONTROL_SOCKET_PATH}); skipping control channel`,
    );
    return;
  }

  removeControlSocketFile();

  const server = createServer((socket: Socket): void => {
    let buffer = '';

    socket.setEncoding('utf8');

    socket.on('data', (chunk: string): void => {
      buffer += chunk;
      let newlineIndex = buffer.indexOf('\n');

      while (newlineIndex !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);

        if (line.length > 0) {
          handleControlLine(socket, line).catch((error: unknown): void => {
            writeControlResponse(socket, {
              ok: false,
              reason: toErrorMessage(error),
            });
          });
        }

        newlineIndex = buffer.indexOf('\n');
      }
    });

    socket.on('error', (): void => {
      // Client disconnects mid-request are expected; nothing to clean up.
    });
  });

  server.on('error', (error: unknown): void => {
    printSupervisorMessage(
      'supervisor',
      `control socket error: ${toErrorMessage(error)}`,
    );
  });

  server.listen(CONTROL_SOCKET_PATH, (): void => {
    try {
      chmodSync(CONTROL_SOCKET_PATH, 0o600);
    } catch (error: unknown) {
      printSupervisorMessage(
        'supervisor',
        `failed to chmod control socket: ${toErrorMessage(error)}`,
      );
    }
  });

  controlServer = server;
}

function closeControlServer(): void {
  if (controlServer !== null) {
    controlServer.close();
    controlServer = null;
  }
  removeControlSocketFile();
}
