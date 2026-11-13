// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Opt-in crash reports (P2-X5). On only when the privacy mirror says so, Local only is off, and a DSN is
 * present. The SDK starts before app ready; turning reporting on later waits for the next launch, and
 * turning it off drops the next envelope immediately. No process writes a native crash dump: crashes are
 * error events (a renderer gone, a utility's unexpected exit, a run of main that ended without quitting,
 * JavaScript errors), each one scrubbed.
 */
import { randomBytes } from 'node:crypto';
import { lstatSync, realpathSync, rmSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { crashesContract, implementContract } from '@taalcut/core';
import { installLogCapture, stderrTail } from '../debug/log-ring';
import { envelopeHeader, envelopeItem, postEnvelope, sentryUrls, type SentryUrls } from './envelope';
import { clearLastRun, lastRunPath, markRun, takeLastRun, type LastRun } from './last-run';
import { setCrashReportingLive, crashReportingLive } from './live';
import { privacyMirrorPath, readPrivacyMirror } from './privacy-mirror';
import { scrubCrashEvent, scrubStderrLine, type ScrubOptions } from './scrub-event';
import { environmentSecrets } from './scrub-sources';

const LIMIT = 10;
const WINDOW_MS = 60_000;

export interface BootCrashReportingOptions {
  readonly userData: string;
  readonly dsn: string;
  readonly version: string;
  readonly channel: string;
  readonly homeDir: string;
  /** Electron's crash dumps folder: removed at every start, since nothing may leave a dump there. */
  readonly crashesDirectory?: string;
  readonly secrets?: readonly string[];
  /** Main's environment: credential-named variables' values are scrubbed from every event. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** The account's user name and the Mac's host names (scrub-sources.ts machineNames). */
  readonly names?: readonly string[];
  readonly now?: () => number;
}

interface Session {
  urls?: SentryUrls;
  dsn: string;
  release: string;
  environment: string;
  homeDir: string;
  lastRunFile?: string;
  names: readonly string[];
  envSecrets: readonly string[];
  now: () => number;
}

let session: Session = {
  dsn: '',
  release: 'taalcut@0.0.0',
  environment: 'stable',
  homeDir: '',
  names: [],
  envSecrets: [],
  now: () => Date.now(),
};
let secrets: readonly string[] = [];
const recent: number[] = [];

/** The keychain's current values (desktop-feedback.ts refreshes them). */
export function setCrashSecrets(values: readonly string[]): void {
  secrets = values.filter((value) => value.length >= 8);
}

/** Off takes effect now, and this run is not reported at the next launch. On waits for the next launch. */
export function noteCrashReportingConsent(enabled: boolean): void {
  if (enabled) return;
  setCrashReportingLive(false);
  if (session.lastRunFile) clearLastRun(session.lastRunFile);
}

/** On quit: this run ended normally, so the next launch reports nothing for it. */
export function endCrashReportingRun(): void {
  if (session.lastRunFile) clearLastRun(session.lastRunFile);
}

export async function bootCrashReporting(options: BootCrashReportingOptions): Promise<void> {
  recent.length = 0;
  if (options.secrets) setCrashSecrets(options.secrets);
  installLogCapture();
  if (options.crashesDirectory) deleteCrashDumps(options.crashesDirectory, options.homeDir);
  const mirror = readPrivacyMirror(privacyMirrorPath(options.userData));
  const urls = sentryUrls(options.dsn);
  const on = mirror.crashReports && !mirror.localOnly && urls !== undefined;
  const lastRunFile = lastRunPath(options.userData);
  const previous = takeLastRun(lastRunFile);
  session = {
    dsn: options.dsn,
    urls,
    release: `taalcut@${options.version}`,
    environment: options.channel.length > 0 ? options.channel : 'stable',
    homeDir: options.homeDir,
    names: (options.names ?? []).filter((name) => name.length >= 3),
    envSecrets: environmentSecrets(options.env ?? {}),
    now: options.now ?? (() => Date.now()),
  };
  setCrashReportingLive(on);
  if (!on) return;
  markRun(lastRunFile, { version: options.version, startedAt: session.now() });
  session.lastRunFile = lastRunFile;
  if (process.versions.electron) {
    try {
      const { initMainSentry } = await import('./sentry-main');
      await initMainSentry({
        dsn: options.dsn,
        release: session.release,
        environment: session.environment,
        scrub: scrubOptions,
      });
    } catch (cause) {
      console.warn(`[crash] reporting could not start: ${String(cause)}`);
      setCrashReportingLive(false);
      return;
    }
  }
  // The transport waits for app ready on its own; boot must not.
  if (previous) void reportLastRun(previous);
}

export async function reportRendererCrash(input: {
  kind: 'error' | 'unhandledrejection';
  message: string;
  stack?: string;
}): Promise<void> {
  if (!crashReportingLive() || !allow(session.now())) return;
  await deliver(eventFrom(input.message, input.stack, { process: 'renderer', kind: input.kind }));
}

export async function reportUtilityExit(exit: {
  name: string;
  code: number;
  expected: boolean;
}): Promise<void> {
  if (exit.expected || !crashReportingLive()) return;
  const tail = stderrTail(exit.name, 50).map((line) => scrubStderrLine(line, scrubOptions()));
  const contexts = { utility: { name: exit.name, code: exit.code, stderr: tail } };
  const tags = { process: exit.name };
  await deliver(eventFrom(`utility ${exit.name} exited ${exit.code}`, undefined, tags, contexts));
}

export async function reportRenderProcessGone(reason: string): Promise<void> {
  if (!crashReportingLive()) return;
  await deliver(eventFrom(`render process gone: ${reason}`, undefined, { process: 'renderer' }));
}

/** The previous run of main ended without quitting; reported under that run's release. */
async function reportLastRun(run: LastRun): Promise<void> {
  const contexts = { last_run: { version: run.version, started_at: new Date(run.startedAt).toISOString() } };
  const event = eventFrom('main process ended without quitting', undefined, { process: 'main' }, contexts);
  await deliver({ ...event, release: `taalcut@${run.version}` });
}

export function crashesRouter() {
  const os = implementContract(crashesContract);
  return os.router({
    report: os.report.handler(async ({ input }) => {
      await reportRendererCrash(input);
    }),
  });
}

export function deleteCrashDumps(directory: string, homeDir: string): void {
  const dir = resolve(directory);
  const home = resolve(homeDir);
  let real: string;
  try {
    real = realpathSync(dir);
  } catch {
    return;
  }
  if (real === '/' || real === home || home.startsWith(`${real}${sep}`)) return;
  try {
    if (!lstatSync(dir).isDirectory()) return;
    rmSync(dir, { recursive: true, force: true });
  } catch {
    // A missing or busy crash directory must not stop launch.
  }
}

function allow(now: number): boolean {
  while (recent.length > 0 && now - recent[0]! >= WINDOW_MS) recent.shift();
  if (recent.length >= LIMIT) return false;
  recent.push(now);
  return true;
}

function scrubOptions(): ScrubOptions {
  return { secrets: [...secrets, ...session.envSecrets], homeDir: session.homeDir, names: session.names };
}

function eventFrom(
  message: string,
  stack?: string,
  tags?: Record<string, string>,
  contexts?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    message,
    level: 'error',
    platform: 'javascript',
    release: session.release,
    environment: session.environment,
    tags,
    contexts,
    exception: stack
      ? { values: [{ type: 'Error', value: message, stacktrace: { frames: framesOf(stack) } }] }
      : undefined,
  };
}

function framesOf(stack: string): Array<Record<string, unknown>> {
  const frames: Array<Record<string, unknown>> = [];
  for (const line of stack.split('\n')) {
    const match = /at (?:async )?(?:(.*?) \()?(.+):(\d+):(\d+)\)?$/.exec(line.trim());
    if (!match) continue;
    frames.push({
      ...(match[1] ? { function: match[1] } : {}),
      filename: match[2],
      lineno: Number(match[3]),
      colno: Number(match[4]),
    });
  }
  return frames;
}

async function deliver(event: Record<string, unknown>): Promise<void> {
  if (!crashReportingLive()) return;
  if (process.versions.electron) {
    const { captureMainEvent } = await import('./sentry-main');
    await captureMainEvent(event);
    return;
  }
  const scrubbed = scrubCrashEvent(event, scrubOptions());
  if (!crashReportingLive() || !session.urls) return;
  const eventId = randomBytes(16).toString('hex');
  // eventFrom set release (the crashed run's, for a run that ended without quitting) and environment.
  const timestamp = session.now() / 1000;
  const payload = Buffer.from(JSON.stringify({ ...scrubbed, event_id: eventId, timestamp }));
  const body = Buffer.concat([
    envelopeHeader(eventId, new Date(session.now()).toISOString(), session.dsn),
    envelopeItem({ type: 'event', content_type: 'application/json' }, payload),
  ]);
  await postEnvelope(session.urls.envelopeUrl, body);
}
