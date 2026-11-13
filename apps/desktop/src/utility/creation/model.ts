// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { extname } from 'node:path';
import {
  err,
  InterchangeMediaSourceToken,
  ok,
  toTaalcutError,
  ValidationError,
  type AssetId,
  type AsyncResult,
  type Container,
} from '@taalcut/core';
import type { CreationModel, CreationModelRequest } from '@taalcut/agent';
import { ModelClientToken, ModelProfilesToken, ModelRuntimeToken } from '@taalcut/models';
import { presetFor } from '@taalcut/render';

export async function creationImage(
  container: Container,
  id: AssetId,
): AsyncResult<{ type: 'image'; data: string; mimeType: string }> {
  const resolved = await container.resolve(InterchangeMediaSourceToken).resolve([id]);
  if (!resolved.ok) return resolved;
  const media = resolved.value.get(id);
  if (!media?.path) return err(ValidationError({ field: 'assetId' }, { detail: 'Image is offline' }));
  const mime: Record<string, string> = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
  };
  const mimeType = mime[extname(media.path).toLowerCase()];
  if (!mimeType)
    return err(
      ValidationError({ field: 'assetId' }, { detail: 'Use a PNG, JPEG or WebP image for visual analysis' }),
    );
  try {
    const handle = await open(media.path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size > 8 * 1024 * 1024)
        return err(ValidationError({ field: 'assetId' }, { detail: 'Reference image exceeds 8 MiB' }));
      return ok({ type: 'image', data: (await handle.readFile()).toString('base64'), mimeType });
    } finally {
      await handle.close();
    }
  } catch (cause) {
    return err(toTaalcutError(cause));
  }
}

const moduleFor = (request: Pick<CreationModelRequest, 'imageAssetIds'>) =>
  request.imageAssetIds?.length ? ('vision' as const) : ('agent' as const);

export function creationModel(container: Container): CreationModel {
  const layout = JSON.stringify(
    [
      ['16:9', 'landscape'],
      ['9:16', 'device'],
      ['1:1', 'square'],
      ['4:5', 'portrait'],
    ].map(([format, id]) => {
      const preset = presetFor(id as 'landscape' | 'device' | 'square' | 'portrait');
      return { format, width: preset.width, height: preset.height, safe: preset.safe };
    }),
  );
  const constraints = (role: CreationModelRequest['role']) =>
    ['designer', 'reviewer'].includes(role)
      ? `\nThe actual output constraints are ${layout}. Keep readable text inside the exact safe rectangle at every hold, including all camera transforms. Give text explicit editable bounds that fit its words. Backgrounds and decorative brand geometry may fill the entire canvas.`
      : '';
  return {
    estimate(request) {
      const chain = container.resolve(ModelProfilesToken).resolve(moduleFor(request));
      const input =
        request.system.length +
        constraints(request.role).length +
        request.prompt.length +
        (request.imageAssetIds?.length ?? 0) * 8000;
      const prices = chain.ok
        ? chain.value.choices.map((choice) => {
            const model = container
              .resolve(ModelRuntimeToken)
              .findModel(choice.provider, choice.model, 'chat');
            // Input characters are an upper bound for normal text tokenization; include maximum output and retries.
            return model
              ? Math.ceil(input * model.price.input + request.maxTokens * model.price.output)
              : 10_000_000;
          })
        : [10_000_000];
      return Math.max(0, ...prices) * 2;
    },
    async complete(request) {
      const images = [];
      for (const id of request.imageAssetIds ?? []) {
        const image = await creationImage(container, id);
        if (!image.ok) return image;
        images.push(image.value);
      }
      const response = await container.resolve(ModelClientToken).complete({
        module: moduleFor(request),
        system: request.system + constraints(request.role),
        messages: [{ role: 'user', content: [{ type: 'text', text: request.prompt }, ...images] }],
        maxTokens: request.maxTokens,
        reasoning: 'high',
        temperature: 0.5,
        signal: request.signal,
        trace: { spanId: request.taskId, projectId: request.projectId },
      });
      if (!response.ok) return response;
      // Even incomplete JSON has a known provider charge. The director settles it before validating/repairing.
      return ok({
        text: response.value.text,
        usageMicros: response.value.planBilled ? 0 : Math.ceil(response.value.usage.costUsd * 1_000_000),
        tokens: response.value.usage.totalTokens,
      });
    },
  };
}
