// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * DSG1-READ: a vision model's answer about one overlay, read as data. The model is asked for one JSON object; a
 * fenced or chatty answer is searched for its first object, every field is checked on its own, and a field that
 * isn't what was asked for is unknown (null) rather than a guess, so the measured facts decide it. Pure.
 */
import {
  GRAPHIC_BRIEF_KINDS,
  GRAPHIC_PLATFORMS,
  GRAPHIC_STORY_ROLES,
  type GraphicBriefKind,
  type GraphicPlatform,
  type GraphicStoryRole,
} from '@taalcut/core';
import { z } from 'zod';

export interface GraphicAnswer {
  readonly graphic: boolean | null;
  readonly reason: string | null;
  readonly kind: GraphicBriefKind | null;
  readonly what: string | null;
  readonly role: GraphicStoryRole | null;
  /** 1-based number of the text it answers, as the prompt numbered them. */
  readonly answers: number | null;
  readonly platform: GraphicPlatform | null;
  readonly look: string | null;
  readonly shadow: boolean | null;
  readonly avatar: boolean | null;
}

export const graphicAnswerSchema = z.object({
  graphic: z.boolean().nullable(),
  reason: z.string().max(300).nullable(),
  kind: z.enum(GRAPHIC_BRIEF_KINDS).nullable(),
  what: z.string().max(200).nullable(),
  role: z.enum(GRAPHIC_STORY_ROLES).nullable(),
  answers: z.int().min(1).max(100).nullable(),
  platform: z.enum(GRAPHIC_PLATFORMS).nullable(),
  look: z.string().max(300).nullable(),
  shadow: z.boolean().nullable(),
  avatar: z.boolean().nullable(),
});

/** The first balanced `{…}` in the text, outside strings; null without one. */
export function firstObject(text: string): string | null {
  const start = text.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let inString = false;
  for (let index = start; index < text.length; index++) {
    const char = text[index]!;
    if (inString) {
      if (char === '\\') index++;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) return text.slice(start, index + 1);
  }
  return null;
}

const squash = (value: string) => value.toLowerCase().replace(/[^a-z]/g, '');

function oneOf<T extends string>(options: readonly T[], value: unknown): T | null {
  if (typeof value !== 'string') return null;
  return options.find((option) => squash(option) === squash(value)) ?? null;
}

function flag(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === 'yes') return true;
  if (value === 'false' || value === 'no') return false;
  return null;
}

function words(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const line = value.replace(/\s+/g, ' ').trim();
  if (line.length === 0) return null;
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

function number(value: unknown): number | null {
  const parsed = typeof value === 'string' ? Number.parseInt(value.replace(/^#/, ''), 10) : value;
  return typeof parsed === 'number' && Number.isInteger(parsed) && parsed >= 1 && parsed <= 100
    ? parsed
    : null;
}

/** The answer's fields, each checked on its own; null when the text holds no JSON object. */
export function readGraphicAnswer(text: string): GraphicAnswer | null {
  const json = firstObject(text);
  if (!json) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  return graphicAnswerSchema.parse({
    graphic: flag(value.graphic),
    reason: words(value.reason, 300),
    kind: oneOf(GRAPHIC_BRIEF_KINDS, value.kind),
    what: words(value.what, 200),
    role: oneOf(GRAPHIC_STORY_ROLES, value.role),
    answers: number(value.answers),
    platform: oneOf(GRAPHIC_PLATFORMS, value.platform),
    look: words(value.look, 300),
    shadow: flag(value.shadow),
    avatar: flag(value.avatar),
  });
}
