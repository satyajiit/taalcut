// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-G2: the SFX bank titles' CLAP text embeddings made in the background once the bank and both CLAP models are
 * installed, so the person's first `sfx.searchSounds` doesn't wait about 3 s (fp16) to 11 s (int8) for them. The
 * component manager's `onInstalled` (jobs-root.ts, the hook that already re-queues the library's stages) calls it
 * after each install.
 *
 * It never downloads. Downloads stay on demand, asked for by the person's own action:
 * - Only a fresh install starts it. The manager also reports the no-op installs a job's model lookup makes, so an
 *   install older than FRESH_MS is not one.
 * - Before the `bankTitles` job runs, every build it needs is checked: `sfx-bank`, and the CLAP audio and text builds
 *   this machine runs (the member of each variant group the download picks, the build the jobs ask for:
 *   listenBuildHere). Each must be installed and current (state `installed`, so the job's own install of it returns
 *   at once: no new version, no new notice). If one isn't, one log line and nothing else.
 * Then `bankTitles` finds the titles in the derived cache or makes them there. It runs as a low-priority
 * `audio.listen.query` job on this process's own queue (EAR1-R1), not on the listen service directly: it waits its
 * turn in the one-at-a-time listen lane and for the 'gpu' slot like any other listening. A failure is one log line:
 * the next search makes them instead.
 */
import { JobRunnerToken, type Container, type JobRunner } from '@taalcut/core';
import { bankTitlesQuery, LISTEN_COMPONENTS, runListenQuery } from '@taalcut/audio';
import { createEngineJobRunner, type ComponentManager } from '@taalcut/jobs';
import { ComponentManagerToken, JobEngineToken } from '../../shared/tokens';
import { listenBuildHere, ListenServiceToken } from './audio-listen';

/** The bank's component id (agent-audio-services.ts's SFX_BANK_COMPONENT, which the agent process reads). */
const SFX_BANK = 'sfx-bank';
const CLAP = [LISTEN_COMPONENTS.clapAudio, LISTEN_COMPONENTS.clapText] as const;
/** An install registered longer ago than this is a lookup of one already here, not an install. */
const FRESH_MS = 10 * 60_000;

/** An install the warm-up waits for: the bank, or either build of either CLAP model. */
export const warmsListenTitles = (id: string): boolean =>
  id === SFX_BANK || CLAP.some((base) => id === base || id === `${base}-fp16`);

/** The component the manager reports installed. */
export interface InstalledEvent {
  readonly id: string;
  /** When its files were registered (ISO). */
  readonly installedAt: string;
}

/** The bank's folder when it and the CLAP builds that run here are installed and current; else what is missing. */
async function ready(
  container: Container,
  components: ComponentManager,
): Promise<{ readonly bankDir: string } | { readonly missing: string }> {
  const needed = [SFX_BANK];
  for (const base of CLAP) {
    const chosen = await listenBuildHere(container, base);
    if (!chosen.ok) return { missing: `${base} (no build chosen: ${chosen.error.code})` };
    needed.push(chosen.value);
  }
  const states = new Map((await components.list()).map((status) => [status.id, status]));
  for (const id of needed) {
    const status = states.get(id);
    if (status?.state !== 'installed') return { missing: `${id} (${status?.state ?? 'unknown'})` };
  }
  const bankDir = states.get(SFX_BANK)?.installed?.path;
  return bankDir ? { bankDir } : { missing: `${SFX_BANK} (no folder)` };
}

/** The jobs process's queue: its engine (the app), or a runner registered in its place (tests). */
function queueOf(container: Container): JobRunner | undefined {
  if (container.has(JobRunnerToken)) return container.resolve(JobRunnerToken);
  return container.has(JobEngineToken) ? createEngineJobRunner(container.resolve(JobEngineToken)) : undefined;
}

/** After an install: warms the bank's titles when a fresh install completed the set. Never throws, never installs. */
export async function warmListenTitles(
  container: Container,
  installed: InstalledEvent,
  log: (line: string) => void = (line) => console.warn(line),
  now: () => number = Date.now,
): Promise<void> {
  if (!warmsListenTitles(installed.id)) return;
  if (!(now() - Date.parse(installed.installedAt) <= FRESH_MS)) return;
  if (!container.has(ListenServiceToken) || !container.has(ComponentManagerToken)) return;
  try {
    const queue = queueOf(container);
    if (!queue) return;
    const found = await ready(container, container.resolve(ComponentManagerToken));
    if ('missing' in found) {
      log(
        `[listen] sfx-bank titles not warmed: ${found.missing} is not installed here; the first search makes them`,
      );
      return;
    }
    const started = now();
    const made = await runListenQuery(
      queue,
      bankTitlesQuery,
      [],
      { bankDir: found.bankDir },
      { priority: 'low' },
    );
    if (!made.ok) {
      log(`[listen] sfx-bank titles not warmed (${made.error.code}): the first search makes them`);
      return;
    }
    const { titles } = made.value;
    log(`[listen] sfx-bank titles ready for search (${titles} in ${now() - started} ms)`);
  } catch (cause) {
    log(`[listen] sfx-bank titles not warmed: ${String(cause)}`);
  }
}
