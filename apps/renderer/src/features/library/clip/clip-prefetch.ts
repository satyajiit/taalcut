// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A clip's page read ahead (UX4, B18): pointing at a Library tile, or giving it focus, asks for the clip in full
 * (`library.asset`) before the click, so the page has it the moment it opens and its frame grows at once instead of
 * holding the old picture while the read runs. The tile's Play and Find similar read the same answer. An answer is
 * kept a short while only: the page itself reads the clip again and follows its changes.
 */
import { callRpc, type AssetDetail, type AssetId, type Result } from '@taalcut/core';
import type { Backend } from '../../../backend/contract';

/** How long a read-ahead answer stands in for the page's own read. */
const FRESH_MS = 15_000;
/** Answers kept at once: the tiles pointed at lately. */
const KEPT = 24;

interface Entry {
  readonly at: number;
  readonly answer: Promise<Result<AssetDetail>>;
  /** The answer, once it has come and was good. */
  value?: AssetDetail;
}

const entries = new Map<AssetId, Entry>();

function fresh(entry: Entry | undefined, now: number): entry is Entry {
  return entry !== undefined && now - entry.at < FRESH_MS;
}

/** Reads the clip ahead, once while it is fresh; resolves with the answer. */
export function prefetchClip(
  backend: Backend,
  assetId: AssetId,
  now = Date.now(),
): Promise<Result<AssetDetail>> {
  const known = entries.get(assetId);
  if (fresh(known, now)) return known.answer;
  const answer = callRpc(backend.library.asset({ assetId }));
  const entry: Entry = { at: now, answer };
  entries.set(assetId, entry);
  void answer.then((result) => {
    if (result.ok && entries.get(assetId) === entry) entry.value = result.value;
    else if (!result.ok) entries.delete(assetId);
  });
  while (entries.size > KEPT) entries.delete(entries.keys().next().value!);
  return answer;
}

/** The clip read ahead, if its answer is here and fresh: the page's first frame draws from it. */
export function prefetchedClip(assetId: AssetId, now = Date.now()): AssetDetail | undefined {
  const entry = entries.get(assetId);
  return fresh(entry, now) ? entry.value : undefined;
}

/** The read ahead, still on its way or here, for the page's own first read to take instead of asking again. */
export function pendingClip(assetId: AssetId, now = Date.now()): Promise<Result<AssetDetail>> | undefined {
  const entry = entries.get(assetId);
  return fresh(entry, now) ? entry.answer : undefined;
}

/** Forgets every answer (tests). */
export function forgetPrefetched(): void {
  entries.clear();
}
