// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The jobs process's Core ML embedder (IX2-E5): the mac helper's embed service over the `embeddinggemma-2-coreml`
 * component, which the embedding profile puts first on macOS 15 and later. It needs the helper, that component and
 * the ONNX component (its tokenizer gives the token ids).
 *
 * The first load on a Mac compiles the text functions for its Neural Engine (about one and a half minutes on an
 * M5 Max; vision SPEC "Core ML backend"), and macOS keeps the result. So `available` starts that load in the
 * background and waits a few seconds for it: a Mac that has compiled before goes to Core ML at once, keeping the
 * helper the load started; one that hasn't embeds on ONNX Runtime until the compile finishes. Then `onAvailable`
 * starts the embedder's move to Core ML in the background (IX2-F10): calls keep running on ONNX Runtime until the
 * Core ML model has loaded, so neither the compile nor the move sits on an import's critical path or a search.
 *
 * A component packed since IX3 carries a recipe instead of its weights: the first look writes them from the ONNX
 * component into its folder (`coreMlModelsDir`, a few seconds once per version), and the helper loads that.
 *
 * The person's OCR compiles first (FIX-OCRCOLD): the first load waits for `yieldTo`, the OCR helper's warm-up, at
 * most `yieldMaxMs`. Both compile on the one Neural Engine compiler, and a fresh profile's first load here kept it
 * for 4–5 minutes, during which a breakdown's first text read took minutes and was cancelled. The warm-up takes about
 * a second once a helper build has compiled, a few minutes on a busy Mac the first time; embeddings run on ONNX
 * Runtime meanwhile, as during any first compile.
 */
import {
  createJsonLineSidecar,
  helperCode,
  type JsonLineSidecar,
  type SidecarResolver,
} from '@taalcut/media';
import {
  coreMlModelsDir,
  describeWrittenWeights,
  embedServeArgs,
  EMBEDDING_COMPONENT,
  EMBEDDING_COREML_COMPONENT,
  loadCoreMlModel,
  type NativeEmbeddingBackend,
} from '@taalcut/vision';
import type { UtilityConfig } from '../../shared/rpc-ipc';
import { macHelperResolver } from './mac-helper-resolver';

export interface CoreMlBackendDeps {
  readonly config: Pick<UtilityConfig, 'packaged' | 'resourcesPath'>;
  /** An installed component's folder, or null. */
  readonly installed: (id: string) => Promise<string | null>;
  /** A folder the helper may read (symlinks resolved): frames are written there briefly. */
  readonly tempDir: () => Promise<string>;
  readonly log: (message: string) => void;
  /** How long after the background load started `available` still waits for it. Default 10 s. */
  readonly waitMs?: number;
  /** Test seams: finds the helper (default the app's), and starts it (default media's JSON-line client). */
  readonly resolver?: SidecarResolver;
  readonly open?: typeof createJsonLineSidecar;
  /** Test seam: the folder the helper loads for the installed component (default `coreMlModelsDir`). */
  readonly modelsDir?: typeof coreMlModelsDir;
  /** What compiles for the Neural Engine before the first load: the OCR helper's warm-up (vision.ts). */
  readonly yieldTo?: () => Promise<unknown>;
  /** The most the first load waits for `yieldTo`. Default 10 minutes. */
  readonly yieldMaxMs?: number;
}

/** A Mac that has compiled the models before loads them in 3–6 s (vision SPEC); a first compile takes minutes. */
const DEFAULT_WAIT_MS = 10_000;
/** The first compile, with room for a busy machine. */
const PREPARE_TIMEOUT_MS = 15 * 60_000;
/** The helper exits after this long without a request; the next one starts it again (a warm load). */
const IDLE_MS = 120_000;
/** The OCR warm-up's worst first run seen was about 5 minutes on a busy Mac: twice that, then the load goes ahead. */
const YIELD_MAX_MS = 10 * 60_000;

/** Waits for `first` to settle, however it ends, at most `maxMs`; the milliseconds waited. */
export async function yieldFirst(
  first: (() => Promise<unknown>) | undefined,
  maxMs: number,
): Promise<number> {
  if (!first) return 0;
  const started = performance.now();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const cap = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, maxMs);
    timer.unref?.();
  });
  await Promise.race([first().catch(() => undefined), cap]);
  clearTimeout(timer);
  return performance.now() - started;
}

interface Parts {
  readonly command: string;
  readonly models: string;
  readonly tokenizer: string;
  readonly tempDir: string;
}

function settleAfter(ms: number): Promise<undefined> {
  return new Promise((resolve) => setTimeout(() => resolve(undefined), ms).unref());
}

/**
 * `modelsDir` once per installed folder (its weights are written once, and logged); a failure is tried again on the
 * next look.
 */
function writtenOnce(
  modelsDir: typeof coreMlModelsDir,
  log: (message: string) => void,
): (component: string, onnx: string) => ReturnType<typeof coreMlModelsDir> {
  const written = new Map<string, ReturnType<typeof coreMlModelsDir>>();
  return (component, onnx) => {
    const key = `${component}\n${onnx}`;
    const pending =
      written.get(key) ??
      modelsDir(component, onnx, (done) => log(`[vision] ${describeWrittenWeights(done)}`)).then((result) => {
        if (!result.ok) written.delete(key);
        return result;
      });
    written.set(key, pending);
    return pending;
  };
}

export function coreMlEmbedBackend(deps: CoreMlBackendDeps): NativeEmbeddingBackend {
  const resolver = deps.resolver ?? macHelperResolver(deps.config);
  const start = deps.open ?? createJsonLineSidecar;
  const env = deps.config.packaged ? {} : process.env;
  const said = new Set<string>();
  const sayOnce = (message: string) => {
    if (!said.has(message)) deps.log(message);
    said.add(message);
  };
  let prepared: Promise<boolean> | undefined;
  let preparedAt = 0;
  /** The helper the background load warmed, handed to the first model load. */
  let warm: JsonLineSidecar | undefined;
  /** `available` said no while the load ran: tell the embedder when it is done. */
  let declined = false;
  const listeners: (() => void)[] = [];
  const weights = writtenOnce(deps.modelsDir ?? coreMlModelsDir, deps.log);

  async function parts(): Promise<Parts | string> {
    const [helper, component, tokenizer] = await Promise.all([
      resolver.resolve(),
      deps.installed(EMBEDDING_COREML_COMPONENT),
      deps.installed(EMBEDDING_COMPONENT),
    ]);
    if (!helper.ok) return `the mac helper is unavailable (${helper.error.code})`;
    if (!component) return `${EMBEDDING_COREML_COMPONENT} is not installed`;
    if (!tokenizer) return `${EMBEDDING_COMPONENT} is not installed`;
    const models = await weights(component, tokenizer);
    if (!models.ok) return `its weights could not be written (${models.error})`;
    return { command: helper.value.path, models: models.value, tokenizer, tempDir: await deps.tempDir() };
  }

  const open = (found: Parts) =>
    start({
      command: found.command,
      args: embedServeArgs(found.models, [found.tempDir]),
      env,
      idleExitMs: IDLE_MS,
    });

  async function prepare(found: Parts): Promise<boolean> {
    if (deps.yieldTo) {
      const waited = await yieldFirst(deps.yieldTo, deps.yieldMaxMs ?? YIELD_MAX_MS);
      deps.log(
        `[vision] Core ML embedder: first load after OCR's warm-up (waited ${(waited / 1000).toFixed(1)} s)`,
      );
    }
    const started = performance.now();
    const helper = open(found);
    const result = await helper.request('embed.prepare', {}, { timeoutMs: PREPARE_TIMEOUT_MS });
    if (!result.ok) {
      await helper.close();
      deps.log(
        `[vision] the Core ML embedder won't load (${helperCode(result.error)}): ONNX Runtime instead`,
      );
      return false;
    }
    deps.log(`[vision] Core ML embedder loaded in ${((performance.now() - started) / 1000).toFixed(1)} s`);
    warm = helper;
    if (declined) for (const listener of listeners.splice(0)) listener();
    return true;
  }

  return {
    async available() {
      const found = await parts();
      if (typeof found === 'string') {
        sayOnce(`[vision] Core ML embedder: ${found}; ONNX Runtime instead`);
        return false;
      }
      if (!prepared) {
        preparedAt = performance.now();
        prepared = prepare(found);
      }
      // Waits only while the load could still be a warm one: a load started long ago is a compile.
      const left = Math.max(0, (deps.waitMs ?? DEFAULT_WAIT_MS) - (performance.now() - preparedAt));
      const ready = await Promise.race([prepared, settleAfter(left)]);
      if (ready === undefined) {
        declined = true;
        sayOnce('[vision] Core ML embedder compiling for this Mac: ONNX Runtime until it is ready');
      }
      return ready === true;
    },
    onAvailable(listener) {
      listeners.push(listener);
    },
    async load() {
      const found = await parts();
      if (typeof found === 'string') throw new Error(found);
      const reuse = warm;
      warm = undefined;
      return loadCoreMlModel({
        open: () => reuse ?? open(found),
        tempDir: found.tempDir,
        tokenizerDir: found.tokenizer,
      });
    },
  };
}
