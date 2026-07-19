#!/usr/bin/env node
/**
 * BPMCore local dev supervisor.
 *
 * Runs the dev stack under one parent process, keeps per-service logs, and
 * makes service exits visible without requiring a tmux session.
 */

import { createWriteStream, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import type { WriteStream } from 'node:fs';

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
}

interface ServiceRuntime {
  readonly definition: ServiceDefinition;
  readonly logStream: WriteStream;
  process: ChildProcess | null;
  status: ServiceStatus;
  exitCode: number | null;
  restartCount: number;
  stopping: boolean;
  healthTimer: NodeJS.Timeout | null;
  logRemainder: string;
}

interface CliOptions {
  readonly autoRestart: AutoRestartMode;
  readonly dryRun: boolean;
  readonly help: boolean;
  readonly skipPrebuild: boolean;
}

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
      logStream: createWriteStream(join(LOG_ROOT, `${definition.id}.log`), {
        flags: 'a',
      }),
      process: null,
      status: 'idle',
      exitCode: null,
      restartCount: 0,
      stopping: false,
      healthTimer: null,
      logRemainder: '',
    },
  ]),
);

printBanner();
setupSignals();

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
  runtime.logStream.write(text);

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
    runtime.logStream.end();
  }

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
