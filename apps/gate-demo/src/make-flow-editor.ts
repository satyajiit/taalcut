// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The scripted Editor remembers only the observed fields needed for its next edit. */
import { resultJson, type RequestView, type ToolCall } from './anthropic-view';
import { editRequestTurn } from './make-flow-edit';
import { draftThenHandOff } from './make-flow-maker';
import {
  call,
  callsTo,
  collectionSize,
  list,
  notes,
  readCall,
  record,
  use,
  withNote,
  withReads,
  type Json,
} from './make-flow-reads';
import type { DemoTurn } from './script';
import { findClip } from './make-flow-clip-read';
export { findClip } from './make-flow-clip-read';

const TEXTS = ['Goa, day one', 'Market morning', 'Best street food', 'With the crew', 'Last light'];
const FIX_TOOLS = new Set([
  'timeline_swapClip',
  'timeline_trimClip',
  'timeline_setClipFit',
  'timeline_resyncBeats',
  'timeline_trimToDuration',
  'timeline_moveText',
]);
const isFixCall = (call: ToolCall) => FIX_TOOLS.has(call.name) || call.name.startsWith('captions_');

const TEXT_PROGRESS = '[stand-in text] ';

/** Only an observed successful edit advances the cursor; earlier item data is then no longer needed. */
function editTexts(view: RequestView, input: Json, timeline: ToolCall): DemoTurn | undefined {
  const saved = notes(view, TEXT_PROGRESS).at(-1);
  let index = typeof saved?.index === 'number' ? saved.index : 0;
  const writes = callsTo(view, 'timeline_editText').filter(
    (call) => call.result !== '' && !call.result.startsWith('Error '),
  );
  if (typeof saved?.pending === 'string' && writes.some((call) => call.input.itemId === saved.pending))
    index++;
  const count = collectionSize(view, timeline, 'texts');
  for (; index < (count ?? 200); index++) {
    const checkpoint = (turn: DemoTurn, pending?: unknown) =>
      withNote(turn, TEXT_PROGRESS + JSON.stringify({ index, ...(pending ? { pending } : {}) }));
    const item = readCall(view, timeline, {
      itemId: `/texts/${index}/itemId`,
      origin: `/texts/${index}/origin`,
    });
    if (item.turn) return checkpoint(item.turn);
    if (item.json.itemId === undefined) break;
    if (item.json.origin === 'user' || writes.some((call) => call.input.itemId === item.json.itemId))
      continue;
    return checkpoint(
      withReads(
        call(view, 'timeline_editText', {
          projectId: input.projectId,
          timelineId: input.timelineId,
          itemId: item.json.itemId,
          text: TEXTS[index % TEXTS.length],
        }),
        item,
      ),
      item.json.itemId,
    );
  }
  return undefined;
}

function editorFixes(input: Json): Json[] {
  const swapped = new Set<unknown>();
  return list(input.fixes)
    .map(record)
    .filter((fix) => {
      if (fix.kind === 'command') return true;
      if (fix.kind !== 'agent' || fix.instructionKey !== 'qa.fixes.swapFromAlternates') return false;
      const clipId = record(fix.params).clipId;
      if (swapped.has(clipId)) return false;
      swapped.add(clipId);
      return true;
    });
}

function fixTurn(view: RequestView, input: Json, timeline: ToolCall): DemoTurn | undefined {
  const target = { projectId: input.projectId, timelineId: input.timelineId };
  const fix = editorFixes(input)[view.calls.filter(isFixCall).length];
  if (!fix) return undefined;
  if (fix.kind === 'command')
    return call(view, String(fix.command).replace('.', '_'), { ...record(fix.payload), ...target });
  const clipId = record(fix.params).clipId;
  const clip = findClip(view, timeline, clipId);
  if (clip.turn) return clip.turn;
  if (!clip.json.slotId) return { text: 'I could not find the requested clip and slot in this timeline.' };
  if (clip.json.locked || clip.json.userPick)
    return { text: 'I kept the locked or user-picked clip instead of swapping it.' };
  const looked = callsTo(view, 'timeline_findAlternates').find((c) => c.input.slotId === clip.json.slotId);
  if (!looked)
    return withReads(
      call(view, 'timeline_findAlternates', { timelineId: input.timelineId, slotId: clip.json.slotId }),
      clip,
    );
  const found = readCall(view, looked, {
    assetId: '/candidates/0/assetId',
    shotId: '/candidates/0/shotId',
    sourceStart: '/candidates/0/sourceStart',
  });
  if (found.turn) return withReads(found.turn, clip);
  if (!found.json.assetId) return { text: 'The selected clip has no alternate candidate to use.' };
  return withReads(
    call(view, 'timeline_swapClip', {
      ...target,
      clipId,
      media: { assetId: found.json.assetId, shotId: found.json.shotId ?? null },
      ...(found.json.sourceStart ? { sourceStart: found.json.sourceStart } : {}),
      from: 'alternate',
    }),
    clip,
    found,
  );
}

/** The last observed write is authoritative; its small revision receipt does not require the old timeline. */
export function revisionRead(view: RequestView, timeline: ToolCall) {
  const written = [...view.calls]
    .reverse()
    .find(
      (c) =>
        (c.name.startsWith('timeline_') || c.name.startsWith('captions_')) &&
        (typeof resultJson(c.result)?.revision === 'number' ||
          (c.input.projectId && c.name !== 'timeline_findAlternates')),
    );
  return readCall(view, written ?? timeline, { revision: '/revision' });
}

export function editorTurn(view: RequestView, drafts = false): DemoTurn {
  const input = record(view.input);
  // A draft proves the editing phase finished. Its actual input records exactly which revision was rendered.
  const drafted = callsTo(view, 'render_draft').at(-1);
  if (drafts && drafted) return draftThenHandOff(view, input, drafted.input.revision);
  const first = callsTo(view, 'timeline_get')[0];
  if (!first) return call(view, 'timeline_get', { timelineId: input.timelineId });
  const revision = revisionRead(view, first);
  if (revision.turn) return revision.turn;
  if (typeof revision.json.revision !== 'number')
    return { text: 'I could not observe the current timeline revision.' };
  if (input.request)
    return withReads(
      editRequestTurn(view, input, () => revision.json.revision),
      revision,
    );
  if (list(input.fixes).length === 0) {
    const text = editTexts(view, input, first);
    if (text) return withReads(text, revision);
  }
  const fixing = fixTurn(view, input, first);
  if (fixing) return withReads(fixing, revision);
  return withReads(
    drafts
      ? draftThenHandOff(view, input, revision.json.revision)
      : use('handOff', { timelineId: input.timelineId, revision: revision.json.revision }),
    revision,
  );
}
