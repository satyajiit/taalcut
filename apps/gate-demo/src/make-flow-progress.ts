// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Carry concise observed workflow receipts through the agent's four-turn view, never through process memory. */
import { resultJson, type RequestView, type ToolCall } from './anthropic-view';
import { createHash } from 'node:crypto';
import { notes, sourceOf, withNote } from './make-flow-select';
import type { DemoTurn } from './script';

const PREFIX = '[stand-in progress] ';
const READS = new Set(['timeline_get', 'templates_resolveCuts', 'comments_list', 'timeline_cast']);
const ACKS = new Set(['workspace_write', 'graphics_design', 'comments_reply']);
const KEEP = new Set([
  ...READS,
  ...ACKS,
  'templates_planFromFormat',
  'templates_finalise',
  'timeline_assemble',
  'render_draft',
  'video_done',
  'graphics_list',
  'workspace_lint',
  'workspace_place',
  'timeline_findAlternates',
]);
const key = (call: ToolCall) =>
  call.checkpointKey ??
  `${call.id ?? 'observed'}:${call.name}:${createHash('sha256').update(JSON.stringify(call.input)).digest('hex').slice(0, 12)}`;
const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

function previous(view: RequestView): ToolCall[] {
  const saved = notes(view, PREFIX).at(-1)?.calls;
  if (!Array.isArray(saved)) return [];
  return saved.flatMap((entry: unknown) => {
    const row = object(entry);
    return typeof row.id === 'string' && typeof row.name === 'string' && typeof row.result === 'string'
      ? [
          {
            id: row.id,
            name: row.name,
            input: object(row.input),
            result: row.result,
            ...(typeof row.sourceKey === 'string' ? { sourceKey: row.sourceKey } : {}),
            ...(typeof row.checkpointKey === 'string' ? { checkpointKey: row.checkpointKey } : {}),
          },
        ]
      : [];
  });
}

export function resumeProgress(view: RequestView): RequestView {
  const saved = new Map(previous(view).map((call) => [key(call), call]));
  const current = new Set(view.calls.map(key));
  const observed = view.calls.map((call) => {
    const prior = saved.get(key(call));
    return prior?.sourceKey ? { ...call, sourceKey: prior.sourceKey } : call;
  });
  return { ...view, calls: [...saved.values()].filter((call) => !current.has(key(call))).concat(observed) };
}

function receipt(call: ToolCall, skill: string | null): string | undefined {
  if (/^(?:Stored as (?:artifact|result)|\[Taalcut\] Read result) /.test(call.result)) return call.result;
  if (call.result.startsWith('Error ')) return call.name === 'video_done' ? call.result : undefined;
  const value = resultJson(call.result);
  if (!value) return undefined;
  if (ACKS.has(call.name)) return '{}';
  if (READS.has(call.name)) return Buffer.byteLength(call.result) <= 512 ? call.result : undefined;
  if (call.name === 'render_draft') {
    const render = object(value.render);
    return JSON.stringify({
      render: { id: render.id },
      ...(skill === 'render.reviewer'
        ? {
            passed: value.passed,
            failing: Array.isArray(value.failing)
              ? value.failing.map((row: unknown) => ({ fixes: object(row).fixes }))
              : [],
          }
        : {}),
    });
  }
  const fields =
    call.name === 'templates_planFromFormat'
      ? ['templateId']
      : call.name === 'templates_finalise'
        ? ['templateId', 'version', 'slotCount', 'breakdownId', 'unconfirmedCuts']
        : call.name === 'timeline_assemble'
          ? ['timelineIds', 'revisions', 'lowConfidence']
          : call.name === 'workspace_place'
            ? ['revision', 'itemIds', 'compositionId']
            : call.name === 'workspace_lint'
              ? ['passed', 'findings']
              : call.name === 'video_done'
                ? ['renderId', 'timelineId', 'revision']
                : ['revision'];
  const selected = Object.fromEntries(
    fields.filter((field) => Object.hasOwn(value, field)).map((field) => [field, value[field]]),
  );
  return Object.keys(selected).length > 0 ? JSON.stringify(selected) : undefined;
}

export function carryProgress(view: RequestView, turn: DemoTurn): DemoTurn {
  const calls = new Map(previous(view).map((call) => [key(call), call]));
  for (const call of view.calls) {
    if (!KEEP.has(call.name) && !call.name.startsWith('timeline_') && !call.name.startsWith('captions_'))
      continue;
    const result = receipt(call, view.skill);
    if (result === undefined) continue;
    // The successful action's target/revision is relevant; HTML, text payloads and filesystem paths are not.
    const input = Object.fromEntries(
      Object.entries(call.input).filter(([name]) =>
        ['timelineId', 'revision', 'itemId', 'clipId', 'slotId', 'template', 'rerank', 'reasons'].includes(
          name,
        ),
      ),
    );
    // Current visible calls are chronological; refreshing a saved key must keep that order too.
    calls.delete(key(call));
    calls.set(key(call), {
      id: call.id ?? key(call),
      checkpointKey: key(call),
      sourceKey: sourceOf(view, call),
      name: call.name,
      input,
      result,
    });
  }
  if (view.skill === 'timeline.maker' || view.skill === 'timeline.editor') {
    const text = [...calls.entries()].filter(([, call]) => call.name === 'timeline_editText');
    // The visible text cursor acknowledges older writes; only the latest revision receipt is still needed.
    for (const [id] of text.slice(0, -1)) calls.delete(id);
  }
  if (view.skill === 'timeline.maker') {
    const draft = [...calls.entries()].findLast(([, call]) => call.name === 'render_draft');
    if (draft) {
      // The observed draft input owns the finished revision; earlier editing receipts are no longer needed.
      for (const [id, call] of calls) if (id !== draft[0] && call.name !== 'video_done') calls.delete(id);
    }
  }
  return calls.size > 0 ? withNote(turn, `${PREFIX}${JSON.stringify({ calls: [...calls.values()] })}`) : turn;
}
