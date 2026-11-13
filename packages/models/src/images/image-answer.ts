// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A provider's answer, read and checked before anyone keeps it: the documented shape (the provider file's
 * parse), then every image decodes, is a type we read, has the asked orientation, and there are as many
 * as asked.
 */
import { err, ok, type Result } from '@taalcut/core';
import { decodeBase64, fitsAspect, imageFacts, MIN_IMAGE_SIDE, type ImageFacts } from './image-bytes';
import type { ImageRouteSpec, ParsedImages } from './image-route-spec';
import type { ImageRequest } from './image-types';

export interface CheckedImage {
  readonly bytes: Uint8Array;
  readonly facts: ImageFacts;
}

export interface ImageAnswer {
  readonly parsed: ParsedImages;
  readonly images: readonly CheckedImage[];
}

/** Why an answer is refused, and how many images it carried (billed unless the provider bills all or nothing). */
export interface RefusedAnswer {
  readonly detail: string;
  readonly returned: number;
}

export function readImageAnswer(
  spec: Pick<ImageRouteSpec, 'parse' | 'preserveNativeAspect'>,
  body: string,
  request: Pick<ImageRequest, 'aspect'>,
  count: number,
): Result<ImageAnswer, RefusedAnswer> {
  const parsed = parseBody(spec, body);
  if (!parsed) return err({ detail: 'The answer is not the documented shape.', returned: 0 });
  const checked = checkImages(parsed.images, request, count, spec.preserveNativeAspect);
  return checked.ok
    ? ok({ parsed, images: checked.value })
    : err({ detail: checked.error, returned: parsed.images.length });
}

function parseBody(spec: Pick<ImageRouteSpec, 'parse'>, body: string): ParsedImages | undefined {
  try {
    return spec.parse(JSON.parse(body));
  } catch {
    // Not JSON: the caller reports the answer as invalid output.
    return undefined;
  }
}

function checkImages(
  encoded: readonly string[],
  request: Pick<ImageRequest, 'aspect'>,
  count: number,
  preserveNativeAspect = false,
): Result<CheckedImage[], string> {
  if (encoded.length !== count) return err(`Asked for ${count} images, got ${encoded.length}.`);
  const out: CheckedImage[] = [];
  for (const [index, text] of encoded.entries()) {
    const bytes = decodeBase64(text);
    const facts = bytes ? imageFacts(bytes) : undefined;
    if (!bytes || !facts) return err(`Image ${index + 1} is not a PNG, JPEG or WebP.`);
    if (Math.min(facts.width, facts.height) < MIN_IMAGE_SIDE)
      return err(`Image ${index + 1} is smaller than ${MIN_IMAGE_SIDE} pixels on its short side.`);
    if (!preserveNativeAspect && !fitsAspect(facts, request.aspect))
      return err(`Image ${index + 1} is ${facts.width}×${facts.height}, not ${request.aspect}.`);
    out.push({ bytes, facts });
  }
  return ok(out);
}
