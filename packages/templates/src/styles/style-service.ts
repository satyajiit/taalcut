// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * appContract.styles reads (P3-V10). `importImage` sniffs bytes from an injected reader and stores them
 * content-addressed; a path never becomes a command. `isDefault` follows `styles.default` when a settings
 * store is injected.
 */
import {
  DEFAULT_STYLE_SETTING,
  err,
  NotFoundError,
  ok,
  type AsyncResult,
  type SettingsStore,
  type Style,
  type StyleId,
  type StyleStore,
  type StyleSummary,
  type StylesService,
  type StyleUsage,
} from '@taalcut/core';
import { StyleNotFound } from '../errors';
import { sniffLogo } from './style-images';

export type ImageReader = (file: string) => AsyncResult<Uint8Array>;

export interface StyleServiceDeps {
  readonly store: StyleStore;
  readonly readFile: ImageReader;
  readonly settings?: SettingsStore;
}

function missing(error: { code: string }): boolean {
  return NotFoundError.is(error);
}

export function createStyleService({ store, readFile, settings }: StyleServiceDeps): StylesService {
  return {
    async list() {
      const listed = await store.list();
      if (!listed.ok || !settings) return listed;
      const chosen = await settings.get(DEFAULT_STYLE_SETTING);
      if (!chosen.ok) return chosen;
      const items: StyleSummary[] = listed.value.map((style) => ({
        ...style,
        isDefault: style.id === chosen.value,
      }));
      return ok(items);
    },

    async get(styleId: StyleId): AsyncResult<Style> {
      const found = await store.get(styleId);
      if (!found.ok) return missing(found.error) ? err(StyleNotFound()) : found;
      return ok(found.value);
    },

    async usedBy(styleId: StyleId): AsyncResult<StyleUsage> {
      const usage = await store.usedBy(styleId);
      if (!usage.ok) return missing(usage.error) ? err(StyleNotFound()) : usage;
      return usage;
    },

    async importImage(file: string) {
      const bytes = await readFile(file);
      if (!bytes.ok) return bytes;
      const sniffed = sniffLogo(bytes.value);
      if (!sniffed.ok) return sniffed;
      const stored = await store.putAsset(bytes.value, sniffed.value.mediaType);
      if (!stored.ok) return stored;
      return ok({
        sha256: stored.value.sha256,
        mediaType: sniffed.value.mediaType,
        width: sniffed.value.width,
        height: sniffed.value.height,
      });
    },
  };
}
