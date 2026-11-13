// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Consume one slot's observed local description or frame before requesting the next slot. */
import { untrustedBlock, type RequestView, type ToolCall } from './anthropic-view';
import { REFERENCE_SHOTS } from './make-flow-fixtures';
import { call, collectionSize, readCall, withReads, type Json } from './make-flow-reads';
import type { DemoTurn } from './script';

export function writeAnalystPage(
  view: RequestView,
  since: readonly ToolCall[],
  breakdownId: unknown,
  first: boolean,
): DemoTurn | undefined {
  const asked = since.filter((call) => call.name === 'templates_resolveCuts').at(-1);
  if (!asked) return call(view, 'templates_resolveCuts', { breakdownId });
  const looked = since.slice(since.indexOf(asked) + 1).filter((call) => call.name === 'vision_describeFrame');
  const intents: Json[] = [];
  const reads: { note?: string }[] = [];
  const count = collectionSize(view, asked, 'slots');
  for (let index = 0; index < (count ?? 200); index++) {
    const slot = readCall(view, asked, {
      index: `/slots/${index}/index`,
      frame: `/slots/${index}/frame`,
      looks: `/slots/${index}/context/looks`,
    });
    if (slot.turn) return withReads(slot.turn, ...reads);
    reads.push(slot);
    if (slot.json.index === undefined) break;
    const frame = slot.json.frame;
    const seen = looked.find((call) => call.input.path === frame);
    const local = typeof slot.json.looks === 'string' ? slot.json.looks : '';
    if (!local && typeof frame === 'string' && frame.trim() && !seen)
      return withReads(
        call(
          view,
          'vision_describeFrame',
          { path: frame, at: { value: 0, rate: 1 }, detail: 'low' },
          looked.length === 0 && first ? 'I will look at each shot to write what it is for.' : undefined,
        ),
        ...reads,
      );
    intents.push({
      slotIndex: slot.json.index,
      intent: intentFor(local || untrustedBlock(seen?.result ?? '', 1), Number(slot.json.index)),
    });
  }
  if (intents.length === 0) return undefined;
  return withReads(call(view, 'templates_setIntents', { breakdownId, intents }), ...reads);
}

/** Unknown/context-only shots keep the fixture's role at this position; camera motion remains measured. */
function intentFor(description: string, index: number) {
  const shot =
    REFERENCE_SHOTS.find((shot) => description.includes(shot.description)) ??
    REFERENCE_SHOTS[index % REFERENCE_SHOTS.length]!;
  const { motion: _measured, ...intent } = shot.intent;
  return intent;
}
