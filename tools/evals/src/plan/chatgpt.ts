// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The ChatGPT plan for the evals (HFW1 dsn), wired as the app wires it: a main-side runtime whose credentials are
 * the eval's own sign-in file (credentials-file.ts), @taalcut/models' auth broker over it (its ChatGPT sign-in, its
 * locked refresh, its scrub), and a client-side runtime whose calls get their access token from the broker through
 * the caching provider, as the agent process does across IPC. The client is the edit eval's (`evalModelClient`), so
 * a request on `openai` with the sign-in's `oauth_access` is shaped exactly as the app's: the plan's model, `store:
 * false`, `stream: true`, the fields ChatGPT tokens reject dropped (models' chatgpt-plan.ts). Nothing here reads the
 * app's vault or Keychain.
 */
import {
  createAuthBroker,
  createCachingCredentialProvider,
  createModelRuntime,
  type AuthBroker,
  type FetchFn,
  type ModelClient,
  type ModelRuntime,
  type ModelRuntimeOptions,
  type ReasoningLevel,
  type SignInEvent,
} from '@taalcut/models';
import { evalModelClient } from '../edit/live';
import { evalCredentialsPath, evalCredentialsStore } from './credentials-file';

/** The provider Taalcut signs in to ChatGPT on. */
export const PLAN_PROVIDER = 'openai';
/** The only plan the evals sign in to so far. */
export const PLANS = ['chatgpt'] as const;
export type Plan = (typeof PLANS)[number];

export interface PlanOptions {
  /** Where `.taalcut-eval/` is (default: the user's home). */
  readonly home?: string;
  /** Opens the sign-in page (default: print it, and on macOS open the browser). */
  readonly openExternal?: (url: string) => void | Promise<void>;
  readonly onSignInEvent?: (event: SignInEvent) => void;
  /** Tests only: a mock OAuth server and a mock provider (base URL overrides, sign-in endpoints). */
  readonly runtime?: Pick<ModelRuntimeOptions, 'baseUrlOverrides' | 'signIn'>;
  readonly fetch?: FetchFn;
}

export interface PlanSession {
  readonly broker: AuthBroker;
  /** The client-side runtime, for what a model takes (images). */
  readonly runtime: ModelRuntime;
  /** Where the sign-in is kept. */
  readonly file: string;
  /** A client whose every module runs `model` on the plan. */
  client(model: string, reasoning?: ReasoningLevel): ModelClient;
  /** Whether `model` takes pictures (its stills then go to it as the app sends them). */
  seesImages(model: string): boolean;
  /** Removes every token the broker has handled from text bound for a line, a report or a file. */
  scrub(text: string): string;
  /** The last request the plan's clients sent, for a failure's line: method, path, model, top-level fields (never headers). */
  lastRequest(): string | undefined;
}

/** What a failure's line may say of a request: never its headers, nor any value but the model and the tool names. */
export function requestSummary(input: Parameters<FetchFn>[0], init: Parameters<FetchFn>[1]): string {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  const method = init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET');
  let body: Record<string, unknown> = {};
  try {
    body = typeof init?.body === 'string' ? (JSON.parse(init.body) as Record<string, unknown>) : {};
  } catch {
    // Not JSON: the path is all there is to say.
  }
  const tools = Array.isArray(body.tools)
    ? body.tools.map((tool) => String((tool as { name?: unknown }).name ?? '?'))
    : [];
  return [
    `${method} ${url.pathname}`,
    ...(typeof body.model === 'string' ? [`model ${body.model}`] : []),
    `fields ${Object.keys(body).join(',') || 'none'}`,
    ...(body.reasoning !== undefined ? [`reasoning ${JSON.stringify(body.reasoning)}`] : []),
    ...(tools.length ? [`tools ${tools.length} (${tools.slice(0, 3).join(', ')}${tools.length > 3 ? ', …' : ''})`] : []),
  ].join('; ');
}

export function openPlan(options: PlanOptions = {}): PlanSession {
  const providers = { builtinProviders: [PLAN_PROVIDER], ...options.runtime };
  const main = createModelRuntime({ ...providers, secrets: evalCredentialsStore(options.home) });
  const broker = createAuthBroker({
    runtime: main,
    openExternal: options.openExternal ?? (() => undefined),
    ...(options.onSignInEvent ? { onSignInEvent: options.onSignInEvent } : {}),
  });
  const runtime = createModelRuntime(providers);
  const credentials = createCachingCredentialProvider({ source: broker });
  let last: string | undefined;
  const base = options.fetch ?? globalThis.fetch;
  const fetch: FetchFn = (input, init) => {
    last = requestSummary(input, init);
    return base(input, init);
  };
  broker.onChange((provider) => credentials.forget(provider));
  return {
    broker,
    runtime,
    file: evalCredentialsPath(options.home).file,
    client: (model, reasoning) =>
      evalModelClient({
        runtime,
        credentials,
        fetch,
        choice: { provider: PLAN_PROVIDER, model, ...(reasoning ? { reasoning } : {}) },
      }),
    seesImages: (model) => runtime.findModel(PLAN_PROVIDER, model, 'chat')?.input.includes('image') ?? false,
    scrub: (text) => broker.scrub(text),
    lastRequest: () => last,
  };
}

/** The session, signed in to the plan, or why not (no sign-in yet: `eval:signin chatgpt`). */
export async function signedInPlan(plan: string, options: PlanOptions = {}): Promise<PlanSession> {
  if (!PLANS.includes(plan as Plan)) throw new Error(`No plan "${plan}": the evals know ${PLANS.join(', ')}`);
  const session = openPlan(options);
  const status = await session.broker.status(PLAN_PROVIDER);
  if (!status.ok) throw new Error(`The eval's sign-in could not be read (${status.error.code}) at ${session.file}`);
  if (status.value.method !== 'subscription')
    throw new Error(`Not signed in to ChatGPT for the evals: run pnpm --filter @taalcut/evals eval:signin chatgpt`);
  return session;
}
