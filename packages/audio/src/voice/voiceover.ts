// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Script → a placed voiceover (SPEC P3.3): each line generated (drafts on the fast model, finals on the flagship,
 * one seed for the whole voiceover, the neighbouring lines as context), placed on the beat (placement.ts), a line
 * that needs it compressed by at most 8 %, and the result handed back as `voice.applyVoiceover`'s payload. Editing
 * a line generates only that line again (as a final once the voiceover is final); finalising generates every
 * draft line again with the same text, voice and seed. Lines that aren't generated again keep their files.
 */
import {
  err,
  newId,
  ok,
  type AsyncResult,
  type SlotId,
  type Timeline,
  type VoiceLineId,
  type VoiceQuality,
} from '@taalcut/core';
import { NoVoiceover, VoiceLineUnknown } from './errors';
import type { LineFileDeps } from './line-files';
import { assignSlots } from './script-fit';
import { timelineSlots } from './slots';
import type { VoiceRecord } from './voice-lines';
import {
  assembleVoiceover,
  generateLines,
  lineFacts,
  type PassLine,
  type Run,
  type VoiceoverOutcome,
} from './voiceover-assembly';

export type { VoiceoverOutcome } from './voiceover-assembly';

export interface VoiceChoice {
  readonly voiceId: string;
  /** Provider text, untrusted; for display. */
  readonly voiceName: string;
  readonly own: boolean;
}

export interface VoiceoverServiceDeps extends LineFileDeps {
  /** The voiceover's seed (0 – 2³² − 1); random by default. */
  readonly seed?: () => number;
}

export function createVoiceoverService(deps: VoiceoverServiceDeps) {
  const seed = deps.seed ?? (() => Math.floor(Math.random() * 2 ** 32));

  /** Regenerates `which` lines of the voiceover and re-places everything. */
  async function regenerate(
    timeline: Timeline,
    record: VoiceRecord,
    lines: readonly PassLine[],
    which: ReadonlySet<number>,
    run: Run,
  ): AsyncResult<VoiceoverOutcome> {
    const made = await generateLines(deps, { timeline, record, run, lines, which });
    if (!made.ok) return made;
    const facts = lineFacts(timeline, lines, made.value.files);
    if (!facts.ok) return facts;
    return assembleVoiceover(deps, {
      timeline,
      record,
      run,
      facts: facts.value,
      fresh: made.value.files,
      costUsd: made.value.costUsd,
    });
  }

  function stored(timeline: Timeline) {
    const voiceover = timeline.voiceover;
    if (!voiceover || voiceover.lines.length === 0) return err(NoVoiceover());
    return ok(voiceover);
  }

  return {
    generate(
      request: {
        readonly timeline: Timeline;
        readonly script: readonly { readonly text: string; readonly slotId?: SlotId | null }[];
        readonly voice: VoiceChoice;
        readonly language: string;
        readonly quality?: VoiceQuality;
      } & Run,
    ): AsyncResult<VoiceoverOutcome> {
      const { timeline } = request;
      const quality = request.quality ?? 'draft';
      const slots = assignSlots(request.script, timelineSlots(timeline));
      const record: VoiceRecord = {
        id: newId<'Voiceover'>(),
        ...request.voice,
        language: request.language,
        seed: seed(),
      };
      const lines = request.script.map((line, i) => ({
        lineId: newId<'VoiceLine'>(),
        text: line.text,
        quality,
        slotId: slots[i] ?? null,
      }));
      return regenerate(timeline, record, lines, new Set(lines.map((_, i) => i)), request);
    },

    /** Generates one line again: its new text or voice, as a final once the voiceover is final. */
    editLine(
      request: {
        readonly timeline: Timeline;
        readonly lineId: VoiceLineId;
        readonly text?: string;
        readonly voice?: VoiceChoice;
      } & Run,
    ) {
      const voiceover = stored(request.timeline);
      if (!voiceover.ok) return Promise.resolve(voiceover);
      const index = voiceover.value.lines.findIndex((l) => l.id === request.lineId);
      if (index < 0) return Promise.resolve(err(VoiceLineUnknown({ lineId: request.lineId })));
      const final = voiceover.value.lines.every((l) => l.quality === 'final');
      const record: VoiceRecord = { ...voiceover.value, ...(request.voice ?? {}) };
      const lines = voiceover.value.lines.map((l, i) => ({
        lineId: l.id,
        slotId: l.slotId,
        text: i === index ? (request.text ?? l.text) : l.text,
        quality: i === index && final ? ('final' as const) : l.quality,
      }));
      // A new voice means every line again, so the voiceover stays one voice.
      const which =
        request.voice && request.voice.voiceId !== voiceover.value.voiceId
          ? new Set(lines.map((_, i) => i))
          : new Set([index]);
      return regenerate(request.timeline, record, lines, which, request);
    },

    /** Every draft line generated again on the final model, same text, voice and seed; a no-op when all are final. */
    finalize(request: { readonly timeline: Timeline } & Run) {
      const voiceover = stored(request.timeline);
      if (!voiceover.ok) return Promise.resolve(voiceover);
      const lines = voiceover.value.lines.map((l) => ({
        lineId: l.id,
        slotId: l.slotId,
        text: l.text,
        quality: 'final' as const,
      }));
      const which = new Set(voiceover.value.lines.flatMap((l, i) => (l.quality === 'draft' ? [i] : [])));
      return regenerate(request.timeline, voiceover.value, lines, which, request);
    },

    /** Placement again on the current timeline, with the lines' files as they are. */
    place(request: { readonly timeline: Timeline } & Run) {
      const voiceover = stored(request.timeline);
      if (!voiceover.ok) return Promise.resolve(voiceover);
      const lines = voiceover.value.lines.map((l) => ({
        lineId: l.id,
        slotId: l.slotId,
        text: l.text,
        quality: l.quality,
      }));
      return regenerate(request.timeline, voiceover.value, lines, new Set(), request);
    },
  };
}

export type VoiceoverService = ReturnType<typeof createVoiceoverService>;
