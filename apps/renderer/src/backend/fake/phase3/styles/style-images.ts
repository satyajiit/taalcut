// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * styles.importImage as the fake answers it (P3-V10). The real service reads the picked file's bytes and
 * sniffs them (packages/templates style-images.ts); the fake has no bytes, so the picked path decides, the same
 * way every time (e2e and demos pick these names through files.pickFile):
 *
 * - not .png, .jpg, .jpeg or .webp (e.g. `logo.gif`, `logo.svg`) → `templates.style_image_invalid` 'type'
 * - a name with "huge" in it (`huge-logo.png`) → 'size' (over 5 MiB)
 * - a name with "giant" in it (`giant-logo.png`) → 'pixels' (over 4096 px a side)
 * - anything else → a PNG, JPEG or WebP of 512 × 512 (a name with "wide" in it: 1200 × 400), whose sha256 is
 *   the path's.
 */
import { err, ok, type ImportedImage, type LOGO_FILE_EXTENSIONS, type Result } from '@taalcut/core';
import { styleImageInvalid } from './style-errors';

const MEDIA_TYPES = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
} as const satisfies Record<(typeof LOGO_FILE_EXTENSIONS)[number], ImportedImage['mediaType']>;

const isLogoExtension = (value: string): value is keyof typeof MEDIA_TYPES => value in MEDIA_TYPES;

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function importImage(path: string): Promise<Result<ImportedImage>> {
  const name = path.split(/[\\/]/).pop()?.toLowerCase() ?? '';
  const extension = name.includes('.') ? (name.split('.').pop() ?? '') : '';
  if (!isLogoExtension(extension)) return err(styleImageInvalid('type'));
  if (name.includes('huge')) return err(styleImageInvalid('size'));
  if (name.includes('giant')) return err(styleImageInvalid('pixels'));
  const wide = name.includes('wide');
  return ok({
    sha256: await sha256(path),
    mediaType: MEDIA_TYPES[extension],
    width: wide ? 1200 : 512,
    height: wide ? 400 : 512,
  });
}
