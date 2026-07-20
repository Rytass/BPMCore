#!/usr/bin/env node
/**
 * Control-channel CLI for the BPMCore dev supervisor (scripts/dev-supervisor.mts).
 *
 * Lets another local process — in particular a Claude Code agent — query
 * status, tail logs, and request a service restart over the supervisor's Unix
 * domain socket, without touching the interactive keyboard the human uses.
 *
 * Exit code contract (agents rely on this, keep it exact):
 *   0 = command succeeded (restart: service confirmed ready)
 *   1 = command ran but the result failed (restart: crashed again / timed out)
 *   2 = usage error (unknown command, unknown service name)
 *   3 = supervisor is not running (socket missing, or a stale socket file with
 *       nobody listening) — caller should tell the user to run `pnpm dev`,
 *       not retry or start it themselves.
 */

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createConnection } from 'node:net';
import type { Socket } from 'node:net';

type ServiceId = 'api' | 'client';
type ControlServiceState = 'running' | 'starting' | 'crashed' | 'stopped';
type Command = 'ping' | 'status' | 'restart' | 'logs';

interface ControlServiceStatus {
  readonly name: ServiceId;
  readonly state: ControlServiceState;
  readonly pid: number | null;
  readonly port: number | null;
  readonly uptimeMs: number | null;
  readonly lastExitCode: number | null;
}

// 'crashed': the service process is still alive (e.g. `next dev` keeps its
// port open even after a compile error) but its log output matched a known
// crash pattern — treat this the same as a real crash, not as "still
// starting". 'timeout' means neither a crash nor readiness was observed
// before the deadline (slow compile, or the service never opened its port)
// — read logTail to tell which.
type RestartFailureReason = 'exited' | 'timeout' | 'crashed';

// 'high': confirmed via a port TCP-probe or the service's own readyPattern
// banner in its log — both are positive signals the app code actually ran.
// 'low': fell back to "process survived N ms without exiting", which is NOT
// a functional-readiness guarantee — treat an `ok: true` with 'low'
// confidence as "probably fine, but re-check status/logs before relying on
// it." (Neither current service — api, client — falls back to 'low'; both
// declare a port, so this only matters if a port-less service is added
// later.)
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

interface ControlResponseOk {
  readonly ok: true;
  // ping
  readonly pid?: number;
  readonly project?: string;
  // status
  readonly services?: readonly ControlServiceStatus[];
  // logs
  readonly lines?: readonly string[];
  // restart
  readonly service?: ServiceId | 'all';
  readonly readyMs?: number;
  readonly readinessConfidence?: ReadinessConfidence;
  readonly logTail?: readonly string[];
  readonly results?: readonly RestartServiceResult[];
}

interface ControlResponseFail {
  readonly ok: false;
  readonly reason: string;
  readonly service?: ServiceId | 'all';
  readonly exitCode?: number | null;
  readonly logTail?: readonly string[];
  readonly results?: readonly RestartServiceResult[];
}

type ControlResponse = ControlResponseOk | ControlResponseFail;

const SERVICE_IDS: readonly ServiceId[] = ['api', 'client'];
const SOCKET_PATH = join(
  process.cwd(),
  'tmp',
  'dev-supervisor',
  'control.sock',
);
const DEFAULT_RESTART_TIMEOUT_MS = 60_000;
const DEFAULT_LOG_LINES = 40;
const SIMPLE_REQUEST_TIMEOUT_MS = 5_000;
const RESTART_TIMEOUT_BUFFER_MS = 15_000;

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isServiceId(value: string): value is ServiceId {
  return (SERVICE_IDS as readonly string[]).includes(value);
}

interface ParsedArgs {
  readonly command: Command | undefined;
  readonly service: string | undefined;
  readonly jsonOutput: boolean;
  readonly lines: number | undefined;
  readonly timeoutMs: number | undefined;
}

function parseArgs(argv: readonly string[]): ParsedArgs {
  const jsonOutput = argv.includes('--json');
  const linesIndex = argv.indexOf('--lines');
  const timeoutIndex = argv.indexOf('--timeout');
  const lines =
    linesIndex === -1 ? undefined : Number(argv[linesIndex + 1] ?? NaN);
  const timeoutMs =
    timeoutIndex === -1 ? undefined : Number(argv[timeoutIndex + 1] ?? NaN);

  const positional = argv.filter((arg, index): boolean => {
    if (arg.startsWith('--')) {
      return false;
    }
    if (linesIndex !== -1 && index === linesIndex + 1) {
      return false;
    }
    if (timeoutIndex !== -1 && index === timeoutIndex + 1) {
      return false;
    }
    return true;
  });

  const [rawCommand, rawService] = positional;
  const command: Command | undefined =
    rawCommand === 'ping' ||
    rawCommand === 'status' ||
    rawCommand === 'restart' ||
    rawCommand === 'logs'
      ? rawCommand
      : undefined;

  return {
    command,
    service: rawService,
    jsonOutput,
    lines: Number.isFinite(lines) ? lines : undefined,
    timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : undefined,
  };
}

function printUsageError(message: string): void {
  console.error(`usage error: ${message}`);
  console.error('');
  console.error('Usage:');
  console.error('  pnpm dev:ctl ping');
  console.error('  pnpm dev:ctl status [--json]');
  console.error(
    '  pnpm dev:ctl restart <api|client|all> [--timeout <ms>] [--json]',
  );
  console.error('  pnpm dev:ctl logs <api|client> [--lines <n>] [--json]');
}

function printNotRunningError(staleSocket: boolean): void {
  if (staleSocket) {
    console.error(
      'dev server 未啟動，請使用者執行 pnpm dev；不要自行啟動（殘留的 control socket 檔案已無人監聽，屬過期殘留）。',
    );
    return;
  }
  console.error('dev server 未啟動，請使用者執行 pnpm dev；不要自行啟動。');
}

interface ConnectSuccess {
  readonly kind: 'response';
  readonly response: ControlResponse;
}

interface ConnectFailure {
  readonly kind: 'connect-error';
  readonly code: 'not-running' | 'stale-socket' | 'other';
  readonly message: string;
}

async function sendControlRequest(
  request: Record<string, unknown>,
  socketTimeoutMs: number,
): Promise<ConnectSuccess | ConnectFailure> {
  return new Promise((resolve): void => {
    const socket: Socket = createConnection({ path: SOCKET_PATH });
    let settled = false;
    let buffer = '';

    const finish = (result: ConnectSuccess | ConnectFailure): void => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(socketTimeoutMs);
    socket.setEncoding('utf8');

    socket.on('connect', (): void => {
      socket.write(`${JSON.stringify(request)}\n`);
    });

    socket.on('data', (chunk: string): void => {
      buffer += chunk;
      const newlineIndex = buffer.indexOf('\n');
      if (newlineIndex === -1) {
        return;
      }
      const line = buffer.slice(0, newlineIndex).trim();
      try {
        const response = JSON.parse(line) as ControlResponse;
        finish({ kind: 'response', response });
      } catch (error: unknown) {
        finish({
          kind: 'connect-error',
          code: 'other',
          message: `invalid response from supervisor: ${toErrorMessage(error)}`,
        });
      }
    });

    socket.on('timeout', (): void => {
      finish({
        kind: 'connect-error',
        code: 'other',
        message: 'timed out waiting for supervisor response',
      });
    });

    socket.on('error', (error: NodeJS.ErrnoException): void => {
      if (error.code === 'ENOENT') {
        finish({
          kind: 'connect-error',
          code: 'not-running',
          message: error.message,
        });
        return;
      }
      if (error.code === 'ECONNREFUSED') {
        finish({
          kind: 'connect-error',
          code: 'stale-socket',
          message: error.message,
        });
        return;
      }
      finish({
        kind: 'connect-error',
        code: 'other',
        message: toErrorMessage(error),
      });
    });
  });
}

function formatUptime(uptimeMs: number | null): string {
  if (uptimeMs === null) {
    return '-';
  }
  return `${Math.floor(uptimeMs / 1000)}s`;
}

function padColumn(value: string, width: number): string {
  return value.length >= width
    ? value
    : value + ' '.repeat(width - value.length);
}

function printStatusTable(services: readonly ControlServiceStatus[]): void {
  console.log(
    `${padColumn('NAME', 8)} ${padColumn('STATE', 9)} ${padColumn('PID', 8)} ${padColumn('PORT', 6)} ${padColumn('UPTIME', 9)} EXIT`,
  );
  for (const service of services) {
    console.log(
      `${padColumn(service.name, 8)} ${padColumn(service.state, 9)} ${padColumn(service.pid === null ? '-' : String(service.pid), 8)} ${padColumn(service.port === null ? '-' : String(service.port), 6)} ${padColumn(formatUptime(service.uptimeMs), 9)} ${service.lastExitCode === null ? '-' : String(service.lastExitCode)}`,
    );
  }
}

function printLogTail(logTail: readonly string[]): void {
  if (logTail.length === 0) {
    console.log('(no log lines available)');
    return;
  }
  console.log('-- log tail --');
  for (const line of logTail) {
    console.log(line);
  }
}

/**
 * Distinct human-readable phrasing per failure reason, so an agent (or a
 * human) doesn't have to infer meaning from a bare enum value: `exited` and
 * `crashed` both mean "this restart failed, don't retry blindly — read
 * logTail"; `timeout` specifically means neither a crash nor readiness was
 * observed, which usually points to a slow compile or a port that never
 * opened rather than an outright failure.
 */
function describeFailureReason(
  reason: string | undefined,
  exitCode: number | null | undefined,
): string {
  switch (reason) {
    case 'exited': {
      return `process exited${exitCode === undefined || exitCode === null ? '' : ` with code ${exitCode}`} — see logTail`;
    }
    case 'crashed': {
      return 'process is still running but its log matched a known crash pattern — see logTail';
    }
    case 'timeout': {
      return 'timed out waiting for readiness (neither crashed nor ready — could be a slow compile or a port that never opened) — see logTail';
    }
    default: {
      return reason ?? 'unknown';
    }
  }
}

/**
 * A 'low'-confidence ok:true means the response fell back to "the process
 * survived N ms without exiting" rather than a positive port/readyPattern
 * signal — print this loudly so a caller doesn't treat it as equivalent to
 * a normal successful restart.
 */
function printReadinessConfidenceWarning(
  confidence: ReadinessConfidence | undefined,
): void {
  if (confidence !== 'low') {
    return;
  }
  console.log(
    'WARN  readinessConfidence=low — this only confirms the process stayed alive, not that it finished starting; re-check status/logs before relying on it',
  );
}

function printRestartResult(result: RestartServiceResult): void {
  if (result.ok) {
    console.log(
      `OK    ${result.service.padEnd(7)} ready in ${result.readyMs ?? '?'}ms`,
    );
    printReadinessConfidenceWarning(result.readinessConfidence);
    return;
  }
  console.log(
    `FAIL  ${result.service.padEnd(7)} reason=${result.reason ?? 'unknown'} — ${describeFailureReason(result.reason, result.exitCode)}`,
  );
  printLogTail(result.logTail);
}

function determineExitCode(response: ControlResponse): number {
  if (response.ok) {
    return 0;
  }
  if (
    response.reason === 'unknown-service' ||
    response.reason === 'unknown-command'
  ) {
    return 2;
  }
  return 1;
}

function renderResponse(
  command: Command,
  response: ControlResponse,
  jsonOutput: boolean,
): number {
  if (jsonOutput) {
    console.log(JSON.stringify(response));
    return determineExitCode(response);
  }

  if (!response.ok) {
    console.error(
      `FAIL  reason=${response.reason} — ${describeFailureReason(response.reason, response.exitCode)}`,
    );
    if (response.logTail !== undefined) {
      printLogTail(response.logTail);
    }
    if (response.results !== undefined) {
      for (const result of response.results) {
        printRestartResult(result);
      }
    }
    return determineExitCode(response);
  }

  switch (command) {
    case 'ping': {
      console.log(
        `pong  supervisor pid=${response.pid ?? '?'}  project=${response.project ?? '?'}`,
      );
      return 0;
    }
    case 'status': {
      printStatusTable(response.services ?? []);
      return 0;
    }
    case 'logs': {
      printLogTail(response.lines ?? []);
      return 0;
    }
    case 'restart': {
      if (response.results !== undefined) {
        for (const result of response.results) {
          printRestartResult(result);
        }
        console.log(`OK    all services ready in ${response.readyMs ?? '?'}ms`);
        printReadinessConfidenceWarning(response.readinessConfidence);
        return 0;
      }
      console.log(
        `OK    ${response.service ?? '?'} ready in ${response.readyMs ?? '?'}ms`,
      );
      printReadinessConfidenceWarning(response.readinessConfidence);
      return 0;
    }
    default: {
      return 0;
    }
  }
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const parsed = parseArgs(argv);

  if (parsed.command === undefined) {
    printUsageError(
      argv[0] === undefined ? 'missing command' : `unknown command: ${argv[0]}`,
    );
    return 2;
  }

  if (
    (parsed.command === 'restart' || parsed.command === 'logs') &&
    parsed.service === undefined
  ) {
    printUsageError(`${parsed.command} requires a service name`);
    return 2;
  }

  if (
    parsed.command === 'logs' &&
    parsed.service !== undefined &&
    !isServiceId(parsed.service)
  ) {
    printUsageError(
      `unknown service: ${parsed.service} (expected api|client)`,
    );
    return 2;
  }

  if (
    parsed.command === 'restart' &&
    parsed.service !== undefined &&
    parsed.service !== 'all' &&
    !isServiceId(parsed.service)
  ) {
    printUsageError(
      `unknown service: ${parsed.service} (expected api|client|all)`,
    );
    return 2;
  }

  const clientPid = process.pid;
  let request: Record<string, unknown>;
  let socketTimeoutMs = SIMPLE_REQUEST_TIMEOUT_MS;

  switch (parsed.command) {
    case 'ping': {
      request = { cmd: 'ping', clientPid };
      break;
    }
    case 'status': {
      request = { cmd: 'status', clientPid };
      break;
    }
    case 'logs': {
      request = {
        cmd: 'logs',
        service: parsed.service,
        lines: parsed.lines ?? DEFAULT_LOG_LINES,
        clientPid,
      };
      break;
    }
    case 'restart': {
      const timeoutMs = parsed.timeoutMs ?? DEFAULT_RESTART_TIMEOUT_MS;
      request = {
        cmd: 'restart',
        service: parsed.service,
        timeoutMs,
        logLines: DEFAULT_LOG_LINES,
        clientPid,
      };
      socketTimeoutMs = timeoutMs + RESTART_TIMEOUT_BUFFER_MS;
      break;
    }
    default: {
      printUsageError(`unknown command: ${String(parsed.command)}`);
      return 2;
    }
  }

  const result = await sendControlRequest(request, socketTimeoutMs);

  if (result.kind === 'connect-error') {
    if (result.code === 'not-running') {
      printNotRunningError(false);
      return 3;
    }
    if (result.code === 'stale-socket') {
      printNotRunningError(existsSync(SOCKET_PATH));
      return 3;
    }
    console.error(`control channel error: ${result.message}`);
    return 1;
  }

  return renderResponse(parsed.command, result.response, parsed.jsonOutput);
}

main()
  .then((exitCode: number): void => {
    process.exit(exitCode);
  })
  .catch((error: unknown): void => {
    console.error(toErrorMessage(error));
    process.exit(1);
  });
