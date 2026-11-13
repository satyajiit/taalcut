// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * App updates as main serves them (P3-B9, P3-B14): the state (the build's channel, the person's choice on a public
 * build, a download or a staged update with its release notes in the app's language, the last rollback), and
 * `updates.setChannel` (person-only, undoable; Beta needs the beta terms acknowledged first, as desktop's handler
 * checks). Also the agent's acknowledgements, which that check reads.
 */
import {
  BETA_TERMS,
  defineCommand,
  defineError,
  err,
  ok,
  PERSON_SOURCES,
  UPDATE_COMMANDS,
  updateCommandPayloads,
  type AnyCommand,
  type AppLocale,
  type PublicUpdateChannel,
  type UpdateChannel,
  type UpdateState,
} from '@taalcut/core';
import { watched, type Watched } from '../watch';

const BetaTermsRequired = defineError('desktop.beta_terms_required');
const UpdateUnreadable = defineError('desktop.update_unreadable', { retryable: true });

/** `error`: the last download failed its checks (desktop.update_unreadable), as About shows it. */
export const UPDATE_SCENARIOS = ['idle', 'downloading', 'ready', 'rolled-back', 'error'] as const;
export type UpdateScenario = (typeof UPDATE_SCENARIOS)[number];

export interface FakeUpdatesOptions {
  /** The build's channel; null: no feed (the default, as an unpackaged build). */
  readonly channel?: UpdateChannel | null;
  readonly scenario?: UpdateScenario;
  /** How long a check stays "checking" (ms). Default 600; 0 in unit tests. */
  readonly checkMs?: number;
}

/* eslint-disable lingui/no-unlocalized-strings -- release notes are the release's own text, per language: data */
const NOTES: Readonly<Record<AppLocale, string>> = {
  en: '- **Starter templates**: make a first video without a reel.\n- Cable import for iPhone and Android.\n- Settings › Usage shows what each day cost.',
  hi: '- **स्टार्टर टेम्पलेट**: बिना रील के पहला वीडियो बनाइए।\n- iPhone और Android के लिए केबल से इंपोर्ट।\n- सेटिंग्स › उपयोग में हर दिन का खर्च।',
  es: '- **Plantillas de inicio**: haz tu primer vídeo sin un reel.\n- Importación por cable para iPhone y Android.\n- Ajustes › Uso muestra lo que costó cada día.',
  'pt-BR':
    '- **Modelos iniciais**: faça o primeiro vídeo sem um reel.\n- Importação por cabo para iPhone e Android.\n- Ajustes › Uso mostra o custo de cada dia.',
};
/* eslint-enable lingui/no-unlocalized-strings */

export interface FakeAcknowledgements {
  has(featureId: string, termsVersion: string): boolean;
  record(featureId: string, termsVersion: string): { acknowledgedAt: number };
}

export function createFakeAcknowledgements(now: () => number): FakeAcknowledgements {
  const kept = new Map<string, number>();
  const key = (featureId: string, termsVersion: string) => `${featureId}\u0000${termsVersion}`;
  return {
    has: (featureId, termsVersion) => kept.has(key(featureId, termsVersion)),
    record(featureId, termsVersion) {
      const k = key(featureId, termsVersion);
      if (!kept.has(k)) kept.set(k, now());
      return { acknowledgedAt: kept.get(k) ?? now() };
    },
  };
}

export interface FakeUpdates {
  readonly watch: Watched<UpdateState>;
  /** The app's language moved: the staged update's notes follow it. */
  relocalise(): void;
  /** updates.check: "checking" for a moment, then up to date (a staged update or a download stays as it is). */
  check(): Promise<UpdateState>;
  commands(): AnyCommand[];
  /** The person pressed Restart now. */
  readonly installs: number[];
}

export function createFakeUpdates(
  deps: { now: () => number; locale: () => AppLocale; acknowledgements: FakeAcknowledgements },
  options: FakeUpdatesOptions = {},
): FakeUpdates {
  const channel = options.channel ?? null;
  let scenario = options.scenario ?? 'idle';
  const publicBuild = channel === 'stable' || channel === 'beta';
  // A stable build runs a stable version; every other build a beta (team builds use beta-style versions too).
  const running = channel === 'stable' ? '0.3.0' : '0.3.0-beta.2';
  const next = channel === 'stable' ? '0.3.1' : '0.3.0-beta.3';
  // UPDATE_CHANNEL_SETTING: the person's choice, null for the build's own channel until the first one.
  let stored: PublicUpdateChannel | null = null;
  const choice = (): PublicUpdateChannel | null => stored ?? (publicBuild ? channel : null);
  let checking = false;
  let checkedAt = deps.now() - 3_600_000;
  const status = (): UpdateState['status'] => {
    if (channel === null && scenario === 'idle') return { kind: 'off' };
    if (checking) return { kind: 'checking' };
    if (scenario === 'error') return { kind: 'error', error: UpdateUnreadable() };
    if (scenario === 'downloading') return { kind: 'downloading', version: next, percent: 42, delta: true };
    if (scenario === 'ready')
      return {
        kind: 'ready',
        version: next,
        notes: NOTES[deps.locale()],
        releaseDate: Date.UTC(2026, 9, 13),
      };
    return { kind: 'idle', checkedAt };
  };
  const watch = watched<UpdateState>(() => ({
    version: running,
    channel,
    choice: choice(),
    status: status(),
    // The update to `to` didn't start, so the app went back to `from` (the version running now).
    lastRollback: scenario === 'rolled-back' ? { from: running, to: next, at: deps.now() - 600_000 } : null,
  }));

  const check = async (): Promise<UpdateState> => {
    if (channel === null || scenario === 'ready' || scenario === 'downloading') return watch.get();
    checking = true;
    watch.notify();
    await new Promise((resolve) => setTimeout(resolve, options.checkMs ?? 600));
    checking = false;
    checkedAt = deps.now();
    // A check after a failed download starts it again; this one finds nothing newer.
    if (scenario === 'error') scenario = 'idle';
    watch.notify();
    return watch.get();
  };

  const setChannel = defineCommand({
    name: UPDATE_COMMANDS.setChannel,
    payload: updateCommandPayloads[UPDATE_COMMANDS.setChannel],
    sideEffect: 'write',
    sources: PERSON_SOURCES,
    project: () => null,
    handle({ channel: next }) {
      if (next === 'beta' && !deps.acknowledgements.has(BETA_TERMS.featureId, BETA_TERMS.termsVersion))
        return err(BetaTermsRequired());
      // The inverse puts back what was stored, null included (round P3-3): undoing the first choice is the build's.
      const before = stored;
      stored = next;
      watch.notify();
      return ok({
        result: { channel: next },
        inverse: { name: UPDATE_COMMANDS.setChannel, payload: { projectId: null, channel: before } },
      });
    },
  });

  return { watch, relocalise: () => watch.notify(), check, commands: () => [setChannel], installs: [] };
}
