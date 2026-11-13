// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A template head's set in the template index (LRN1-TPL; core's `templates/template-vectors.ts` names the kinds and
 * ids): one document vector (document purpose) and one vector per slot with intent words (query purpose, casting's
 * text, so fit and casting read the same vector). Ids carry their text's digest, so the set is content-addressed: a
 * changed text is a new id, and an unchanged one keeps its stored vector.
 */
import {
  templateVectorId,
  type EmbeddingPurpose,
  type SlotId,
  type Template,
  type TemplateId,
  type TemplateVectorKind,
} from '@taalcut/core';
import { sha256Hex } from '../store/change-key';
import { slotIntentText, templateDocumentText, type TemplateDocumentMeta } from './texts';

/** The digest a vector id carries for its text: the first 16 hex characters of its sha256. */
export function textDigest(text: string): string {
  return sha256Hex(text).slice(0, 16);
}

/** The id of a slot's intent vector for these words (what fit looks up with casting's text). */
export function intentVectorId(templateId: TemplateId, slotId: SlotId, text: string): string {
  return templateVectorId({ kind: 'intent', templateId, slotId, digest: textDigest(text) });
}

export function documentVectorId(templateId: TemplateId, text: string): string {
  return templateVectorId({ kind: 'template', templateId, digest: textDigest(text) });
}

export interface PlannedVector {
  readonly id: string;
  readonly kind: TemplateVectorKind;
  readonly text: string;
  readonly purpose: EmbeddingPurpose;
}

/** The vectors a head should have: its document first, then its slots' intents in slot order. */
export function plannedVectors(template: Template, meta: TemplateDocumentMeta): PlannedVector[] {
  const document = templateDocumentText(template, meta);
  const planned: PlannedVector[] = [
    { id: documentVectorId(template.id, document), kind: 'template', text: document, purpose: 'document' },
  ];
  for (const slot of template.slots) {
    const text = slotIntentText(slot);
    if (text)
      planned.push({
        id: intentVectorId(template.id, slot.id, text),
        kind: 'intent',
        text,
        purpose: 'query',
      });
  }
  return planned;
}
