// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The log, folded (SPEC, "Learned casting preferences"): where learning starts and the pairs since. In log order:
 *
 * - a write to the learned item that isn't the learner's own (a person's edit in Settings) is the new start, and
 *   the pairs before it are spent: the edit already says what the creator wants;
 * - deleting the item is a reset: the start is the defaults again, and the pairs before it are spent;
 * - the learner's own write, undone, puts the start back at the weights the item held before it and spends the pairs
 *   that led to it, so undo sticks instead of being learned again;
 * - every other undone entry counts for nothing; a swap or removal adds its pairs.
 *
 * Undo and redo are last-in first-out per project, so the entries still applied, in order, are exactly what
 * happened. The same entries give the same start and pairs, whatever order the reader returned them in.
 */
import {
  MEMORY_COMMANDS,
  memoryCommandPayloads,
  type AuditEntry,
  type MemoryData,
  fitCastingWeights,
  type CastingWeights,
} from '@taalcut/core';
import type { CastingConfig } from '../config';
import type { LearnerConfig } from './learner-config';
import type { PreferencePair } from './learner';
import { signalPairs, SIGNAL_COMMANDS } from './signals';

/** Who the learner's own memory commands are from. */
export const LEARNER_ORIGIN = { source: 'agent', actor: 'casting:learner' } as const;

/** Every command the learner reads from the log. */
export const LEARNER_LOG_COMMANDS: readonly string[] = [
  ...SIGNAL_COMMANDS,
  MEMORY_COMMANDS.create,
  MEMORY_COMMANDS.update,
  MEMORY_COMMANDS.remove,
];

export interface FoldedLog {
  readonly start: CastingWeights;
  readonly pairs: readonly PreferencePair[];
}

/** Log order: time, then each project's own sequence. */
function byLogOrder(a: AuditEntry, b: AuditEntry): number {
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  const left = a.projectId ?? '';
  const right = b.projectId ?? '';
  if (left !== right) return left < right ? -1 : 1;
  return a.sequence - b.sequence;
}

/** The weights a casting-weights item's data means under this config: inside the bounds, or the defaults. */
export function weightsOfData(
  data: MemoryData | null | undefined,
  base: CastingConfig,
): CastingWeights | null {
  if (data?.kind !== 'casting-weights') return null;
  return data.configVersion === base.version ? fitCastingWeights(data.weights, base.weights) : base.weights;
}

interface MemoryWrite {
  readonly memoryId: string;
  /** The item's weights after the write; null when it no longer holds casting weights; absent when untouched. */
  readonly weights?: CastingWeights | null;
  readonly deletes: boolean;
}

function memoryWrite(entry: AuditEntry, base: CastingConfig): MemoryWrite | null {
  if (entry.name === MEMORY_COMMANDS.create) {
    const parsed = memoryCommandPayloads[MEMORY_COMMANDS.create].safeParse(entry.payload);
    if (!parsed.success) return null;
    return {
      memoryId: parsed.data.memoryId,
      weights: weightsOfData(parsed.data.item.data, base),
      deletes: false,
    };
  }
  if (entry.name === MEMORY_COMMANDS.update) {
    const parsed = memoryCommandPayloads[MEMORY_COMMANDS.update].safeParse(entry.payload);
    if (!parsed.success) return null;
    const data = parsed.data.patch.data;
    return {
      memoryId: parsed.data.memoryId,
      ...(data === undefined ? {} : { weights: weightsOfData(data, base) }),
      deletes: false,
    };
  }
  if (entry.name === MEMORY_COMMANDS.remove) {
    const parsed = memoryCommandPayloads[MEMORY_COMMANDS.remove].safeParse(entry.payload);
    return parsed.success ? { memoryId: parsed.data.memoryId, deletes: true } : null;
  }
  return null;
}

/** Where the fold is: the start, what the learned item holds as far as the log says, and the pairs since. */
interface Fold {
  readonly start: CastingWeights;
  readonly held: CastingWeights;
  readonly pairs: PreferencePair[];
}

const startingAt = (weights: CastingWeights): Fold => ({ start: weights, held: weights, pairs: [] });

/** One write to the learned item, as the rules above read it. */
function afterWrite(fold: Fold, write: MemoryWrite, entry: AuditEntry, base: CastingConfig): Fold {
  const learners = entry.actor === LEARNER_ORIGIN.actor && entry.source === LEARNER_ORIGIN.source;
  // The creator took back what was learned: keep what the item held, and learn only from what comes next.
  if (entry.undone) return learners && write.weights ? startingAt(fold.held) : fold;
  if (write.deletes || write.weights === null) return startingAt(base.weights);
  if (!write.weights) return fold;
  return learners ? { ...fold, held: write.weights } : startingAt(write.weights);
}

export function foldLog(
  entries: readonly AuditEntry[],
  base: CastingConfig,
  config: LearnerConfig,
): FoldedLog {
  const castingItems = new Set<string>();
  let fold = startingAt(base.weights);
  for (const entry of [...entries].sort(byLogOrder)) {
    const write = memoryWrite(entry, base);
    if (!write) fold.pairs.push(...signalPairs(entry, config));
    else {
      if (write.weights) castingItems.add(write.memoryId);
      if (castingItems.has(write.memoryId)) fold = afterWrite(fold, write, entry, base);
    }
  }
  return { start: fold.start, pairs: fold.pairs };
}
