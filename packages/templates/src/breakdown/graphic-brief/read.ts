// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * DSG1-READ, after the breakdown job: a vision model reads each overlay's sheet (graphic-sheets.ts) with its facts,
 * one overlay at a time, and its answers are saved in the experiment (`graphics.json`) after each, so the same reel
 * again asks only about overlays it has no answer for. The model call is the app's (`GraphicModel`: the chat's model
 * when it sees images, on-device under Local only, temperature 0); a reference's frames need no consent card. An
 * answer that isn't JSON is asked for once more; then the overlay's brief comes from its facts alone. Never fails the
 * breakdown.
 */
import { randomUUID } from 'node:crypto';
import { readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AsyncResult } from '@taalcut/core';
import { z } from 'zod';
import type { BreakdownDraft } from '../draft';
import { graphicAnswerSchema, readGraphicAnswer, type GraphicAnswer } from './answer';
import { graphicFacts, reelOfDraft } from './facts';
import {
  GRAPHIC_BRIEF_MAX_TOKENS,
  GRAPHIC_BRIEF_PROMPT,
  GRAPHIC_BRIEF_SYSTEM,
  graphicQuestion,
  type PromptOverlay,
} from './prompt';

export const GRAPHICS_FILE = 'graphics.json';
const RETRY_NOTE = 'Your answer was not one JSON object. Answer again with the JSON object only.';

export type GraphicContent =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'image'; readonly data: string; readonly mimeType: 'image/png' };

export interface GraphicModelRequest {
  readonly system: string;
  readonly content: readonly GraphicContent[];
  readonly maxTokens: number;
}

export interface GraphicModelAnswer {
  /** Untrusted. */
  readonly text: string;
  readonly provider: string;
  readonly model: string;
  readonly local: boolean;
}

/** One vision call (the app serves it over its model client). */
export interface GraphicModel {
  complete(request: GraphicModelRequest, signal?: AbortSignal): AsyncResult<GraphicModelAnswer>;
}

const modelSchema = z.object({ provider: z.string(), model: z.string(), local: z.boolean() });
export const graphicsFileSchema = z.object({
  prompt: z.string(),
  model: modelSchema.nullable(),
  answers: z.record(z.string(), graphicAnswerSchema),
});
export type GraphicsFile = z.output<typeof graphicsFileSchema>;

/** The answers saved for a breakdown, when they came from this prompt; null otherwise. */
export async function readGraphicsFile(dir: string): Promise<GraphicsFile | null> {
  try {
    const parsed = graphicsFileSchema.safeParse(JSON.parse(await readFile(join(dir, GRAPHICS_FILE), 'utf8')));
    return parsed.success && parsed.data.prompt === GRAPHIC_BRIEF_PROMPT ? parsed.data : null;
  } catch {
    return null;
  }
}

async function save(dir: string, file: GraphicsFile): Promise<void> {
  const temporary = join(dir, `${GRAPHICS_FILE}.${randomUUID()}.tmp`);
  await writeFile(temporary, JSON.stringify(file));
  await rename(temporary, join(dir, GRAPHICS_FILE));
}

/** The overlays with a sheet, in the reel's order, with their facts: the prompt numbers them this way. */
export function promptOverlays(draft: BreakdownDraft): (PromptOverlay & { readonly sheet: string })[] {
  const reel = reelOfDraft(draft);
  const sheets = new Map((draft.graphicSheets ?? []).map((sheet) => [sheet.overlayId, sheet] as const));
  return draft.text
    .filter((overlay) => sheets.has(overlay.id))
    .map((overlay) => {
      const sheet = sheets.get(overlay.id)!;
      return { overlay, facts: graphicFacts(reel, overlay, sheet.lead), sheet: sheet.path };
    })
    .sort((a, b) => a.facts.start - b.facts.start);
}

export interface ReadGraphicsResult {
  readonly read: number;
  readonly failed: number;
  /** Overlays left to the facts because the time was up. */
  readonly skipped: number;
  readonly model: GraphicsFile['model'];
}

/**
 * How long the reading may take in `templates.breakdown`, whose whole call has 15 minutes beside the job and the
 * looks: once it is up no new question is asked, and the overlays left are briefed from the facts.
 */
export const GRAPHIC_READ_BUDGET_MS = 4 * 60_000;

/** Asks the model about every overlay with a sheet and no saved answer, in the reel's order; progress over them. */
export async function readGraphics(
  draft: BreakdownDraft,
  dir: string,
  model: GraphicModel,
  options: {
    readonly signal: AbortSignal;
    readonly onProgress?: (fraction: number) => void;
    readonly budgetMs?: number;
    readonly now?: () => number;
  },
): Promise<ReadGraphicsResult> {
  const now = options.now ?? Date.now;
  const until = now() + (options.budgetMs ?? GRAPHIC_READ_BUDGET_MS);
  const all = promptOverlays(draft);
  const file: GraphicsFile = (await readGraphicsFile(dir)) ?? {
    prompt: GRAPHIC_BRIEF_PROMPT,
    model: null,
    answers: {},
  };
  let read = 0;
  let failed = 0;
  let skipped = 0;
  for (const [index, item] of all.entries()) {
    if (options.signal.aborted) break;
    options.onProgress?.(index / all.length);
    if (file.answers[item.overlay.id]) continue;
    if (now() >= until) {
      skipped += 1;
      continue;
    }
    let image: string;
    try {
      image = (await readFile(join(dir, item.sheet))).toString('base64');
    } catch {
      failed += 1;
      continue;
    }
    const question = graphicQuestion(all, index);
    let answer: GraphicAnswer | null = null;
    for (const note of [null, RETRY_NOTE]) {
      const got = await model.complete(
        {
          system: GRAPHIC_BRIEF_SYSTEM,
          content: [
            { type: 'text', text: note ? `${question}\n${note}` : question },
            { type: 'image', data: image, mimeType: 'image/png' },
          ],
          maxTokens: GRAPHIC_BRIEF_MAX_TOKENS,
        },
        options.signal,
      );
      if (!got.ok) break;
      file.model ??= { provider: got.value.provider, model: got.value.model, local: got.value.local };
      answer = readGraphicAnswer(got.value.text);
      if (answer) break;
    }
    if (!answer) {
      failed += 1;
      continue;
    }
    file.answers[item.overlay.id] = answer;
    try {
      await save(dir, file);
      read += 1;
    } catch {
      failed += 1;
    }
  }
  options.onProgress?.(1);
  return { read, failed, skipped, model: file.model };
}
