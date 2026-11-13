// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { isId, ok, type AsyncResult, type ProductId, type ProductStore, type ProjectId } from '@taalcut/core';

export interface ProductMemoryContext {
  readonly productId: ProductId;
  readonly name: string;
  readonly instructions: string;
  readonly evidence: readonly { locator: string; digest: string; text: string }[];
}

/** Resolve through the campaign ledger so all chats for this product share the same current knowledge. */
export function productMemoryContext(store: ProductStore) {
  return async (input: { projectId?: string; query: string }): AsyncResult<ProductMemoryContext | null> => {
    if (!input.projectId || !isId(input.projectId)) return ok(null);
    const found = await store.forProject(input.projectId as ProjectId);
    if (!found.ok) return found;
    const product = found.value;
    if (!product) return ok(null);
    const docs = await store.knowledge(product.id, input.query);
    if (!docs.ok) return docs;
    const words = input.query.toLocaleLowerCase('en').match(/[\p{L}\p{N}]{3,}/gu) ?? [];
    const score = (text: string) =>
      words.filter((word) => text.toLocaleLowerCase('en').includes(word)).length;
    const { instructions, audience, tone, callToAction } = product.preferences;
    return ok({
      productId: product.id,
      name: product.name,
      instructions: [
        instructions,
        audience && `Audience: ${audience}`,
        tone && `Tone: ${tone}`,
        callToAction && `Call to action: ${callToAction}`,
      ]
        .filter(Boolean)
        .join('\n'),
      evidence: [...docs.value]
        .sort(
          (a, b) =>
            Number(b.locator === 'taalcut:index-coverage') - Number(a.locator === 'taalcut:index-coverage') ||
            score(b.title + b.text) - score(a.title + a.text),
        )
        .slice(0, 8)
        .map(({ locator, digest, text }) => ({ locator, digest, text: text.slice(0, 1200) })),
    });
  };
}

export function fitProductMemory(
  context: ProductMemoryContext | null,
  maxCharacters: number,
): ProductMemoryContext | undefined {
  if (!context || maxCharacters < 500) return undefined;
  const name = context.name.slice(0, 200);
  const instructions = context.instructions.slice(0, Math.min(1500, Math.floor(maxCharacters / 3)));
  let remaining = maxCharacters - instructions.length - name.length - 300;
  const evidence: ProductMemoryContext['evidence'][number][] = [];
  for (const doc of context.evidence) {
    const locator = doc.locator.slice(0, 300);
    remaining -= locator.length + doc.digest.length + 80;
    if (remaining <= 0) break;
    const text = doc.text.slice(0, remaining);
    evidence.push({ ...doc, locator, text });
    remaining -= text.length;
  }
  return { ...context, name, instructions, evidence };
}
