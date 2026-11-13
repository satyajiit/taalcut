// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Bring-your-own ComfyUI local image provider (WP-GEN-COMFY, Advanced): talks to a user's local ComfyUI server
 * (`http://127.0.0.1:8188` by default) over HTTP (`/prompt`, `/history/{id}`, `/view`), so Taalcut never bundles
 * ComfyUI's GPL-3.0 code or PyTorch environment while enabling 100% local image generation (`R14`) even when
 * `Local only` mode is on.
 */
import {
  err,
  LocalOnly,
  newId,
  ok,
  type AsyncResult,
  type CloudCallSink,
  type GenerationAvailability,
} from '@taalcut/core';
import { z } from 'zod';
import type { FetchFn } from '../../client/http-meter';
import { LocalServerUnreachable, ModelNotConfigured, ModelProviderError, UnknownModel } from '../../errors';
import { isLoopbackUrl } from '../../runtime/endpoints';
import { scrubSecrets, scrubUrl } from '../../scrub';
import { fitsAspect, imageFacts } from '../image-bytes';
import type { ImageC2paReader } from '../image-route-spec';
import type {
  GeneratedImage,
  ImageAspect,
  ImageEstimate,
  ImageProvider,
  ImageRequest,
  ImageSize,
} from '../image-types';

export const COMFYUI_PROVIDER = 'comfyui';
export const COMFYUI_DEFAULT_BASE_URL = 'http://127.0.0.1:8188';

export const COMFYUI_IMAGE_MODELS = [
  { model: 'comfyui/flux-1-schnell', checkpoint: 'flux1-schnell-fp8.safetensors', steps: 4, cfg: 1.0 },
  { model: 'comfyui/sdxl-turbo', checkpoint: 'sd_xl_turbo_1.0_fp16.safetensors', steps: 4, cfg: 1.5 },
  { model: 'comfyui/z-image-turbo', checkpoint: 'z_image_turbo_bf16.safetensors', steps: 6, cfg: 2.0 },
] as const;

const DIMENSIONS: Readonly<Record<ImageSize, Readonly<Record<ImageAspect, readonly [number, number]>>>> = {
  draft: {
    '9:16': [576, 1024],
    '4:5': [768, 960],
    '16:9': [1024, 576],
    '1:1': [768, 768],
  },
  final: {
    '9:16': [864, 1536],
    '4:5': [1024, 1280],
    '16:9': [1536, 864],
    '1:1': [1024, 1024],
  },
};

const promptResponseSchema = z.object({ prompt_id: z.string().min(1) });
const historyFileSchema = z.object({
  filename: z.string().min(1),
  subfolder: z.string().optional().default(''),
  type: z.string().optional().default('output'),
});
const historyEntrySchema = z.object({
  outputs: z.record(
    z.string(),
    z.object({ images: z.array(historyFileSchema).optional() }),
  ),
});

export interface ComfyUiImageProviderDeps {
  /** Base URL of the user's ComfyUI server (`undefined` when not configured under Advanced). */
  readonly baseUrl: () => string | undefined;
  readonly callLog: CloudCallSink;
  readonly localOnly: () => boolean;
  readonly allowLan?: boolean;
  readonly fetch?: FetchFn;
  readonly now?: () => number;
  readonly c2pa?: ImageC2paReader;
  readonly maxPollAttempts?: number;
  readonly pollIntervalMs?: number;
}

/** Builds a deterministic ComfyUI API node graph for text-to-image generation. */
export function buildComfyUiImageWorkflow(input: {
  readonly checkpoint: string;
  readonly prompt: string;
  readonly negativePrompt: string;
  readonly width: number;
  readonly height: number;
  readonly count: number;
  readonly seed: number;
  readonly steps: number;
  readonly cfg: number;
}): Record<string, unknown> {
  return {
    '1': {
      class_type: 'CheckpointLoaderSimple',
      inputs: { ckpt_name: input.checkpoint },
    },
    '2': {
      class_type: 'CLIPTextEncode',
      inputs: { text: input.prompt, clip: ['1', 1] },
    },
    '3': {
      class_type: 'CLIPTextEncode',
      inputs: { text: input.negativePrompt, clip: ['1', 1] },
    },
    '4': {
      class_type: 'EmptyLatentImage',
      inputs: { width: input.width, height: input.height, batch_size: input.count },
    },
    '5': {
      class_type: 'KSampler',
      inputs: {
        seed: input.seed,
        steps: input.steps,
        cfg: input.cfg,
        sampler_name: 'euler',
        scheduler: 'simple',
        denoise: 1,
        model: ['1', 0],
        positive: ['2', 0],
        negative: ['3', 0],
        latent_image: ['4', 0],
      },
    },
    '6': {
      class_type: 'VAEDecode',
      inputs: { samples: ['5', 0], vae: ['1', 2] },
    },
    '7': {
      class_type: 'SaveImage',
      inputs: { filename_prefix: 'taalcut_still', images: ['6', 0] },
    },
  };
}

export function createComfyUiImageProvider(deps: ComfyUiImageProviderDeps): ImageProvider {
  const fetchFn: FetchFn = deps.fetch ?? ((input, init) => globalThis.fetch(input, init));
  const now = deps.now ?? Date.now;
  const maxPolls = deps.maxPollAttempts ?? 30;
  const pollMs = deps.pollIntervalMs ?? 50;

  const findSpec = (model: string) =>
    COMFYUI_IMAGE_MODELS.find((entry) => entry.model === model || entry.checkpoint === model);

  const resolveEndpoint = (): { url: string; local: boolean } | undefined => {
    const raw = deps.baseUrl()?.trim().replace(/\/+$/, '');
    if (!raw) return undefined;
    const local = isLoopbackUrl(raw);
    if (!local && !deps.allowLan) return undefined;
    return { url: raw, local };
  };

  return {
    id: COMFYUI_PROVIDER,
    access: 'api-key',
    models: () => COMFYUI_IMAGE_MODELS.map((entry) => entry.model),
    modelFor: (providerModel) =>
      COMFYUI_IMAGE_MODELS.find(
        (entry) =>
          entry.model === providerModel ||
          entry.checkpoint === providerModel ||
          entry.model === `comfyui/${providerModel}`,
      )?.model,

    async available(model): Promise<GenerationAvailability> {
      const spec = findSpec(model);
      if (!spec) return { ok: false, reason: 'no_model' };
      const endpoint = resolveEndpoint();
      if (!endpoint) return { ok: false, reason: 'not_configured' };
      if (deps.localOnly() && !endpoint.local) return { ok: false, reason: 'local_only' };
      return { ok: true };
    },

    estimate(model): ImageEstimate | null {
      return findSpec(model) ? { usd: 0, estimated: false } : null;
    },

    async generate(model, request: ImageRequest): AsyncResult<readonly GeneratedImage[]> {
      const started = now();
      const spec = findSpec(model);
      if (!spec) return err(UnknownModel({ provider: COMFYUI_PROVIDER, model }));
      const endpoint = resolveEndpoint();
      if (!endpoint) {
        return err(ModelNotConfigured({ provider: COMFYUI_PROVIDER, model: spec.checkpoint }));
      }
      if (deps.localOnly() && !endpoint.local) {
        return err(LocalOnly({ what: 'model' }));
      }

      const [width, height] = DIMENSIONS[request.size][request.aspect];
      const workflow = buildComfyUiImageWorkflow({
        checkpoint: spec.checkpoint,
        prompt: request.prompt,
        negativePrompt: request.avoid ?? '',
        width,
        height,
        count: request.count,
        seed: request.seed ?? 42,
        steps: request.size === 'draft' ? spec.steps : spec.steps * 2,
        cfg: spec.cfg,
      });

      const bodyText = JSON.stringify({ prompt: workflow, client_id: 'taalcut' });
      const safeEndpoint = scrubUrl(endpoint.url);

      let promptId: string;
      try {
        const res = await fetchFn(`${endpoint.url}/prompt`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: bodyText,
          ...(request.signal ? { signal: request.signal } : {}),
        });
        if (!res.ok) {
          return err(
            LocalServerUnreachable(
              { endpoint: safeEndpoint },
              { detail: `HTTP ${res.status} on /prompt` },
            ),
          );
        }
        const parsed = promptResponseSchema.safeParse(await res.json());
        if (!parsed.success) {
          return err(
            ModelProviderError(
              { provider: COMFYUI_PROVIDER, model },
              { detail: 'ComfyUI /prompt returned no prompt_id' },
            ),
          );
        }
        promptId = parsed.data.prompt_id;
      } catch (cause) {
        return err(
          LocalServerUnreachable(
            { endpoint: safeEndpoint },
            { detail: scrubSecrets(String(cause), []) },
          ),
        );
      }

      let files: z.infer<typeof historyFileSchema>[] | undefined;
      for (let poll = 0; poll < maxPolls; poll++) {
        try {
          const histRes = await fetchFn(
            `${endpoint.url}/history/${encodeURIComponent(promptId)}`,
            request.signal ? { signal: request.signal } : undefined,
          );
          if (histRes.ok) {
            const rawHistory = (await histRes.json()) as Record<string, unknown>;
            const entry = rawHistory[promptId];
            if (entry) {
              const parsed = historyEntrySchema.safeParse(entry);
              if (parsed.success) {
                const collected = Object.values(parsed.data.outputs).flatMap((o) => o.images ?? []);
                if (collected.length > 0) {
                  files = collected;
                  break;
                }
              }
            }
          }
        } catch (cause) {
          return err(
            LocalServerUnreachable(
              { endpoint: safeEndpoint },
              { detail: scrubSecrets(String(cause), []) },
            ),
          );
        }
        if (pollMs > 0) await new Promise((resolve) => setTimeout(resolve, pollMs));
      }

      if (!files || files.length === 0) {
        return err(
          ModelProviderError(
            { provider: COMFYUI_PROVIDER, model },
            { detail: `ComfyUI prompt ${promptId} produced no images` },
          ),
        );
      }

      const generated: GeneratedImage[] = [];
      for (const file of files.slice(0, request.count)) {
        const query = new URLSearchParams({
          filename: file.filename,
          subfolder: file.subfolder,
          type: file.type,
        });
        let bytes: Uint8Array;
        try {
          const viewRes = await fetchFn(
            `${endpoint.url}/view?${query.toString()}`,
            request.signal ? { signal: request.signal } : undefined,
          );
          if (!viewRes.ok) {
            return err(
              ModelProviderError(
                { provider: COMFYUI_PROVIDER, model },
                { detail: `ComfyUI /view failed (${viewRes.status})` },
              ),
            );
          }
          bytes = new Uint8Array(await viewRes.arrayBuffer());
        } catch (cause) {
          return err(
            LocalServerUnreachable(
              { endpoint: safeEndpoint },
              { detail: scrubSecrets(String(cause), []) },
            ),
          );
        }
        const facts = imageFacts(bytes);
        if (!facts || !fitsAspect(facts, request.aspect)) {
          return err(
            ModelProviderError(
              { provider: COMFYUI_PROVIDER, model },
              { detail: 'ComfyUI image bytes failed format or aspect verification' },
            ),
          );
        }
        const c2pa = deps.c2pa ? await deps.c2pa(bytes, facts.mediaType, request.signal) : 'unknown';
        generated.push({
          bytes,
          mediaType: facts.mediaType,
          width: facts.width,
          height: facts.height,
          provider: COMFYUI_PROVIDER,
          model: spec.checkpoint,
          access: 'api-key',
          costUsd: 0,
          c2pa,
        });
      }

      await deps.callLog.record({
        id: newId<'CloudCall'>(),
        startedAt: started,
        latencyMs: Math.max(0, now() - started),
        provider: COMFYUI_PROVIDER,
        model: spec.checkpoint,
        module: 'images',
        reasoning: 'off',
        local: endpoint.local,
        bytesSent: Buffer.byteLength(bodyText, 'utf8'),
        bytesReceived: generated.reduce((sum, item) => sum + item.bytes.byteLength, 0),
        inputTokens: 0,
        outputTokens: 0,
        cachedInputTokens: 0,
        cacheWriteTokens: 0,
        billed: { unit: 'image', quantity: generated.length },
        costUsd: 0,
        attempt: request.attempt ?? 1,
        outcome: 'ok',
        ...(request.trace?.runId ? { runId: request.trace.runId } : {}),
        ...(request.trace?.spanId ? { spanId: request.trace.spanId } : {}),
        ...(request.trace?.projectId ? { projectId: request.trace.projectId } : {}),
      });

      return ok(generated);
    },
  };
}
