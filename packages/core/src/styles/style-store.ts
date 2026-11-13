// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Styles as stored (P3-V10): @taalcut/library implements the store, registered by StyleStoreToken; writes with
 * a CommandContext are staged in the command's unit of work. Logos live content-addressed beside template
 * assets; main serves them at app://media/styles/<sha256>.<ext> (styleAssetUrl).
 */
import '../basics/zod-config';
import { z } from 'zod';
import { idSchema, type StyleId, type TemplateId } from '../basics/ids';
import type { AsyncResult } from '../basics/result';
import type { CommandContext } from '../commands/definition';
import { createToken } from '../di/token';
import {
  STYLE_KINDS,
  styleColoursSchema,
  styleLogoSchema,
  type LogoMediaType,
  type Style,
} from './style-schema';

export const styleSummarySchema = z.object({
  id: idSchema<'Style'>(),
  name: z.string(),
  kind: z.enum(STYLE_KINDS),
  revision: z.int().min(1),
  colours: styleColoursSchema,
  logo: styleLogoSchema.pick({ asset: true, mediaType: true, width: true, height: true }).nullable(),
  /** DEFAULT_STYLE_SETTING names it. */
  isDefault: z.boolean(),
  updatedAt: z.int().nonnegative(),
});
export type StyleSummary = z.output<typeof styleSummarySchema>;

/** What names a Style, so it can't be deleted from under them. */
export const styleUsageSchema = z.object({
  timelines: z.int().nonnegative(),
  templates: z.int().nonnegative(),
});
export type StyleUsage = z.output<typeof styleUsageSchema>;

export interface StyleListFilter {
  /** Looks made from this template (any version, or one). */
  readonly madeFrom?: { readonly templateId: TemplateId; readonly version?: number };
}

export interface StyleStore {
  create(style: Style, context?: CommandContext): AsyncResult<Style>;
  /** core.conflict unless the stored revision is `expectedRevision`. */
  put(style: Style, expectedRevision: number, context?: CommandContext): AsyncResult<Style>;
  get(styleId: StyleId): AsyncResult<Style>;
  list(filter?: StyleListFilter): AsyncResult<StyleSummary[]>;
  remove(styleId: StyleId, context?: CommandContext): AsyncResult<void>;
  /** Timelines (by document) and template versions that name it. */
  usedBy(styleId: StyleId): AsyncResult<StyleUsage>;
  putAsset(
    bytes: Uint8Array,
    mediaType: LogoMediaType,
  ): AsyncResult<{ readonly sha256: string; readonly bytes: number }>;
  /** The asset's file, for main's app://media/styles/… route. */
  assetPath(sha256: string): AsyncResult<string>;
}

export const StyleStoreToken = createToken<StyleStore>('core.styleStore');
