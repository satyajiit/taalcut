// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What the template index (TemplateIndexToken, LRN1-TPL) holds and how its vectors are named. Every vector's
 * `sourceId` is its template's id, so a template's set is replaced or removed by `sourceId`. Two kinds:
 *
 * - `template`: one document vector per template (its name, tags, slot intents, on-screen text and pacing in words),
 *   for template search;
 * - `intent`: one per slot of the head, the slot's intent embedded exactly as casting embeds it (same text, query
 *   purpose), so fit and casting read it instead of embedding again.
 *
 * Ids carry the first 16 hex characters of the sha256 of the text embedded: `template:<templateId>:<digest>`,
 * `intent:<templateId>:<slotId>:<digest>`. A reader that rebuilds a text and finds its id knows the vector is that
 * text's, and a reconciler sees a stale vector as a missing id. @taalcut/templates writes them; readers parse them here.
 */
import { parseId, type SlotId, type TemplateId } from '../basics/ids';

export const TEMPLATE_VECTOR_KINDS = ['template', 'intent'] as const;
export type TemplateVectorKind = (typeof TEMPLATE_VECTOR_KINDS)[number];

/** The digest an id carries: the first 16 hex characters of the embedded text's sha256. */
export const TEMPLATE_VECTOR_DIGEST_PATTERN = /^[0-9a-f]{16}$/;

export type TemplateVectorKey =
  | { readonly kind: 'template'; readonly templateId: TemplateId; readonly digest: string }
  | {
      readonly kind: 'intent';
      readonly templateId: TemplateId;
      readonly slotId: SlotId;
      readonly digest: string;
    };

export function templateVectorId(key: TemplateVectorKey): string {
  return key.kind === 'template'
    ? `template:${key.templateId}:${key.digest}`
    : `intent:${key.templateId}:${key.slotId}:${key.digest}`;
}

/** The key an id names, or null when it isn't a template-index id. */
export function parseTemplateVectorId(id: string): TemplateVectorKey | null {
  const parts = id.split(':');
  const digest = parts.at(-1) ?? '';
  if (!TEMPLATE_VECTOR_DIGEST_PATTERN.test(digest)) return null;
  const templateId = parseId<'Template'>(parts[1]);
  if (!templateId.ok) return null;
  if (parts[0] === 'template' && parts.length === 3) return { kind: 'template', templateId: templateId.value, digest };
  if (parts[0] !== 'intent' || parts.length !== 4) return null;
  const slotId = parseId<'TemplateSlot'>(parts[2]);
  return slotId.ok ? { kind: 'intent', templateId: templateId.value, slotId: slotId.value, digest } : null;
}
