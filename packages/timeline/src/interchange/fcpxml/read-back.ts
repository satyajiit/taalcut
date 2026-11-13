// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * An FCPXML file read back to a cut list (P3-V5), the way Final Cut places things: spine items end to end at
 * their `offset`, connected items at their parent's offset plus their own offset in the parent's local time
 * (which starts at the parent's `start`). Times that don't land on a sequence frame read as off by a fraction
 * and fail the comparison, as Final Cut would insert a gap for them.
 */
import { err, FrameRate, ok, ValidationError, type Result } from '@taalcut/core';
import type { CutEntry, CutList } from '../cut-list';
import { add, secondsKey, secondsToFrames, subtract, ZERO, type Seconds } from '../seconds';
import { ASSET_ID_KEY } from './resources';
import { trackOfLane } from './story-items';
import { parseFcpTime } from './time';
import { attr, parseXml, type XmlNode } from './xml';

const find = (node: XmlNode, name: string): XmlNode | undefined =>
  node.children.find((child) => child.name === name);

function descend(root: XmlNode, path: readonly string[]): XmlNode | undefined {
  let node: XmlNode | undefined = root;
  for (const name of path) node = node ? find(node, name) : undefined;
  return node;
}

/** The sequence's frame rate, from its format's frameDuration (one frame is den/num seconds). */
function sequenceRate(root: XmlNode, sequence: XmlNode): FrameRate | null {
  const formatId = attr(sequence, 'format');
  const format = find(root, 'resources')?.children.find(
    (node) => node.name === 'format' && attr(node, 'id') === formatId,
  );
  const frame = parseFcpTime(format ? attr(format, 'frameDuration') : null);
  return frame ? FrameRate.of(Number(frame.den), Number(frame.num)) : null;
}

/** Asset element id → Taalcut asset id. */
function assetIds(root: XmlNode): Map<string, string> {
  const out = new Map<string, string>();
  for (const node of find(root, 'resources')?.children ?? []) {
    if (node.name !== 'asset') continue;
    const md = find(node, 'metadata')?.children.find((entry) => attr(entry, 'key') === ASSET_ID_KEY);
    const id = attr(node, 'id');
    if (id) out.set(id, (md && attr(md, 'value')) ?? id);
  }
  return out;
}

const STORY = new Set(['asset-clip', 'video', 'gap', 'audio']);

/** What every entry is read with: the asset ids and the sequence's frame rate. */
interface ReadContext {
  readonly assets: ReadonlyMap<string, string>;
  readonly rate: FrameRate;
}

const timeOf = (node: XmlNode, name: string): Seconds => parseFcpTime(attr(node, name)) ?? ZERO;

function entryOf(node: XmlNode, track: string, at: Seconds, context: ReadContext): CutEntry {
  const frames = (seconds: Seconds): number => secondsToFrames(seconds, context.rate) ?? Number.NaN;
  const gap = node.name === 'gap';
  const ref = attr(node, 'ref');
  return {
    track,
    kind: gap ? 'gap' : 'clip',
    start: frames(at),
    frames: frames(timeOf(node, 'duration')),
    assetId: gap || !ref ? null : (context.assets.get(ref) ?? ref),
    inPoint: gap ? null : secondsKey(timeOf(node, 'start')),
  };
}

/** A spine item's entry on V1, then each item connected to it on its lane's track. */
function itemCuts(item: XmlNode, context: ReadContext): CutEntry[] {
  const offset = timeOf(item, 'offset');
  const local = timeOf(item, 'start');
  const connected = item.children.flatMap((child) => {
    const lane = Number(attr(child, 'lane') ?? '0');
    if (!STORY.has(child.name) || lane === 0) return [];
    return [
      entryOf(child, trackOfLane(lane), add(offset, subtract(timeOf(child, 'offset'), local)), context),
    ];
  });
  return [entryOf(item, 'V1', offset, context), ...connected];
}

export function fcpxmlCutList(text: string): Result<CutList> {
  const parsed = parseXml(text);
  if (!parsed.ok) return parsed;
  const root = parsed.value;
  const sequence = descend(root, ['library', 'event', 'project', 'sequence']);
  const spine = sequence ? find(sequence, 'spine') : undefined;
  const rate = sequence ? sequenceRate(root, sequence) : null;
  if (!sequence || !spine || !rate)
    return err(ValidationError({ field: 'fcpxml' }, { detail: 'No sequence, spine or format' }));
  const context: ReadContext = { assets: assetIds(root), rate };
  return ok(spine.children.flatMap((item) => (STORY.has(item.name) ? itemCuts(item, context) : [])));
}

/** Whether every time in a document is written exactly (no float seconds anywhere): a structural check. */
export function inexactTimes(text: string): string[] {
  const parsed = parseXml(text);
  if (!parsed.ok) return [parsed.error.code];
  const bad: string[] = [];
  const visit = (node: XmlNode) => {
    for (const [key, value] of node.attrs)
      if (
        ['offset', 'start', 'duration', 'frameDuration', 'time'].includes(key) &&
        parseFcpTime(value) === null
      )
        bad.push(`${node.name}@${key}=${value}`);
    node.children.forEach(visit);
  };
  visit(parsed.value);
  return bad;
}
