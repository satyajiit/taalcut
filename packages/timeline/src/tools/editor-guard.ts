// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EDT1-OPS: the guard on likely mistakes in a docked run (SPEC "The Editor 2.0", the guard). When the person sent the
 * message from the editor's docked chat (the tool's `ctx.editor`), three changes are refused the first time in the
 * run, with what to call instead: a colour change to the whole video, a change to every clip's own sound, and an
 * insert of a shot that is already in the video. The words may still ask for it, so the refusal says how (`wholeVideo`,
 * or the same call again), and a repeat goes through. On the local 9B "make this one black and white" with only a
 * playhead greyed the whole video, "mute the waves" muted every clip, and "put the shot of boats in the harbour after
 * the dog" put in the first clip's shot again without searching the library.
 */
import { err, ok, type Result, type Timeline, type ToolEditorContext } from '@taalcut/core';
import { InvalidMove } from '../errors';
import { pointedClips, type NumberedClip } from './clip-refs';

/** How many runs the guard remembers refusing in, the oldest forgotten first. */
const REMEMBERED_RUNS = 200;

export type GuardedKind = 'colour' | 'sound' | 'insert';

export interface WholeVideoGuard {
  /** Refuses the first unflagged change of this kind in the run; ok when there's nothing to guard. */
  check(change: GuardedChange): Result<void>;
}

export interface GuardedChange {
  readonly kind: GuardedKind;
  readonly runId: string | undefined;
  readonly editor: ToolEditorContext | undefined;
  readonly timeline: Timeline;
  /** For an insert: the clip that already has the shot. */
  readonly sameShot?: NumberedClip;
}

const named = (clips: readonly NumberedClip[]) => clips.map((clip) => `clip ${clip.number}`).join(', ');
const numbers = (clips: readonly NumberedClip[]) => JSON.stringify(clips.map((clip) => clip.number));

function refusal(change: GuardedChange): string | null {
  if (change.kind === 'insert') {
    const clip = change.sameShot!;
    return (
      `That shot is already in the video, as clip ${clip.number}. A shot that isn't in the video yet ("the shot of ` +
      'boats in the harbour"): call findTools with query "library.search", search the library for it with ' +
      "library.search, then call timeline.insertClip with that hit's assetId and shotId. Only if the words ask for " +
      'this same shot again, make the same call again.'
    );
  }
  const pointed = pointedClips(change.timeline, change.editor!);
  if (change.kind === 'colour') {
    if (pointed.clips.length === 0) return null;
    const where =
      pointed.by === 'playhead' ? `The playhead is on ${named(pointed.clips)}` : `The person pointed at ${named(pointed.clips)}`;
    return (
      `This would change the whole video's colour. ${where}: give clips ${numbers(pointed.clips)} (or ["this"]) for ` +
      '"this", "here" or "it". Only if their words ask for the whole video ("the whole video", "everything", "all the ' +
      'clips"), call again with wholeVideo true.'
    );
  }
  const pointedAt =
    pointed.by === 'playhead' ? '' : ` The person pointed at ${named(pointed.clips)}: ${numbers(pointed.clips)}.`;
  return (
    `This changes every clip's own sound.${pointedAt} Give only the numbers of the clips the words point at or name ` +
    '(a clip named by what it shows is the clip whose shows has it). Only if their words ask for every clip ("all ' +
    'the clips", "everything"), call again with wholeVideo true.'
  );
}

export function createWholeVideoGuard(): WholeVideoGuard {
  // Run id + kind, in the order they were refused.
  const refused = new Set<string>();
  return {
    check(change) {
      if (!change.editor) return ok(undefined);
      const key = `${change.runId ?? ''}:${change.kind}`;
      if (change.runId !== undefined && refused.has(key)) return ok(undefined);
      const detail = refusal(change);
      if (detail === null) return ok(undefined);
      if (change.runId !== undefined) {
        refused.add(key);
        if (refused.size > REMEMBERED_RUNS * 3) refused.delete(refused.values().next().value as string);
      }
      return err(InvalidMove(undefined, { detail }));
    },
  };
}
