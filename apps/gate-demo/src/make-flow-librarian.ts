// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The scripted Librarian reads only the request it receives, including its earlier page decisions. */
import { resultJson, type RequestView, type ToolCall } from './anthropic-view';
import {
  call,
  callsTo,
  list,
  need,
  notes as notesOf,
  record,
  use,
  withNote,
  withReads,
  type Json,
} from './make-flow-reads';
import type { DemoTurn } from './script';

export function librarianTurn(view: RequestView): DemoTurn {
  const finished = handoff(view);
  if (finished) return finished;
  const input = record(view.input);
  const projectId = input.projectId;
  const brief = input.brief ? record(input.brief) : null;
  let templateId = input.templateId;
  let plannedNote: string | undefined;
  if (brief) {
    const planned = need(view, 'templates_planFromFormat', { templateId: '/templateId' });
    if ('missing' in planned)
      return call(view, 'templates_planFromFormat', {
        projectId,
        formatId: brief.formatId ?? 'vlog',
        targetSeconds: brief.targetSeconds ?? 30,
        brief: brief.text,
      });
    if (planned.turn) return planned.turn;
    templateId = planned.json.templateId;
    plannedNote = planned.note;
  }
  const cast = {
    projectId,
    template: { id: templateId },
    mode: brief ? 'story' : 'template',
    variants: 1,
    seed: 1,
    locked: [],
    exclude: [],
    ...(brief ? { pool: { query: 'trip' } } : {}),
  };
  const casting = callsTo(view, 'timeline_cast').at(-1);
  const chosen = castChoices(view, casting);
  if ('missing' in chosen)
    return withNote(call(view, 'timeline_cast', cast, 'Casting your shots.'), plannedNote);
  if ('turn' in chosen) return withNote(chosen.turn, plannedNote);
  const { rerank, note } = chosen;
  return withNote(
    call(view, 'timeline_assemble', { ...cast, ...(rerank.length > 0 ? { rerank } : {}) }),
    [plannedNote, note].filter(Boolean).join('\n'),
  );
}

/** Assembly's receipt and inputs are sufficient after compaction removes the earlier casting reads. */
function handoff(view: RequestView): DemoTurn | undefined {
  const assembled = callsTo(view, 'timeline_assemble').at(-1);
  if (!assembled) return undefined;
  const answer = need(view, 'timeline_assemble', {
    timelineIds: '/timelineIds',
    revisions: '/revisions',
    lowConfidence: '/lowConfidence',
  });
  if ('missing' in answer) return undefined;
  if (answer.turn) return answer.turn;
  if (!('json' in answer)) return undefined;
  return withReads(
    use('handOff', {
      timelineIds: list(answer.json.timelineIds),
      revisions: list(answer.json.revisions),
      lowConfidenceSlots: answer.json.lowConfidence ?? 0,
      reranked: list(assembled.input.rerank).length,
      templateId: record(assembled.input.template).id,
    }),
    answer,
  );
}

const CHOICE = '[stand-in cast choice] ';
const PARTIAL = '[stand-in cast page] ';
const STORED = /^Stored as (?:artifact|result) (\S+) \(/;
const PAGE = /^Bytes (\d+)-(\d+) of (\d+)\.\n<untrusted source="artifact">\n([\s\S]*)\n<\/untrusted>$/;
type Choices = { rerank: Json[]; note?: string } | { turn: DemoTurn } | { missing: true };
/** A fixture model keeps the given order; real models evaluate the candidate descriptions. */
function orderOf(slot: Json): Json | undefined {
  const candidates = list(slot.candidates).map(record);
  if (typeof slot.slotId !== 'string' || candidates.some((candidate) => typeof candidate.shotId !== 'string'))
    return undefined;
  return { slotId: slot.slotId, order: candidates.map((candidate) => candidate.shotId) };
}

/** These test-only decisions are in the model's actual request, never a closure or access to the tool store. */
function decisions(view: RequestView, id: string): Map<number, Json> {
  const out = new Map<number, Json>();
  for (const saved of notesOf(view, CHOICE)) {
    if (saved.id !== id || !Number.isInteger(saved.index) || typeof saved.slotId !== 'string') continue;
    if (!Array.isArray(saved.order) || saved.order.some((shot) => typeof shot !== 'string')) continue;
    out.set(saved.index as number, { slotId: saved.slotId, order: saved.order });
  }
  return out;
}

/** Recover a compacted cast's address/count only from the remaining observed reads and choices. */
function castSource(
  view: RequestView,
  casting: ToolCall | undefined,
): Choices | { id: string; count?: number } {
  const remembered = [...notesOf(view, CHOICE), ...notesOf(view, PARTIAL)].at(-1);
  const read = callsTo(view, 'readArtifact').findLast((call) =>
    /^\/rerank\/[0-2]$/.test(String(call.input.path)),
  );
  const id =
    STORED.exec(casting?.result ?? '')?.[1] ?? (casting ? undefined : (read?.input.id ?? remembered?.id));
  if (!id) {
    if (!casting) return { missing: true };
    const value = resultJson(casting.result);
    if (!value) return { turn: { text: `I could not read the casting: ${casting.result.slice(0, 300)}` } };
    return { rerank: list(value.rerank).map((slot) => orderOf(record(slot)) ?? {}) };
  }
  if (typeof id !== 'string') return { turn: { text: 'I could not read the casting result handle.' } };
  const inventory = /<untrusted source="result-fields">\n([\s\S]*?)\n<\/untrusted>/.exec(
    casting?.result ?? '',
  )?.[1];
  const fields = resultJson(inventory ?? '');
  const rememberedCount = [...notesOf(view, CHOICE), ...notesOf(view, PARTIAL)].findLast(
    (note) => note.id === id,
  )?.count;
  const count = /^array\((\d+)\)$/.exec(String(fields?.rerank))?.[1] ?? rememberedCount;
  // The tool's contract has at most three reranks. Older artifact receipts have no field inventory.
  const total = count === undefined ? 3 : Number(count);
  if (!Number.isInteger(total) || total < 0 || total > 3)
    return { turn: { text: 'I could not read the casting rerank count.' } };
  return { id, ...(count === undefined ? {} : { count: total }) };
}

function castChoices(view: RequestView, casting: ToolCall | undefined): Choices {
  const source = castSource(view, casting);
  if (!('id' in source)) return source;
  const { id, count } = source;
  const total = count ?? 3;
  const saved = decisions(view, id);
  const rerank: Json[] = [];
  const notes: string[] = [];
  for (let index = 0; index < total; index++) {
    const prior = saved.get(index);
    if (prior) {
      rerank.push(prior);
      continue;
    }
    const selected = readSlot(view, id, index, count === undefined ? undefined : total);
    if ('turn' in selected) return { turn: withNote(selected.turn, notes.join('\n')) };
    if (selected.missing) {
      if (count === undefined) break;
      return { turn: { text: 'I could not read a rerank listed in the casting result.' } };
    }
    const choice = orderOf(selected.value);
    if (!choice) return { turn: { text: 'I could not read the casting slot and candidate ids.' } };
    rerank.push(choice);
    notes.push(
      `${CHOICE}${JSON.stringify({ id, index, ...(count === undefined ? {} : { count: total }), ...choice })}`,
    );
  }
  return { rerank, ...(notes.length > 0 ? { note: notes.join('\n') } : {}) };
}

function partialPage(view: RequestView, id: string, index: number) {
  const partial = notesOf(view, PARTIAL).findLast((note) => note.id === id && note.index === index);
  const valid =
    partial &&
    typeof partial.text === 'string' &&
    Number.isInteger(partial.next) &&
    Number(partial.next) > 0 &&
    Number.isInteger(partial.total) &&
    Number(partial.total) > Number(partial.next);
  return valid
    ? { text: String(partial.text), next: Number(partial.next), total: Number(partial.total) }
    : { text: '', next: 0, total: Infinity };
}

/** Read one exact JSON Pointer selection; consumed pages can be reread using the same public tool. */
function readSlot(
  view: RequestView,
  id: string,
  index: number,
  count?: number,
): { value: Json; missing?: false } | { missing: true } | { turn: DemoTurn } {
  const path = `/rerank/${index}`;
  const prefix = `JSON Pointer ${JSON.stringify(path)} from ${id}.\n`;
  let { text, next, total } = partialPage(view, id, index);
  for (const read of view.calls) {
    if (read.name !== 'readArtifact' || read.input.id !== id || read.input.path !== path) continue;
    if (read.result === `Error core.not_found: JSON Pointer ${JSON.stringify(path)} does not exist.`)
      return { missing: true };
    if (read.result.startsWith('Error '))
      return { turn: { text: `I could not read the casting: ${read.result}` } };
    if (!read.result.startsWith(prefix)) continue;
    const page = PAGE.exec(read.result.slice(prefix.length));
    if (!page || Number(page[1]) !== next) continue;
    text += page[4];
    next = Number(page[2]);
    total = Number(page[3]);
  }
  if (next < total)
    return {
      turn: withNote(
        use('readArtifact', { id, path, offset: next }),
        next > 0
          ? `${PARTIAL}${JSON.stringify({ id, index, next, total, text, ...(count === undefined ? {} : { count }) })}`
          : undefined,
      ),
    };
  const value = resultJson(text);
  return value ? { value } : { turn: { text: 'I could not parse the selected casting result.' } };
}
