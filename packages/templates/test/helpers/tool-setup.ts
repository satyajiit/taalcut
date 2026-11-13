// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The templates tools wired as the app wires them, with test parts: core's
 * real command bus and direct job runner, the memory template store, a
 * folder sandbox, a fake component installer and the FFmpeg stand-ins for
 * the analysers. `call` runs a tool the way the executor does (input parsed,
 * command dispatched with the call's key, output checked against its schema).
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  createDirectJobRunner,
  err,
  newId,
  NotFoundError,
  ok,
  ValidationError,
  type AnyTool,
  type ArtifactId,
  type ArtifactStore,
  type AsyncResult,
  type ComponentInstallerPort,
  type ExperimentId,
  type InstalledComponentRef,
  type JobKind,
  type JobRunner,
  type JobRunOptions,
  type StoredArtifact,
  type TemplateSearch,
  type ToolRunId,
} from '@taalcut/core';
import {
  createBreakdownJobLog,
  createTemplateJobs,
  templatesToolModule,
  type StyleProfiles,
  type TemplateToolDeps,
} from '../../src/index';
import {
  createFfmpegAnalysers,
  createMemoryTemplateMediaStore,
  type FfmpegBinaryPaths,
  type MemoryTemplateStore,
} from '../../src/test-support';
import type { DescribeStrip } from '../../src/breakdown/looks';
import { createDirSandbox, type FakeRun } from './dir-sandbox';
import { AGENT, setupTemplates } from './setup';

function memoryArtifacts(): ArtifactStore & { items: Map<ArtifactId, StoredArtifact> } {
  const items = new Map<ArtifactId, StoredArtifact>();
  return {
    items,
    async put(artifact) {
      const data =
        typeof artifact.data === 'string' ? new TextEncoder().encode(artifact.data) : artifact.data;
      const ref = {
        id: newId<'Artifact'>(),
        mediaType: artifact.mediaType,
        bytes: data.byteLength,
        summary: artifact.summary,
      };
      items.set(ref.id, { ref, data });
      return ok(ref);
    },
    async get(id) {
      const found = items.get(id);
      return found ? ok(found) : err(ValidationError({ field: 'id' }));
    },
  };
}

/** Like the engine: the same idempotency key hands back the first result. */
export function memoJobRunner(inner: JobRunner): JobRunner & { keys: string[] } {
  const results = new Map<string, unknown>();
  const keys: string[] = [];
  return {
    keys,
    async run<I, O>(kind: JobKind<I, O>, input: NoInfer<I>, options: JobRunOptions = {}): AsyncResult<O> {
      const key = options.idempotencyKey ?? kind.idempotencyKey?.(input);
      if (key) keys.push(key);
      if (key && results.has(key)) return results.get(key) as Awaited<AsyncResult<O>>;
      const result = await inner.run(kind, input, options);
      if (key && result.ok) results.set(key, result);
      return result;
    },
  };
}

export interface ToolSetupOptions {
  readonly bins?: FfmpegBinaryPaths;
  readonly run?: FakeRun;
  /** REF1: the Instagram session's cookies for the second try; absent, not signed in. */
  readonly instagramCookies?: string;
  /** REF1: false runs without a template media store (a template keeps nothing, no templates.fetchMedia). */
  readonly media?: boolean;
  readonly memoJobs?: boolean;
  readonly installFails?: boolean;
  /** The library's template search; `templates.search` is registered only with one. */
  readonly search?: TemplateSearch;
  /** The Analyst model's context window, which sizes templates.resolveCuts' pages (absent: unknown). */
  readonly contextWindow?: number;
  /** BRK1 looks: the strip describer templates.breakdown uses (absent: the Analyst looks itself). */
  readonly describeStrip?: DescribeStrip;
  /** LRN1-STY: style profiles over the setup's store; `templates.styleProfile` and `useStyleProfile` need them. */
  readonly styleProfiles?: (store: MemoryTemplateStore) => StyleProfiles;
}

export function setupTools(options: ToolSetupOptions = {}) {
  const base = setupTemplates();
  const root = mkdtempSync(join(tmpdir(), 'taalcut-template-tools-'));
  const sandbox = createDirSandbox(join(root, 'scratch'), options.run);
  const installed = new Map<string, InstalledComponentRef>();
  const installs: string[] = [];
  const components: ComponentInstallerPort = {
    get: async (id) => installed.get(id),
    async install(id) {
      installs.push(id);
      if (options.installFails)
        return err(NotFoundError({ entity: 'component', id }, { detail: 'no build for this Mac' }));
      const path = join(root, 'components', id);
      const ref = { id, version: '1.0.0', path, notice: join(path, 'TAALCUT-NOTICE.txt') };
      installed.set(id, ref);
      return ok(ref);
    },
  };
  const bins = options.bins ?? { ffmpeg: '/nonexistent/ffmpeg', ffprobe: '/nonexistent/ffprobe' };
  const direct = createDirectJobRunner(
    createTemplateJobs({ sandbox, components, analysers: createFfmpegAnalysers(bins), clock: base.clock }),
  );
  const jobs = options.memoJobs ? memoJobRunner(direct) : direct;
  const breakdownJobs = createBreakdownJobLog();
  const media = createMemoryTemplateMediaStore({
    root: join(root, 'templates', 'media'),
    now: () => base.clock.now(),
    exists: async (templateId) => (await base.store.get(templateId)).ok,
  });
  const deps: TemplateToolDeps = {
    breakdownJobs,
    sandbox,
    store: base.store,
    service: base.service,
    jobs,
    ...(options.media === false ? {} : { media }),
    ...(options.instagramCookies !== undefined
      ? { instagramCookies: async () => ok(options.instagramCookies ?? null) }
      : {}),
    clock: base.clock,
    ids: {
      template: () => newId(),
      slot: () => newId(),
      overlay: () => newId(),
      experiment: () => newId<'Experiment'>() as ExperimentId,
    },
    ...(options.search ? { search: options.search } : {}),
    ...(options.contextWindow ? { contextWindow: () => options.contextWindow } : {}),
    ...(options.describeStrip ? { describeStrip: options.describeStrip } : {}),
    ...(options.styleProfiles ? { styleProfiles: options.styleProfiles(base.store) } : {}),
  };
  const module = templatesToolModule(deps);
  const artifacts = memoryArtifacts();
  const progress: { fraction: number; note?: string }[] = [];

  function tool(name: string): AnyTool {
    const found = module.tools.find((item) => item.name === name);
    if (!found) throw new Error(`no tool ${name}`);
    return found;
  }

  async function call(name: string, raw: unknown, signal = new AbortController().signal) {
    const spec = tool(name);
    const parsed = spec.input.safeParse(raw);
    if (!parsed.success) return err(ValidationError({ field: 'input' }, { detail: parsed.error.message }));
    const key = spec.idempotencyKey?.(parsed.data);
    const ctx = {
      signal,
      callId: newId<'ToolRun'>() as ToolRunId,
      attempt: 1,
      artifacts,
      ...(key !== undefined ? { idempotencyKey: key } : {}),
      reportUsage: () => undefined,
      reportProgress: (fraction: number, note?: string) =>
        void progress.push({ fraction, ...(note ? { note } : {}) }),
      async dispatch(payload: unknown) {
        if (!spec.command) return err(ValidationError({ field: 'command' }));
        const receipt = await base.bus.dispatch(
          spec.command,
          payload,
          AGENT,
          key ? { idempotencyKey: key } : {},
        );
        return receipt.ok ? ok(receipt.value.result) : receipt;
      },
    };
    const result = await spec.run(parsed.data, ctx as never);
    if (result.ok) {
      const checked = spec.output.safeParse(result.value);
      if (!checked.success) throw new Error(`${name} output: ${checked.error.message}`);
    }
    return result as Awaited<AsyncResult<Record<string, unknown>>>;
  }

  /** The value of an ok call; throws with the error code otherwise. */
  async function value<T = Record<string, unknown>>(name: string, raw: unknown): Promise<T> {
    const result = await call(name, raw);
    if (!result.ok) throw new Error(`${name}: ${result.error.code} ${result.error.detail ?? ''}`);
    return result.value as T;
  }

  return {
    ...base,
    breakdownJobs,
    root,
    sandbox,
    installs,
    media,
    deps,
    module,
    artifacts,
    progress,
    tool,
    call,
    value,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}
export type ToolSetup = ReturnType<typeof setupTools>;
