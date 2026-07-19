#!/usr/bin/env node
/**
 * Reclaims a dev stack left behind by an unclean `pnpm dev` exit (kill -9,
 * closed terminal, crash, machine sleep). Reads the pidfile the supervisor
 * writes at startup, group-kills the recorded process groups, and reclaims the
 * recorded ports. Safe to run anytime; a no-op when the stack exited cleanly.
 */
import { readFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

interface DevPidFile {
  readonly supervisor?: number;
  readonly ports?: readonly number[];
  readonly groups?: readonly number[];
}

const PID_FILE = join(process.cwd(), 'tmp', 'dev-supervisor', 'pids.json');

function isEsrch(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as { readonly code?: unknown }).code === 'ESRCH'
  );
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readPidFile(): DevPidFile | null {
  try {
    return JSON.parse(readFileSync(PID_FILE, 'utf8')) as DevPidFile;
  } catch {
    return null;
  }
}

function killGroup(pgid: number): void {
  if (process.platform === 'win32' || !Number.isInteger(pgid) || pgid <= 1) {
    return;
  }
  try {
    process.kill(-pgid, 'SIGKILL');
    console.log(`[dev:clean] killed process group ${pgid}`);
  } catch (error: unknown) {
    if (!isEsrch(error)) {
      console.log(`[dev:clean] could not kill group ${pgid}: ${toMessage(error)}`);
    }
  }
}

function reclaimPort(port: number): void {
  if (process.platform === 'win32') {
    return;
  }
  let pids: readonly number[] = [];
  try {
    pids = execFileSync('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .split('\n')
      .map((line): number => Number(line.trim()))
      .filter(
        (pid): boolean =>
          Number.isInteger(pid) && pid > 1 && pid !== process.pid,
      );
  } catch {
    pids = [];
  }
  for (const pid of pids) {
    try {
      process.kill(pid, 'SIGKILL');
      console.log(`[dev:clean] reclaimed port ${port} from pid ${pid}`);
    } catch (error: unknown) {
      if (!isEsrch(error)) {
        console.log(
          `[dev:clean] could not reclaim port ${port} (pid ${pid}): ${toMessage(error)}`,
        );
      }
    }
  }
}

function main(): void {
  const pidFile = readPidFile();

  if (pidFile === null) {
    console.log('[dev:clean] no pidfile found; nothing recorded to clean.');
    return;
  }

  for (const group of pidFile.groups ?? []) {
    killGroup(group);
  }

  for (const port of pidFile.ports ?? []) {
    reclaimPort(port);
  }

  rmSync(PID_FILE, { force: true });
  console.log('[dev:clean] done.');
}

main();
