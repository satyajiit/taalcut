// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* eslint-disable lingui/no-unlocalized-strings -- error details as the real handlers write them: data for logs, not UI */

/**
 * P3-B6, P3-V13: the commands the media cards dispatch that no other fake serves, each mirroring its real
 * handler (voice.removeVoiceover and music.setDucking are the export fakes', make/p3/fake-export-commands.ts).
 * Graphics (packages/render): graphics.edit (its time and its design's words, HFW1: a designed graphic places and
 * sizes itself), graphics.remove and graphics.useProposal, core.not_found for a graphic that isn't there,
 * render.graphic_invalid for a move, a resize or a variable its design hasn't, timeline.not_found, a stale revision
 * core.conflict; every
 * write is a new revision with an inverse. Consent (packages/audio, person sources only): voice.recordConsent
 * claims a stopped capture once and checks it (terms, 60 s to 10 minutes, the line heard),
 * voice.withdrawConsent, voice.createClone (refused under Local only) and voice.deleteClone.
 */
import {
  ConflictError,
  defineCommand,
  err,
  GRAPHICS_COMMANDS,
  graphicsCommandPayloads,
  LocalOnly,
  NotFoundError,
  ok,
  PERSON_SOURCES,
  RationalTime,
  TIMELINE_COMMANDS,
  VOICE_CONSENT_COMMANDS,
  VOICE_CONSENT_TERMS_VERSION,
  ValidationError,
  voiceConsentCommandPayloads,
  type AnyCommand,
  type ErrorParams,
  type GraphicItem,
  type ProjectId,
  type TaalcutError,
  type Timeline,
  type TimelineId,
  type VoiceConsentId,
} from '@taalcut/core';
import { timelineError } from '../make/edits';
import type { Phase3Deps } from './phase3-deps';
import type { FakeVoiceCapture, FakeVoiceCaptureOptions } from './fake-voice-capture';

/** audio's and render's errors as values (each package defines its codes once). */
const codeError = (code: string, params?: ErrorParams): TaalcutError => ({
  code,
  messageKey: `errors.${code}`,
  retryable: false,
  ...(params ? { params } : {}),
});
const RECORDING_MS = { min: 60_000, max: 600_000 } as const;

interface StoredConsent {
  readonly speakerName: string;
  clone: { readonly voiceId: string; readonly name: string } | null;
}

interface Target {
  readonly projectId: ProjectId;
  readonly timelineId: TimelineId;
  readonly revision?: number | undefined;
}

export function createFakeMediaCommands(
  deps: Pick<Phase3Deps, 'make' | 'localOnly'>,
  voiceCapture: Pick<FakeVoiceCapture, 'captures'>,
  options: Pick<FakeVoiceCaptureOptions, 'heard'> = {},
) {
  const timelines = deps.make.timelines;
  const consents = new Map<VoiceConsentId, StoredConsent>();

  const load = (target: Target) => {
    const timeline = timelines.get(target.timelineId);
    if (!timeline || timeline.projectId !== target.projectId)
      return err(timelineError('timeline.not_found', { timelineId: target.timelineId }));
    if (target.revision !== undefined && target.revision !== timeline.revision)
      return err(
        ConflictError(
          { entity: 'timeline', id: target.timelineId },
          { detail: `revision ${target.revision} asked, ${timeline.revision} stored` },
        ),
      );
    return ok(timeline);
  };
  const restoreTracks = (before: Timeline) => ({
    name: TIMELINE_COMMANDS.restore,
    payload: { projectId: before.projectId, timelineId: before.id, tracks: before.tracks },
  });

  /** The graphic, its track and the tracks without it. */
  const without = (timeline: Timeline, itemId: string) => {
    for (const track of timeline.tracks) {
      if (track.kind !== 'text') continue;
      const item = track.items.find((candidate) => candidate.type === 'graphic' && candidate.id === itemId);
      if (item?.type !== 'graphic') continue;
      const tracks = timeline.tracks.map((other) =>
        other === track ? { ...track, items: track.items.filter((candidate) => candidate !== item) } : other,
      );
      return { tracks, item, trackId: track.id };
    }
    return { tracks: timeline.tracks, item: null, trackId: null };
  };

  /**
   * Back on its own track when it fits there, else the first text track it fits on, else a new one (render's
   * withGraphicOnTrack and graphic-placement.ts).
   */
  const place = (tracks: Timeline['tracks'], item: GraphicItem, trackId: string | null) => {
    const start = item.start.value;
    const end = start + item.duration.value;
    const fits = (track: Timeline['tracks'][number]) =>
      track.kind === 'text' &&
      track.items.every(
        (other) => other.start.value + other.duration.value <= start || other.start.value >= end,
      );
    const target = tracks.find((track) => track.id === trackId && fits(track)) ?? tracks.find(fits);
    if (!target) {
      const taken = new Set(tracks.map((track) => track.id));
      let n = 2;
      while (taken.has(`T${n}`)) n++;
      return [
        ...tracks,
        { kind: 'text' as const, id: `T${n}`, name: 'Graphics', enabled: true, items: [item] },
      ];
    }
    return tracks.map((track) =>
      track === target && track.kind === 'text'
        ? { ...track, items: [...track.items, item].sort((a, b) => a.start.value - b.start.value) }
        : track,
    );
  };

  const editGraphic = defineCommand({
    name: GRAPHICS_COMMANDS.edit,
    payload: graphicsCommandPayloads[GRAPHICS_COMMANDS.edit],
    sideEffect: 'write',
    handle: (payload, context) => {
      const before = load(payload);
      if (!before.ok) return before;
      const timeline = before.value;
      const { tracks, item, trackId } = without(timeline, payload.itemId);
      if (!item) return err(NotFoundError({ entity: 'graphic', id: payload.itemId }));
      const moved =
        payload.placement !== undefined &&
        JSON.stringify(payload.placement) !== JSON.stringify(item.placement);
      if (moved || (payload.scale !== undefined && payload.scale !== (item.scale ?? 1)))
        return err(
          codeError('render.graphic_invalid', { kind: 'composition', field: moved ? 'placement' : 'scale' }),
        );
      const copy = timeline.graphicCompositions?.find((entry) => entry.id === item.composition.id);
      const unknown = Object.keys(payload.params ?? {}).find(
        (name) => !copy?.variables.some((variable) => variable.name === name),
      );
      if (unknown !== undefined)
        return err(codeError('render.graphic_invalid', { kind: 'composition', field: 'params' }));
      const rate = timeline.canvas.rate;
      const frames = payload.duration
        ? Math.max(1, RationalTime.toFrames(payload.duration, rate))
        : item.duration.value;
      const length = timeline.tracks[0]?.items.reduce(
        (sum, entry) => sum + (entry.type === 'transition' ? 0 : entry.duration.value),
        0,
      );
      const anchor = payload.anchor ?? item.anchor;
      const wanted =
        payload.anchor?.kind === 'time' ? RationalTime.toFrames(payload.anchor.at, rate) : item.start.value;
      const start = Math.max(0, Math.min(wanted, (length ?? frames) - frames));
      const next: GraphicItem = {
        ...item,
        anchor,
        start: RationalTime.of(start, rate),
        duration: RationalTime.of(frames, rate),
        origin: (PERSON_SOURCES as readonly string[]).includes(context.source) ? 'user' : item.origin,
        ...(item.composition && payload.params
          ? {
              composition: { ...item.composition, params: { ...item.composition.params, ...payload.params } },
            }
          : {}),
      };
      const placed = place(tracks, next, trackId);
      return timelines.write(
        payload.projectId,
        timeline,
        { ok: true, timeline: { ...timeline, tracks: placed } },
        restoreTracks(timeline),
      );
    },
  });

  const removeGraphic = defineCommand({
    name: GRAPHICS_COMMANDS.remove,
    payload: graphicsCommandPayloads[GRAPHICS_COMMANDS.remove],
    sideEffect: 'write',
    handle: (payload) => {
      const before = load(payload);
      if (!before.ok) return before;
      const targetId = payload.itemId ?? payload.itemIds?.[0] ?? '';
      const { tracks, item } = without(before.value, targetId);
      if (!item) return err(NotFoundError({ entity: 'graphic', id: targetId }));
      return timelines.write(
        payload.projectId,
        before.value,
        { ok: true, timeline: { ...before.value, tracks } },
        restoreTracks(before.value),
      );
    },
  });

  // EDT1-GFX: the person's Use it. render.graphic_invalid for a graphic that isn't a proposal, as render's.
  const useProposal = defineCommand({
    name: GRAPHICS_COMMANDS.useProposal,
    payload: graphicsCommandPayloads[GRAPHICS_COMMANDS.useProposal],
    sideEffect: 'write',
    handle: (payload) => {
      const before = load(payload);
      if (!before.ok) return before;
      const { item } = without(before.value, payload.itemId);
      if (!item) return err(NotFoundError({ entity: 'graphic', id: payload.itemId }));
      if (!item.proposal)
        return err(codeError('render.graphic_invalid', { kind: 'composition', field: 'proposal' }));
      const { proposal: _used, ...kept } = item;
      const tracks = before.value.tracks.map((track) =>
        track.kind === 'text'
          ? { ...track, items: track.items.map((entry) => (entry.id === item.id ? kept : entry)) }
          : track,
      );
      return timelines.write(
        payload.projectId,
        before.value,
        { ok: true, timeline: { ...before.value, tracks } },
        restoreTracks(before.value),
      );
    },
  });

  const person = { sources: PERSON_SOURCES, project: () => null } as const;

  const recordConsent = defineCommand({
    name: VOICE_CONSENT_COMMANDS.recordConsent,
    payload: voiceConsentCommandPayloads[VOICE_CONSENT_COMMANDS.recordConsent],
    sideEffect: 'write',
    ...person,
    handle: (payload) => {
      if (payload.termsVersion !== VOICE_CONSENT_TERMS_VERSION)
        return err(
          ValidationError(
            { field: 'termsVersion' },
            { detail: `terms ${payload.termsVersion} aren't current` },
          ),
        );
      const claimed = voiceCapture.captures.claim(payload.captureKey);
      if (!claimed.ok) return claimed;
      const { durationMs } = claimed.value;
      if (durationMs < RECORDING_MS.min || durationMs > RECORDING_MS.max)
        return err(codeError('audio.consent_recording_length', { seconds: Math.round(durationMs / 1000) }));
      // The check on this Mac heard the line unless the fake was told what it heard instead.
      if (options.heard !== undefined)
        return err(codeError('audio.consent_mismatch', { heard: options.heard }));
      consents.set(payload.consentId, { speakerName: payload.speakerName, clone: null });
      return ok({
        result: { consentId: payload.consentId, phraseMatch: 0.96 },
        inverse: {
          name: VOICE_CONSENT_COMMANDS.withdrawConsent,
          payload: { projectId: null, consentId: payload.consentId },
        },
      });
    },
  });

  const withdrawConsent = defineCommand({
    name: VOICE_CONSENT_COMMANDS.withdrawConsent,
    payload: voiceConsentCommandPayloads[VOICE_CONSENT_COMMANDS.withdrawConsent],
    sideEffect: 'destructive',
    ...person,
    handle: (payload) => {
      if (!consents.delete(payload.consentId))
        return err(NotFoundError({ entity: 'voiceConsent', id: payload.consentId }));
      return ok({ result: null });
    },
  });

  const createClone = defineCommand({
    name: VOICE_CONSENT_COMMANDS.createClone,
    payload: voiceConsentCommandPayloads[VOICE_CONSENT_COMMANDS.createClone],
    sideEffect: 'external',
    ...person,
    handle: (payload) => {
      if (deps.localOnly()) return err(LocalOnly({ what: 'upload' }));
      const consent = consents.get(payload.consentId);
      if (!consent) return err(codeError('audio.voice_consent_required'));
      const voiceId = `fake-clone-${payload.consentId.slice(-6).toLowerCase()}`;
      consent.clone = { voiceId, name: payload.name };
      return ok({
        result: { voiceId, requiresVerification: false },
        inverse: {
          name: VOICE_CONSENT_COMMANDS.deleteClone,
          payload: { projectId: null, consentId: payload.consentId },
        },
      });
    },
  });

  const deleteClone = defineCommand({
    name: VOICE_CONSENT_COMMANDS.deleteClone,
    payload: voiceConsentCommandPayloads[VOICE_CONSENT_COMMANDS.deleteClone],
    sideEffect: 'destructive',
    ...person,
    handle: (payload) => {
      const consent = consents.get(payload.consentId);
      if (!consent) return err(NotFoundError({ entity: 'voiceConsent', id: payload.consentId }));
      consent.clone = null;
      return ok({ result: null });
    },
  });

  const commands: AnyCommand[] = [
    editGraphic,
    removeGraphic,
    useProposal,
    recordConsent,
    withdrawConsent,
    createClone,
    deleteClone,
  ];
  /** For tests: the consents stored, by id. */
  const stored = () => [...consents.entries()].map(([id, consent]) => ({ id, ...consent }));
  return { commands, consents: stored };
}
