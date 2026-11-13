// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * appContract.styles (P3-V10), owner agent: read-only, served by @taalcut/templates' service; changes are
 * STYLE_COMMANDS. `importImage` reads a picked image (files.pickFile purpose 'brandImage'), checks it from its
 * bytes (type, size, pixels) and stores it content-addressed: not a command, so a path never enters the audit
 * log; `templates.style_image_invalid` otherwise.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { idSchema, type StyleId } from '../basics/ids';
import type { AsyncResult } from '../basics/result';
import { implementContract, ipc } from '../ipc/contract';
import { unwrapRpc } from '../ipc/errors';
import { sha256Schema } from '../templates/template-parts';
import { styleSummarySchema, styleUsageSchema, type StyleSummary, type StyleUsage } from './style-store';
import { LOGO_MEDIA_TYPES, styleSchema, type LogoMediaType, type Style } from './style-schema';

export const importedImageSchema = z.object({
  sha256: sha256Schema,
  mediaType: z.enum(LOGO_MEDIA_TYPES),
  width: z.int().positive(),
  height: z.int().positive(),
});
export type ImportedImage = z.output<typeof importedImageSchema>;

const styleId = z.object({ styleId: idSchema<'Style'>() });

export const stylesContract = {
  list: ipc.output(z.array(styleSummarySchema)),
  get: ipc.input(styleId).output(styleSchema),
  usedBy: ipc.input(styleId).output(styleUsageSchema),
  importImage: ipc.input(z.object({ path: z.string().min(1).max(4096) })).output(importedImageSchema),
};

/** What the agent process serves appContract.styles from (@taalcut/templates' service). */
export interface StylesService {
  list(): AsyncResult<StyleSummary[]>;
  get(styleId: StyleId): AsyncResult<Style>;
  usedBy(styleId: StyleId): AsyncResult<StyleUsage>;
  importImage(path: string): AsyncResult<{
    readonly sha256: string;
    readonly mediaType: LogoMediaType;
    readonly width: number;
    readonly height: number;
  }>;
}

export function stylesRouter(service: StylesService) {
  const os = implementContract(stylesContract);
  return os.router({
    list: os.list.handler(async () => unwrapRpc(await service.list())),
    get: os.get.handler(async ({ input }) => unwrapRpc(await service.get(input.styleId))),
    usedBy: os.usedBy.handler(async ({ input }) => unwrapRpc(await service.usedBy(input.styleId))),
    importImage: os.importImage.handler(async ({ input }) =>
      unwrapRpc(await service.importImage(input.path)),
    ),
  });
}
