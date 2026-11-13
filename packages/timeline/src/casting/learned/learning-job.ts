// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The learning job (SPEC, "Learned casting preferences"). It runs in the process that owns casting (the agent's):
 * at start, and a few seconds after a person's swap or removal lands, is undone or redone. Each run reads the log,
 * folds it, fits the weights and, when they changed, writes the one learned item through MEMORY_COMMANDS (create,
 * or update over the revision it read), so the write has undo and an audit row like any other.
 */
import {
  createSerialQueue,
  err,
  MEMORY_COMMANDS,
  newId,
  ok,
  PERSON_SOURCES,
  toTaalcutError,
  type AsyncResult,
  type AuditEntry,
  type CommandBus,
  type CommandOrigin,
  type DispatchOptions,
  type MemoryId,
  type MemoryStore,
  type TaalcutError,
  castingWeightsText,
  sameCastingWeights,
  type CastingWeights,
} from '@taalcut/core';
import { CASTING_CONFIG, type CastingConfig } from '../config';
import { LEARNED_WEIGHTS_FILTER } from './config-source';
import { foldLog, LEARNER_LOG_COMMANDS, LEARNER_ORIGIN, weightsOfData } from './fold';
import { learnCastingWeights } from './learner';
import { LEARNER_CONFIG, type LearnerConfig } from './learner-config';
import { SIGNAL_COMMANDS } from './signals';

export interface CastingSignalLog {
  /** Every audit entry with one of these names, from every project and the app-wide history, in any order. */
  entries(names: readonly string[], signal?: AbortSignal): AsyncResult<readonly AuditEntry[]>;
}

export interface CastingLearnerDeps {
  readonly log: CastingSignalLog;
  readonly store: Pick<MemoryStore, 'list'>;
  /** Core's command bus, by name (memory.create, memory.update). */
  readonly commands: {
    dispatch(
      name: string,
      payload: unknown,
      origin: CommandOrigin,
      options?: DispatchOptions,
    ): AsyncResult<unknown>;
  };
  readonly base?: CastingConfig;
  readonly config?: LearnerConfig;
  readonly ids?: () => MemoryId;
}

export type LearnOutcome = 'created' | 'updated' | 'unchanged' | 'too-few';

export interface LearnRun {
  readonly outcome: LearnOutcome;
  readonly weights: CastingWeights;
  /** The pairs' total weight since the start. */
  readonly evidence: number;
  readonly pairs: number;
}

export interface CastingLearner {
  run(signal?: AbortSignal): AsyncResult<LearnRun>;
}

export function createCastingLearner(deps: CastingLearnerDeps): CastingLearner {
  const base = deps.base ?? CASTING_CONFIG;
  const config = deps.config ?? LEARNER_CONFIG;
  const ids = deps.ids ?? (() => newId<'MemoryItem'>());

  return {
    async run(signal) {
      const entries = await deps.log.entries(LEARNER_LOG_COMMANDS, signal);
      if (!entries.ok) return entries;
      const folded = foldLog(entries.value, base, config);
      const learned = learnCastingWeights({
        start: folded.start,
        defaults: base.weights,
        pairs: folded.pairs,
        tau: base.confidence.tau,
      });
      const summary = { weights: learned.weights, evidence: learned.evidence, pairs: folded.pairs.length };
      if (!learned.moved) return ok({ ...summary, outcome: 'too-few' });

      const listed = await deps.store.list(LEARNED_WEIGHTS_FILTER);
      if (!listed.ok) return listed;
      const item = listed.value[0];
      const current = item ? weightsOfData(item.data, base) : null;
      if (
        current
          ? sameCastingWeights(current, learned.weights)
          : sameCastingWeights(base.weights, learned.weights)
      )
        return ok({ ...summary, outcome: 'unchanged' });

      const data = {
        kind: 'casting-weights' as const,
        configVersion: base.version,
        defaults: base.weights,
        weights: learned.weights,
        pairs: folded.pairs.length,
      };
      const text = castingWeightsText(learned.weights, base.weights);
      const done = item
        ? await deps.commands.dispatch(
            MEMORY_COMMANDS.update,
            { memoryId: item.id, baseRevision: item.revision, patch: { text, data } },
            LEARNER_ORIGIN,
          )
        : await deps.commands.dispatch(
            MEMORY_COMMANDS.create,
            { memoryId: ids(), item: { scope: { kind: 'user' }, text, source: 'learned', data } },
            LEARNER_ORIGIN,
          );
      if (!done.ok) return done;
      return ok({ ...summary, outcome: item ? 'updated' : 'created' });
    },
  };
}

export interface FollowOptions {
  /** Quiet time after the last signal before a run. Default 5 s. */
  readonly delayMs?: number;
  /** A run that failed: the next signal tries again. */
  onError(error: TaalcutError): void;
}

const LEARN_DELAY_MS = 5_000;
const PEOPLE: ReadonlySet<string> = new Set(PERSON_SOURCES);

/** Runs the learner a little after a person's swap or removal lands, is undone or redone; one run at a time. */
export function followCastingSignals(
  bus: Pick<CommandBus, 'subscribe'>,
  learner: CastingLearner,
  options: FollowOptions,
): { stop(): void; idle(): Promise<void> } {
  const signals = new Set(SIGNAL_COMMANDS);
  let timer: ReturnType<typeof setTimeout> | null = null;
  const runs = createSerialQueue();
  let stopped = false;

  const learn = () => {
    timer = null;
    void runs.run(async () => {
      if (stopped) return;
      // A run that throws is a failed run like any other: the next signal tries again.
      const result = await learner.run().catch((cause: unknown) => err(toTaalcutError(cause)));
      if (!result.ok) options.onError(result.error);
    });
  };
  const unsubscribe = bus.subscribe((change) => {
    if (stopped || !signals.has(change.name) || !PEOPLE.has(change.origin.source)) return;
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(learn, options.delayMs ?? LEARN_DELAY_MS);
  });
  return {
    stop() {
      stopped = true;
      unsubscribe();
      if (timer !== null) clearTimeout(timer);
    },
    idle: () => runs.settled(),
  };
}
