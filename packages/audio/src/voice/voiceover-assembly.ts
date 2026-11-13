// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The steps of a voiceover pass (SPEC P3.3, P3.4) the service composes: generate the chosen lines in order with
 * their neighbours as context, read back the facts of lines kept as they are, place everything on the beat,
 * compress (once, at most 8 %) the fresh lines placement asks to, and build `voice.applyVoiceover`'s payload.
 */
import {
  err,
  ok,
  RationalTime,
  type AsyncResult,
  type GenerationTrace,
  type Result,
  type SlotId,
  type Timeline,
  type Track,
  type VoiceLineId,
  type Voiceover,
  type VoiceQuality,
} from '@taalcut/core';
import { VoiceLineUnknown } from './errors';
import { compressLineFile, generateLineFile, type LineFile, type LineFileDeps } from './line-files';
import { compressionNote, planPlacement, type Placement } from './placement';
import { keptFacts, voiceoverOf, type LineFacts, type VoiceRecord } from './voice-lines';

export interface Run {
  readonly signal?: AbortSignal;
  readonly trace?: GenerationTrace;
}

/** A line of a pass: what it says, at which quality, in which slot. */
export interface PassLine {
  readonly lineId: VoiceLineId;
  readonly text: string;
  readonly quality: VoiceQuality;
  readonly slotId: SlotId | null;
}

export interface VoiceoverOutcome {
  /** `voice.applyVoiceover`'s payload. */
  readonly payload: {
    readonly projectId: Timeline['projectId'];
    readonly timelineId: Timeline['id'];
    readonly revision: number;
    readonly voiceover: Voiceover;
    readonly track: Track;
  };
  /** Where each line starts on the timeline, at the canvas rate. */
  readonly lines: readonly { lineId: VoiceLineId; start: RationalTime; offBeat: boolean }[];
  readonly warnings: readonly string[];
  readonly costUsd: number;
}

interface Pass {
  readonly timeline: Timeline;
  readonly record: VoiceRecord;
  readonly run: Run;
}

const scaled = (t: RationalTime, ratio: number) => RationalTime.of(Math.round(t.value * ratio), t.rate);

/** Generates the lines at `which` (indexes into `lines`), in order, with their neighbours as context. */
export async function generateLines(
  deps: LineFileDeps,
  pass: Pass & { readonly lines: readonly PassLine[]; readonly which: ReadonlySet<number> },
): AsyncResult<{ files: Map<VoiceLineId, LineFile>; costUsd: number }> {
  const { timeline, record, run, lines } = pass;
  const files = new Map<VoiceLineId, LineFile>();
  let costUsd = 0;
  for (const [i, line] of lines.entries()) {
    if (!pass.which.has(i)) continue;
    const previousText = lines[i - 1]?.text;
    const nextText = lines[i + 1]?.text;
    const file = await generateLineFile(deps, {
      lineId: line.lineId,
      projectId: timeline.projectId,
      text: line.text,
      voiceId: record.voiceId,
      language: record.language,
      quality: line.quality,
      seed: record.seed,
      ...(previousText ? { previousText } : {}),
      ...(nextText ? { nextText } : {}),
      ...(run.signal ? { signal: run.signal } : {}),
      ...(run.trace ? { trace: run.trace } : {}),
    });
    if (!file.ok) return file;
    files.set(line.lineId, file.value);
    costUsd += file.value.costUsd;
  }
  return ok({ files, costUsd });
}

/** Each line's facts: from its fresh file, or read back from the voice track when it was kept. */
export function lineFacts(
  timeline: Timeline,
  lines: readonly PassLine[],
  fresh: ReadonlyMap<VoiceLineId, LineFile>,
): Result<LineFacts[]> {
  const facts: LineFacts[] = [];
  for (const [i, line] of lines.entries()) {
    const file = fresh.get(line.lineId);
    if (file) {
      facts.push({
        ...line,
        assetId: file.assetId,
        duration: file.duration,
        onset: file.aligned.onset,
        speechEnd: file.aligned.speechEnd,
      });
      continue;
    }
    const stored = timeline.voiceover?.lines.find((l) => l.id === line.lineId);
    const kept = stored ? keptFacts(timeline, stored) : null;
    if (!kept) return err(VoiceLineUnknown({ lineId: line.lineId }, { detail: `line ${i} has no clip` }));
    facts.push(kept);
  }
  return ok(facts);
}

/** Compresses each placement that asks for it into a new file; a kept line has no bytes to compress. */
async function compressSqueezed(
  deps: LineFileDeps,
  pass: Pass & { readonly facts: LineFacts[]; readonly fresh: ReadonlyMap<VoiceLineId, LineFile> },
  squeezed: readonly Placement[],
): AsyncResult<LineFacts[]> {
  const facts = [...pass.facts];
  for (const p of squeezed) {
    const file = pass.fresh.get(p.lineId);
    const index = facts.findIndex((f) => f.lineId === p.lineId);
    const fact = facts[index];
    // The skill shortens or regenerates a kept line instead.
    if (!file || !fact)
      return err(VoiceLineUnknown({ lineId: p.lineId }, { detail: 'needs compressing; generate it again' }));
    const compressed = await compressLineFile(
      deps,
      {
        assetBytes: file.bytes,
        extension: file.extension,
        lineId: p.lineId,
        projectId: pass.timeline.projectId,
        provenance: file.provenance,
        aligned: file.aligned,
        language: pass.record.language,
      },
      p.compress,
      pass.run.signal,
    );
    if (!compressed.ok) return compressed;
    facts[index] = {
      ...fact,
      assetId: compressed.value.assetId,
      duration: compressed.value.duration,
      onset: scaled(fact.onset, p.compress),
      speechEnd: scaled(fact.speechEnd, p.compress),
    };
  }
  return ok(facts);
}

/** Places the lines, compressing (once) any that placement says must be, and builds the payload. */
export async function assembleVoiceover(
  deps: LineFileDeps,
  pass: Pass & {
    readonly facts: LineFacts[];
    readonly fresh: ReadonlyMap<VoiceLineId, LineFile>;
    readonly costUsd: number;
  },
): AsyncResult<VoiceoverOutcome> {
  const { timeline } = pass;
  let placed = planPlacement(timeline, pass.facts);
  if (!placed.ok) return placed;
  let facts = pass.facts;
  const squeezed = placed.value.placements.filter((p) => p.compress < 1);
  // The second pass places the compressed files as they are; the outcome still says which lines were squeezed.
  const compressed = squeezed.map((p) => compressionNote(p.lineId, p.compress));
  if (squeezed.length > 0) {
    const shorter = await compressSqueezed(deps, pass, squeezed);
    if (!shorter.ok) return shorter;
    facts = shorter.value;
    placed = planPlacement(timeline, facts);
    if (!placed.ok) return placed;
  }
  const built = voiceoverOf(
    timeline,
    pass.record,
    placed.value.placements,
    new Map(facts.map((f) => [f.lineId, f])),
  );
  if (!built.ok) return built;
  const frame = RationalTime.of(1, timeline.canvas.rate);
  return ok({
    payload: {
      projectId: timeline.projectId,
      timelineId: timeline.id,
      revision: timeline.revision,
      ...built.value,
    },
    lines: placed.value.placements.map((p) => ({
      lineId: p.lineId,
      start: RationalTime.multiply(frame, p.startFrame),
      offBeat: p.offBeat,
    })),
    warnings: [...compressed, ...placed.value.warnings],
    costUsd: pass.costUsd,
  });
}
