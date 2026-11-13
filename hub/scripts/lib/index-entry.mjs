// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * One index row. The shape must match `@taalcut/core` `hubIndexEntrySchema`
 * (id, version, name, description, handle, language, tags, formatId, trendFreshness,
 * forkedFrom, duration as { value, rate: { num, den } }, slotCount, bpm, slotStrip,
 * sha256, createdAt, updatedAt). This package cannot import core.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

export function indexEntry(doc, raw, rel, root, nowMs) {
  const structure = doc.structure;
  const slots = Array.isArray(structure?.slots) ? structure.slots : [];
  const rate = structure?.canvas?.rate;
  const times = gitTimes(root, rel, nowMs);
  return {
    id: doc.id,
    version: doc.version,
    name: doc.name,
    description: doc.description,
    handle: doc.handle,
    language: doc.language ?? null,
    tags: doc.tags ?? [],
    formatId: doc.formatId ?? null,
    trendFreshness: doc.trendFreshness ?? null,
    forkedFrom: doc.forkedFrom ?? null,
    duration: structure.duration,
    slotCount: slots.length,
    bpm: structure.beatMap && typeof structure.beatMap.bpm === 'number' ? structure.beatMap.bpm : null,
    slotStrip: slots.map((slot) => framesAt(slot.duration, rate)),
    sha256: createHash('sha256').update(raw).digest('hex'),
    createdAt: times.createdAt,
    updatedAt: times.updatedAt,
  };
}

function framesAt(time, canvasRate) {
  if (!time || !canvasRate) return 0;
  if (time.rate?.num * canvasRate.den === canvasRate.num * time.rate?.den) return time.value;
  const numerator = time.value * time.rate.den * canvasRate.num;
  const denominator = time.rate.num * canvasRate.den;
  return Math.round(numerator / denominator);
}

function gitTimes(root, rel, nowMs) {
  const updated = gitStamp(root, ['log', '-1', '--format=%ct', '--', rel]);
  const created = gitStamp(root, ['log', '--follow', '--diff-filter=A', '--format=%ct', '--', rel]);
  if (updated === null) return { createdAt: nowMs, updatedAt: nowMs };
  return { createdAt: (created ?? updated) * 1000, updatedAt: updated * 1000 };
}

function gitStamp(root, args) {
  try {
    const text = execFileSync('git', args, {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const lines = text
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    const stamp = lines.at(-1);
    if (!stamp || !/^\d+$/.test(stamp)) return null;
    return Number(stamp);
  } catch {
    return null;
  }
}
