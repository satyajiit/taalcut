// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Style command names and payloads (P3-V10), so the brand kit editor, the agent and ⌘K dispatch them typed.
 * Handlers: @taalcut/templates. Styles are app-wide (`projectId: null`); every edit's inverse is the internal
 * `style.restore` with the whole previous Style (null: it didn't exist). `style.delete` is destructive and refused
 * while anything names the Style (`templates.style_in_use`).
 */
import '../basics/zod-config';
import { z } from 'zod';
import { idSchema } from '../basics/ids';
import { defineSetting } from '../ports/preferences';
import { styleInputSchema, styleSchema } from './style-schema';

export const STYLE_COMMANDS = {
  create: 'style.create',
  /** Names the revision it was made on: core.conflict otherwise. */
  update: 'style.update',
  rename: 'style.rename',
  /** destructive. */
  remove: 'style.delete',
  setDefault: 'style.setDefault',
  /** Internal: every Style edit's inverse. */
  restore: 'style.restore',
} as const;

const styleId = idSchema<'Style'>();
const appWide = { projectId: z.null().default(null) };

export const styleCommandPayloads = {
  [STYLE_COMMANDS.create]: z.object({ ...appWide, styleId, style: styleInputSchema }),
  [STYLE_COMMANDS.update]: z.object({
    ...appWide,
    styleId,
    baseRevision: z.int().min(1),
    patch: styleInputSchema
      .omit({ kind: true })
      .partial()
      .refine((patch) => Object.keys(patch).length > 0, { message: 'Nothing to change' }),
  }),
  [STYLE_COMMANDS.rename]: z.object({ ...appWide, styleId, name: z.string().trim().min(1).max(80) }),
  [STYLE_COMMANDS.remove]: z.object({ ...appWide, styleId }),
  [STYLE_COMMANDS.setDefault]: z.object({ ...appWide, styleId: styleId.nullable() }),
  [STYLE_COMMANDS.restore]: z.object({ ...appWide, styleId, style: styleSchema.nullable() }),
};

/** The Style new timelines get (the timeline lane's assembly). */
export const DEFAULT_STYLE_SETTING = defineSetting('styles.default', idSchema<'Style'>().nullable(), null);
