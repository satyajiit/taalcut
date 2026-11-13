// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** The edit commands of TIMELINE_COMMANDS, each a pure edit run through writeEdit. */
import {
  defineCommand,
  TIMELINE_COMMANDS,
  timelineCommandPayloads as payloads,
  type CastCandidate,
  type MediaRef,
} from '@taalcut/core';
import { castingFitCap } from '../casting/alternates';
import { CASTING_CONFIG } from '../casting/config';
import { mediaRef } from '../casting/result';
import { moveClip } from '../edits/move';
import { resyncBeats, setClipFit } from '../edits/qa-fixes';
import { applyCast, swapClip } from '../edits/swap';
import { editText, lockClip, moveText } from '../edits/text';
import { trimClip } from '../edits/trim';
import { trimToDuration } from '../edits/trim-duration';
import type { EditOptions } from '../edits/types';
import { candidateKey } from '../model/cast';
import { videoItems } from '../model/sequence';
import { writeEdit, type CommandDeps } from './context';
import { placedOver, placedWith, replaceAfter, requestTracks } from './replace-after';
import { profilesFor, resolveSwap } from './resolve';

export function createEditCommands(deps: CommandDeps) {
  const casting = deps.casting ?? CASTING_CONFIG;
  const options = (source: EditOptions['source']): EditOptions => ({
    source,
    ...(deps.config ? { config: deps.config } : {}),
    ...(deps.ids ? { ids: deps.ids } : {}),
  });

  const swap = defineCommand({
    name: TIMELINE_COMMANDS.swapClip,
    payload: payloads[TIMELINE_COMMANDS.swapClip],
    sideEffect: 'write',
    handle: (payload, context) =>
      writeEdit(deps, payload, context, async (timeline) => {
        const replacement = await resolveSwap(timeline, payload, deps.catalog, casting);
        if (!replacement.ok) return replacement;
        const swapped = swapClip(timeline, payload, replacement.value, options(context.source));
        if (!swapped.ok) return swapped;
        // FRM1-OVL: other people under the overlays now.
        return replaceAfter(deps, swapped.value, placedOver(swapped.value.timeline, [payload.clipId]), [
          payload.clipId,
        ]);
      }),
  });

  const trim = defineCommand({
    name: TIMELINE_COMMANDS.trimClip,
    payload: payloads[TIMELINE_COMMANDS.trimClip],
    sideEffect: 'write',
    handle: (payload, context) =>
      writeEdit(deps, payload, context, (timeline) => {
        const trimmed = trimClip(timeline, payload, options(context.source));
        // FRM1-OVL: a longer trim shows frames nobody tracked yet.
        if (trimmed.ok) requestTracks(deps, trimmed.value.timeline, [payload.clipId]);
        return trimmed;
      }),
  });

  const move = defineCommand({
    name: TIMELINE_COMMANDS.moveClip,
    payload: payloads[TIMELINE_COMMANDS.moveClip],
    sideEffect: 'write',
    handle: (payload, context) =>
      writeEdit(deps, payload, context, (timeline) => moveClip(timeline, payload, options(context.source))),
  });

  const text = defineCommand({
    name: TIMELINE_COMMANDS.editText,
    payload: payloads[TIMELINE_COMMANDS.editText],
    sideEffect: 'write',
    handle: (payload, context) =>
      writeEdit(deps, payload, context, async (timeline) => {
        const edited = editText(timeline, payload, options(context.source));
        if (!edited.ok) return edited;
        const rewordedIds = [
          ...(payload.itemId && payload.text !== undefined && !payload.remove && !payload.box
            ? [payload.itemId]
            : []),
          ...(payload.edits
            ?.filter((entry) => entry.text !== undefined && !entry.remove && !entry.box)
            .map((entry) => entry.itemId) ?? []),
        ];
        if (rewordedIds.length === 0) return edited;
        // FRM1-OVL: new words, a new size: placed again clear of heads and the other items.
        return replaceAfter(deps, edited.value, placedWith(edited.value.timeline, rewordedIds));
      }),
  });

  const textBox = defineCommand({
    name: TIMELINE_COMMANDS.moveText,
    payload: payloads[TIMELINE_COMMANDS.moveText],
    sideEffect: 'write',
    handle: (payload, context) =>
      writeEdit(deps, payload, context, (timeline) => moveText(timeline, payload, options(context.source))),
  });

  const lock = defineCommand({
    name: TIMELINE_COMMANDS.lockClip,
    payload: payloads[TIMELINE_COMMANDS.lockClip],
    sideEffect: 'write',
    handle: (payload, context) =>
      writeEdit(deps, payload, context, (timeline) => lockClip(timeline, payload, options(context.source))),
  });

  const recast = defineCommand({
    name: TIMELINE_COMMANDS.applyCast,
    payload: payloads[TIMELINE_COMMANDS.applyCast],
    sideEffect: 'write',
    handle: (payload, context) =>
      writeEdit(deps, payload, context, async (timeline) => {
        const picks: readonly CastCandidate[] = payload.picks.map((entry) => entry.pick);
        const profiles = await profilesFor(deps.catalog, picks);
        if (!profiles.ok) return profiles;
        const media = new Map<string, MediaRef>();
        for (const pick of picks) {
          const profile = profiles.value.get(candidateKey(pick));
          if (profile) media.set(candidateKey(pick), mediaRef(profile));
        }
        const cast = applyCast(timeline, payload.picks, {
          ...options(context.source),
          media,
          tau: casting.confidence.tau,
          fitCap: castingFitCap(casting),
        });
        if (!cast.ok) return cast;
        const slots = new Set(payload.picks.map((entry) => entry.slotId as string));
        const clips = videoItems(cast.value.timeline).flatMap((item) =>
          item.type === 'clip' && item.slotId && slots.has(item.slotId) ? [item.id] : [],
        );
        return replaceAfter(deps, cast.value, placedOver(cast.value.timeline, clips), clips);
      }),
  });

  const fit = defineCommand({
    name: TIMELINE_COMMANDS.setClipFit,
    payload: payloads[TIMELINE_COMMANDS.setClipFit],
    sideEffect: 'write',
    handle: (payload, context) =>
      writeEdit(deps, payload, context, (timeline) => setClipFit(timeline, payload, options(context.source))),
  });

  const resync = defineCommand({
    name: TIMELINE_COMMANDS.resyncBeats,
    payload: payloads[TIMELINE_COMMANDS.resyncBeats],
    sideEffect: 'write',
    handle: (payload, context) =>
      writeEdit(deps, payload, context, (timeline) => resyncBeats(timeline, options(context.source))),
  });

  const shorten = defineCommand({
    name: TIMELINE_COMMANDS.trimToDuration,
    payload: payloads[TIMELINE_COMMANDS.trimToDuration],
    sideEffect: 'write',
    handle: (payload, context) =>
      writeEdit(deps, payload, context, (timeline) =>
        trimToDuration(timeline, payload, options(context.source)),
      ),
  });

  const all = [swap, trim, move, text, textBox, lock, recast, fit, resync, shorten];
  return { swap, trim, move, text, textBox, lock, recast, fit, resync, shorten, all };
}
