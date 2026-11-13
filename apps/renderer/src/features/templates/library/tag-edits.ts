// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Tagging one template or many at once (P3-V14), as plain functions so it is unit tested apart from the dialog:
 * each tag is on every template, on none, or on some (left as it is unless the person picks a side). A tag is
 * normalised as core's templateTagSchema does it (NFC, lower case, spaces to one hyphen), so `शादी` is a tag.
 */
import type { TemplateId, TemplateSummary } from '@taalcut/core';

export type TagState = 'on' | 'off' | 'mixed';
export const MAX_TEMPLATE_TAGS = 12;
const TAG = /^[\p{L}\p{M}\p{N}]+(?:-[\p{L}\p{M}\p{N}]+)*$/u;

/** The tag as the library stores it, or null when it can't be one. */
export function normaliseTag(input: string): string | null {
  const tag = input.trim().normalize('NFC').toLowerCase().replace(/\s+/gu, '-');
  return tag.length >= 1 && tag.length <= 32 && TAG.test(tag) ? tag : null;
}

type Tagged = Pick<TemplateSummary, 'id' | 'tags'>;

/** Each tag on any of the templates, in first-seen order, with whether all, some or none carry it. */
export function tagStates(templates: readonly Tagged[]): Map<string, TagState> {
  const counts = new Map<string, number>();
  for (const template of templates)
    for (const tag of template.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  return new Map(
    [...counts].map(([tag, count]) => [tag, count === templates.length ? 'on' : 'mixed'] as const),
  );
}

/** The next state when the box is pressed: some → all → none → all. */
export const nextState = (state: TagState): TagState => (state === 'on' ? 'off' : 'on');

export type TagPlan =
  | { readonly ok: true; readonly steps: readonly { templateId: TemplateId; tags: string[] }[] }
  | { readonly ok: false; readonly tooMany: number };

/** One template.setTags per template whose tags change; refused when one would carry more than twelve. */
export function planTags(templates: readonly Tagged[], states: ReadonlyMap<string, TagState>): TagPlan {
  const steps: { templateId: TemplateId; tags: string[] }[] = [];
  for (const template of templates) {
    const kept = template.tags.filter((tag) => states.get(tag) !== 'off');
    const added = [...states]
      .filter(([tag, state]) => state === 'on' && !kept.includes(tag))
      .map(([tag]) => tag);
    const tags = [...kept, ...added];
    if (tags.length > MAX_TEMPLATE_TAGS) return { ok: false, tooMany: tags.length };
    const same = tags.length === template.tags.length && tags.every((tag, i) => tag === template.tags[i]);
    if (!same) steps.push({ templateId: template.id, tags });
  }
  return { ok: true, steps };
}
