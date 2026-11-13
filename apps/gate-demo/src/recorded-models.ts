// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Recorded model sessions (P1-I3) for runs that must be offline and free:
 * the headless gate demo here, the desktop smoke test (P1-I1) and the make
 * flow's desktop journeys (P2-M13). Both clients are real @taalcut/models
 * clients, so pi-ai builds every request and parses every recorded stream,
 * and every call gets its CloudCall row; only `fetch` answers from a cassette.
 *
 * Each session is its own cassette with its own asks (the gate demo's, the
 * make flow's). Matching ignores the prompt text (system and messages): a
 * SOUL.md edit or a tool result that differs by machine doesn't break
 * replay. The model, settings and tools offered still have to match, so a
 * changed flow fails with a "re-record" message instead of replaying the
 * wrong turn. Two fields are added for matching only and taken off before a
 * request goes upstream: which ask of its session the call serves
 * (`taalcut_ask`) and how many model turns the run has had
 * (`taalcut_turn`), so every turn replays as itself, in any order, also in a
 * fresh process after a crash or a restart mid-run.
 *
 * Re-record with TAALCUT_RECORD=1 (every session the composition uses), or
 * one session with TAALCUT_RECORD=1 TAALCUT_RECORD_SESSION=<name>. A
 * catalogue refresh (scripts/refresh-catalogue.ts) adds
 * TAALCUT_RECORD_UPSTREAM=cassette, so the stored responses answer instead of
 * the stand-in, and TAALCUT_RECORD_DIR=<dir>, so the fixtures stay as they are.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ok, type CloudCallSink } from '@taalcut/core';
import {
  createModelClient,
  createModelRuntime,
  createStaticCredentialProvider,
  openCassette,
  type Cassette,
  type CassetteMode,
  type CredentialProvider,
  type FetchFn,
  type ModelChoice,
  type ModelClient,
} from '@taalcut/models';
import { runMessageText, runTurn, type AnthropicMessage } from './anthropic-view';
import { canonicalClient, scopedCanonicaliser } from './canonical';
import { EDIT_CHAT_ASKS } from './edit-chat-script';
import { EDIT_DESIGN_ASKS } from './edit-design-script';
import { MAKE_FLOW_ASKS } from './make-flow-fixtures';
import { CLOUD_VISION, GATE_AGENT, GATE_DEMO_ASKS } from './script';
import { createStandInProvider } from './stand-in';
import { recordsFromCassettes, storedUpstream } from './stored-upstream';

/** The committed recordings. */
export const GATE_DEMO_FIXTURES = join(import.meta.dirname, '..', 'fixtures');
export const GATE_DEMO_CASSETTE = 'gate-demo.cassette.json';
export const MAKE_FLOW_CASSETTE = 'make-flow.cassette.json';
export const EDIT_CHAT_CASSETTE = 'edit-chat.cassette.json';
export const EDIT_DESIGN_CASSETTE = 'edit-design.cassette.json';

export interface RecordedSession {
  readonly name: string;
  /** The cassette's file name in the fixtures folder. */
  readonly cassette: string;
  /** Beside it, the tool catalogue it was recorded with (catalogue.ts), written by whatever records it. */
  readonly catalogue: string;
  /** How to re-record it, for the messages that ask for it. */
  readonly rerecord: string;
  readonly asks: readonly string[];
  /**
   * Ids numbered per ask, not per process (canonical.ts): its asks replay in any order, and a run resumed in a
   * fresh process after a restart replays too. The gate demo's session keeps one numbering for the process.
   */
  readonly idsPerAsk?: boolean;
}

export const GATE_DEMO_SESSION: RecordedSession = {
  name: 'gate-demo',
  cassette: GATE_DEMO_CASSETTE,
  catalogue: 'gate-demo.catalogue.txt',
  rerecord: 'TAALCUT_RECORD=1 pnpm --filter @taalcut/gate-demo test',
  asks: GATE_DEMO_ASKS,
};
/** Recorded by the desktop's make-flow journeys, in the app's agent process (apps/desktop e2e/make-flow.e2e.ts). */
export const MAKE_FLOW_SESSION: RecordedSession = {
  name: 'make-flow',
  cassette: MAKE_FLOW_CASSETTE,
  catalogue: 'make-flow.catalogue.txt',
  rerecord:
    'after a test build of apps/desktop, TAALCUT_RECORD=1 TAALCUT_RECORD_SESSION=make-flow playwright test ' +
    '--project=make e2e/make-flow.e2e.ts in apps/desktop',
  asks: MAKE_FLOW_ASKS,
  idsPerAsk: true,
};
/**
 * EDT1-CTX: the editor's docked chat asking for a change, on a video the make flow's reference journey made (apps/desktop
 * e2e/make-flow-edit-chat.e2e.ts). Its own cassette, so it re-records without the make flow's journeys.
 */
export const EDIT_CHAT_SESSION: RecordedSession = {
  name: 'edit-chat',
  cassette: EDIT_CHAT_CASSETTE,
  catalogue: 'edit-chat.catalogue.txt',
  rerecord:
    'after a test build of apps/desktop, TAALCUT_RECORD=1 TAALCUT_RECORD_SESSION=edit-chat playwright test ' +
    '--project=make e2e/make-flow-edit-chat.e2e.ts in apps/desktop',
  asks: EDIT_CHAT_ASKS,
  idsPerAsk: true,
};
/**
 * HFW1-UI: the editor's docked chat asking for a newspaper-style headline at 0:04, which the Editor hands to the
 * Designer, on a video the make flow's reference journey made (apps/desktop e2e/make-flow-edit-design.e2e.ts). Its
 * own cassette, as edit-chat's.
 */
export const EDIT_DESIGN_SESSION: RecordedSession = {
  name: 'edit-design',
  cassette: EDIT_DESIGN_CASSETTE,
  catalogue: 'edit-design.catalogue.txt',
  rerecord:
    'after a test build of apps/desktop, TAALCUT_RECORD=1 TAALCUT_RECORD_SESSION=edit-design playwright test ' +
    '--project=make e2e/make-flow-edit-design.e2e.ts in apps/desktop',
  asks: EDIT_DESIGN_ASKS,
  idsPerAsk: true,
};

const IGNORED_BODY_FIELDS = ['prompt_cache_key', 'metadata', 'user', 'session_id', 'system', 'messages'];
const ASK_FIELD = 'taalcut_ask';
const TURN_FIELD = 'taalcut_turn';
/** Sent on replay, where nothing leaves the process. */
const PLACEHOLDER_KEY = 'sk-ant-gate-demo-placeholder';

export interface RecordedModelsOptions {
  /** The home folder the session runs in. Paths under it are recorded as under /Users/demo. */
  readonly home: string;
  /** Default: the gate demo's session only. */
  readonly sessions?: readonly RecordedSession[];
  /** Default: from TAALCUT_RECORD and TAALCUT_RECORD_SESSION, otherwise 'replay'. */
  readonly mode?: CassetteMode;
  /** Where record mode sends requests. Default: the in-process stand-in for Anthropic's API. */
  readonly upstream?: FetchFn;
  /** For recording against the real API. Default: a placeholder key. */
  readonly credentials?: CredentialProvider;
  /** Values to scrub from the recording (the real key, when recording against the API). */
  readonly secrets?: readonly string[];
}

/** The gate demo's options, as before sessions existed. */
export type RecordedGateModelsOptions = Omit<RecordedModelsOptions, 'sessions'>;

export interface RecordedModels {
  /** What composeGateDemo (and the desktop root, in its e2e runs) takes as `models`. */
  (callLog: CloudCallSink): { readonly agent: ModelClient; readonly vision: ModelClient };
  /** The first session's cassette. Replay: unused() and misses() show drift. Record: save() writes it. */
  readonly cassette: Cassette;
  readonly cassettes: Readonly<Record<string, Cassette>>;
}
export type RecordedGateModels = RecordedModels;

/** Whether TAALCUT_RECORD=1 asks for `session` to be recorded: all of them, or the one TAALCUT_RECORD_SESSION names. */
export function isRecording(session: RecordedSession): boolean {
  if (process.env.TAALCUT_RECORD !== '1') return false;
  const only = process.env.TAALCUT_RECORD_SESSION;
  return !only || only === session.name;
}

/** A replay cassette that isn't there yet answers every call with how to record it, instead of failing start-up. */
function missingCassette(path: string): Cassette {
  const message = `No cassette at ${path}. Record it with TAALCUT_RECORD=1.`;
  const misses: string[] = [];
  return {
    mode: 'replay',
    path,
    fetch: async () => {
      misses.push(message);
      const body = { type: 'error', error: { type: 'cassette_miss', code: 'cassette_miss', message } };
      return new Response(JSON.stringify(body), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    },
    unused: () => 0,
    misses: () => misses,
    save: async () => undefined,
  };
}

export function createRecordedModels(fixturesDir: string, options: RecordedModelsOptions): RecordedModels {
  const sessions = options.sessions ?? [GATE_DEMO_SESSION];
  // EAR1-I1: a catalogue refresh records against the stored responses (stored-upstream.ts) into its own folder.
  const fromCassettes = !options.upstream && recordsFromCassettes();
  const stored = new Map(
    fromCassettes ? sessions.map((s) => [s.name, storedUpstream(join(fixturesDir, s.cassette))]) : [],
  );
  const standIn = options.upstream ?? createStandInProvider();
  const tagger = createTagger(sessions, (session) => stored.get(session) ?? standIn, fromCassettes);
  const cassettes: Record<string, Cassette> = {};
  for (const session of sessions) {
    const path = join(fixturesDir, session.cassette);
    const mode: CassetteMode = options.mode ?? (isRecording(session) ? 'record' : 'replay');
    const recordDir = process.env.TAALCUT_RECORD_DIR;
    cassettes[session.name] =
      mode === 'replay' && !existsSync(path)
        ? missingCassette(path)
        : openCassette({
            path: mode === 'record' && recordDir ? join(recordDir, session.cassette) : path,
            mode,
            upstream: tagger.upstream,
            ignoreBodyFields: IGNORED_BODY_FIELDS,
            secrets: [PLACEHOLDER_KEY, ...(options.secrets ?? [])],
          });
  }
  const runtime = createModelRuntime({ builtinProviders: ['anthropic'] });
  const credentials =
    options.credentials ??
    createStaticCredentialProvider({
      anthropic: { kind: 'api_key', secret: PLACEHOLDER_KEY, source: 'gate demo placeholder' },
    });
  // One for both clients: an id the agent saw keeps its stand-in in the vision call.
  // A session without idsPerAsk (the gate demo's) shares the process's scope, '', as it was recorded.
  const canon = scopedCanonicaliser(options.home, (text) => {
    const found = askOf(sessions, text);
    if (!found) return undefined;
    const perAsk = sessions.find((session) => session.name === found.session)?.idsPerAsk;
    return perAsk ? `${found.session}:${found.ask}` : '';
  });
  const fetch = tagger.tag((session) => cassettes[session]!.fetch);
  const client = (callLog: CloudCallSink, choice: ModelChoice) =>
    canonicalClient(
      createModelClient({
        runtime,
        credentials,
        callLog,
        selector: { resolve: (module) => ok({ module, choices: [choice] }) },
        fetch,
        // A replay miss is an HTTP 400 that says why; retrying it would only hide that.
        retry: { maxRetries: 0 },
      }),
      canon,
    );
  const models = (callLog: CloudCallSink) => ({
    agent: client(callLog, GATE_AGENT),
    vision: client(callLog, CLOUD_VISION),
  });
  return Object.assign(models, { cassette: cassettes[sessions[0]!.name]!, cassettes });
}

/** The gate demo's session alone (the headless demo and the Phase 1 smoke test). */
export function createRecordedGateModels(
  fixturesDir: string,
  options: RecordedGateModelsOptions,
): RecordedModels {
  return createRecordedModels(fixturesDir, { ...options, sessions: [GATE_DEMO_SESSION] });
}

type Init = Parameters<FetchFn>[1];

/**
 * Tags each request with the ask it serves and the run's turn, as top-level
 * body fields the cassette matches on, and sends it to its session's
 * cassette. A call without an ask of its own (vision's) serves the ask of
 * the call before. `upstream` sends the untagged body, so a real API never
 * sees the fields; `upstreamFor` names the one for the session being served.
 */
function createTagger(
  sessions: readonly RecordedSession[],
  upstreamFor: (session: string) => FetchFn,
  storedOnly: boolean,
) {
  const sent = new WeakMap<object, string>();
  let current = { session: sessions[0]!.name, ask: 0 };
  return {
    tag:
      (fetchFor: (session: string) => FetchFn): FetchFn =>
      (input, init) => {
        const body = parseBody(init);
        if (!init || typeof init.body !== 'string' || !body) return fetchFor(current.session)(input, init);
        const messages = Array.isArray(body.messages) ? (body.messages as AnthropicMessage[]) : [];
        const found = askOf(sessions, runMessageText(messages));
        if (found) current = found;
        const tagged: NonNullable<Init> = {
          ...init,
          body: JSON.stringify({ ...body, [ASK_FIELD]: current.ask, [TURN_FIELD]: runTurn(messages) }),
        };
        sent.set(tagged, init.body);
        return fetchFor(current.session)(input, tagged);
      },
    upstream: ((input, init) => {
      // Offline stored responses need the same ask/turn identity as replay; provider requests stay untagged.
      if (storedOnly) return upstreamFor(current.session)(input, init);
      const original = init ? sent.get(init) : undefined;
      return upstreamFor(current.session)(input, original === undefined ? init : { ...init, body: original });
    }) as FetchFn,
  };
}

function parseBody(init: Init): Record<string, unknown> | undefined {
  if (typeof init?.body !== 'string') return undefined;
  try {
    const body: unknown = JSON.parse(init.body);
    return body && typeof body === 'object' && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The session and 1-based index of the ask in the run's own user message
 * (earlier asks of the conversation come before it); the one said last if
 * the message holds more than one (merged turns). Undefined if none.
 */
function askOf(sessions: readonly RecordedSession[], text: string) {
  let best: { session: string; ask: number } | undefined;
  let at = -1;
  for (const session of sessions)
    session.asks.forEach((ask, index) => {
      const found = text.lastIndexOf(ask);
      if (found > at) [best, at] = [{ session: session.name, ask: index + 1 }, found];
    });
  return best;
}
