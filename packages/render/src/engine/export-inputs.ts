// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The preflight stage's gathering (SPEC section 4): the timeline at the
 * render's revision, the preset, the plan, every original on disk, the
 * music's files, the fonts and the caption layout, and the QA round. Pure
 * reads: nothing is written until the checks pass.
 */
import { join } from 'node:path';
import {
  err,
  ok,
  RENDER_COMMANDS,
  type AsyncResult,
  type ExportPreset,
  type QaCheckResult,
  type RenderRecord,
  type Result,
  type StyleBand,
  type Timeline,
} from '@taalcut/core';
import { layoutCue } from '../captions/layout';
import { createCompositionFonts } from '../captions/fonts';
import { showProposals } from '../compositions/timing-context';
import { CodecUnavailable, DurationOutOfRange, TimelineChanged, UnsupportedFrameRate } from '../errors';
import { musicPreflight, type MusicFiles } from '../music/paths';
import { NO_REFERENCE_AUDIO } from '../music/reference-audio';
import { planQa } from '../plan/qa-plan';
import { planForPreset } from '../plan/canvas';
import { timelineAtExportRate } from '../plan/export-rate';
import type { PlannedVisual, RenderPlan } from '../plan/types';
import { checkExportCodec } from '../presets/codecs';
import { canvasPreset } from '../presets/canvas-preset';
import { presetAvailability, presetFor, presetInCodec } from '../presets/presets.v1';
import { nextRound } from '../qa/fix-loop';
import { runPreflight } from '../qa/run-preflight';
import type { MediaCheckItem } from '../qa/checks/preflight';
import { rateLabel } from '../time/frames';
import type { CompileOptions } from '../compile/composition';
import { TEXT_FONT } from '../compile/css';
import type { CompositionFonts, QaPlan } from '../types';
import { storedRequest } from '../store/stored-request';
import { styleExport, type StyledExport } from '../style/export-style';
import type { SlotMatchSourced } from '../qa/checks/slot-match/facts';
import type { ConformSource } from './conform';
import type { RenderEngineDeps } from './deps';

export interface ExportInputs {
  /** The timeline as rendered: the stored revision with the Style's bumpers in place (P3-V10). */
  readonly timeline: Timeline;
  /** P3-V10: the Style drawn, its bumpers and its logo file. */
  readonly styled: StyledExport;
  readonly preset: ExportPreset;
  readonly plan: RenderPlan;
  readonly qaPlan: QaPlan;
  readonly round: number;
  /** Each enabled visual's original, by visual id (absent when offline: preflight fails). */
  readonly sources: ReadonlyMap<string, ConformSource>;
  /** Each audio clip's original by asset id. */
  readonly audioFiles: ReadonlyMap<string, string>;
  readonly music: MusicFiles;
  readonly fonts: CompositionFonts;
  readonly captionLayout: NonNullable<CompileOptions['captionLayout']>;
  readonly preflight: readonly QaCheckResult[];
  /** LRN1-STY: the pacing band of the set the project is made like (absent: it follows none). */
  readonly stylePacing?: StyleBand;
  /** AGT2-MATCH: the template the timeline follows and its shots' word (absent: none, or unreadable). */
  readonly slotMatch?: SlotMatchSourced;
}

/** LRN1-STY: the pacing band of the set the render's project is made like; nothing when it follows none. */
async function stylePacingOf(
  deps: RenderEngineDeps,
  projectId: RenderRecord['projectId'],
): AsyncResult<Pick<ExportInputs, 'stylePacing'>> {
  if (!deps.stylePacing) return ok({});
  const band = await deps.stylePacing(projectId);
  if (!band.ok) return band;
  return ok(band.value ? { stylePacing: band.value } : {});
}

/** AGT2-MATCH: the template and shot facts for QA's slot match; a failure only leaves the slot checks out. */
async function slotMatchOf(
  deps: RenderEngineDeps,
  record: RenderRecord,
  timeline: Timeline,
): Promise<Pick<ExportInputs, 'slotMatch'>> {
  if (!deps.slotMatch || !timeline.template) return {};
  const sourced = await deps.slotMatch({ projectId: record.projectId, timeline });
  if (!sourced.ok) deps.log?.(`[render] slot match unavailable: ${sourced.error.code}`);
  return sourced.ok && sourced.value ? { slotMatch: sourced.value } : {};
}

async function originals(deps: RenderEngineDeps, plan: RenderPlan) {
  const sources = new Map<string, ConformSource>();
  const audioFiles = new Map<string, string>();
  const items: MediaCheckItem[] = [];
  const byAsset = new Map<string, Awaited<ReturnType<RenderEngineDeps['assets']['original']>>>();
  const lookup = async (assetId: PlannedVisual['assetId']) => {
    if (!byAsset.has(assetId)) byAsset.set(assetId, await deps.assets.original(assetId));
    return byAsset.get(assetId)!;
  };
  for (const visual of plan.visuals.filter((candidate) => candidate.enabled)) {
    const found = await lookup(visual.assetId);
    if (!found.ok) return found;
    if (found.value) sources.set(visual.id, found.value);
    items.push({
      clipId: visual.id,
      assetId: visual.assetId,
      name: found.value ? found.value.path.split(/[\\/]/).pop()! : visual.assetId,
      path: found.value?.path ?? null,
      expected: { size: found.value?.size ?? 0, mtimeMs: found.value?.mtimeMs ?? 0 },
    });
  }
  for (const clip of plan.audio) {
    const found = await lookup(clip.assetId);
    if (!found.ok) return found;
    if (found.value) audioFiles.set(clip.assetId, found.value.path);
    else if (!items.some((item) => item.assetId === clip.assetId))
      items.push({
        clipId: clip.id,
        assetId: clip.assetId,
        name: clip.assetId,
        path: null,
        expected: { size: 0, mtimeMs: 0 },
      });
  }
  return ok({ sources, audioFiles, items });
}

/** The round of this render: one more than the render it supersedes (at most QA_MAX_ROUNDS). */
async function roundOf(deps: RenderEngineDeps, record: RenderRecord): AsyncResult<number> {
  if (!record.supersedes) return nextRound(null);
  const previous = await deps.store.get(record.supersedes);
  return nextRound(previous.ok ? (previous.value.qa?.round ?? 1) : null);
}

/**
 * The preset takes the timeline's rate and (with its bumpers) its length. Too long because of the bumpers
 * (SPEC P3.5): the fix is to leave them out.
 */
function fitsPreset(record: RenderRecord, preset: ExportPreset, plan: RenderPlan): Result<void> {
  const availability = presetAvailability(preset, plan.rate, plan.durationFrames);
  if (availability.available) return ok(undefined);
  if (availability.reasonKey === 'render.unavailable.frameRate')
    return err(UnsupportedFrameRate({ rate: rateLabel(plan.rate) }));
  const range = {
    presetId: preset.id,
    minSeconds: preset.duration.minSeconds,
    maxSeconds: preset.duration.maxSeconds,
  };
  const bumpered = plan.bumpers.intro !== null || plan.bumpers.outro !== null;
  return err(
    bumpered
      ? DurationOutOfRange(range, {
          fix: {
            command: RENDER_COMMANDS.setExportPreset,
            labelKey: 'fix.leaveOutBumpers',
            payload: { projectId: record.projectId, presetId: preset.id, includeBumpers: false },
          },
        })
      : DurationOutOfRange(range),
  );
}

export async function gatherExport(deps: RenderEngineDeps, record: RenderRecord): AsyncResult<ExportInputs> {
  const loaded = await deps.timelines.get(record.timelineId);
  if (!loaded.ok) return loaded;
  let timeline = loaded.value;
  // A render is of exactly one revision. After later edits it comes from the export version render.export
  // saved; a store without versions can't give it back, and the user exports again.
  if (timeline.revision !== record.timelineRevision) {
    const held = deps.timelines.atRevision
      ? await deps.timelines.atRevision(record.timelineId, record.timelineRevision)
      : err(TimelineChanged({ expected: record.timelineRevision, actual: timeline.revision }));
    if (!held.ok)
      return held.error.code === 'core.not_found'
        ? err(TimelineChanged({ expected: record.timelineRevision, actual: timeline.revision }))
        : held;
    timeline = held.value;
  }
  const request = storedRequest(record);
  if (!request.ok) return request;
  const sampled = timelineAtExportRate(timeline, request.value.rate ?? timeline.canvas.rate);
  if (!sampled.ok) return sampled;
  timeline = sampled.value;
  // LNX1-AV1: the preset in the codec the request chose (HEVC for a platform preset), and only where this machine
  // can encode it: an AV1 export without a working hardware AV1 encoder stops here, before anything renders.
  const codec = request.value.codec;
  const preset = presetInCodec(canvasPreset(presetFor(record.presetId), timeline.canvas), codec);
  if (!preset)
    return err(CodecUnavailable({ codec: codec ?? '' }, { detail: `${record.presetId} has no ${codec}` }));
  const encodable = await checkExportCodec(deps.media, preset.video.codec);
  if (!encodable.ok) return encodable;
  timeline = showProposals(timeline);
  const styled = await styleExport(
    { assets: deps.assets, media: deps.media, ...(deps.styles ? { styles: deps.styles } : {}) },
    timeline,
    request.value.includeBumpers,
  );
  if (!styled.ok) return styled;
  timeline = styled.value.timeline;
  const planned = planForPreset(timeline, preset);
  if (!planned.ok) return planned;
  const plan = { ...planned.value, bumpers: styled.value.bumpers };
  const fits = fitsPreset(record, preset, plan);
  if (!fits.ok) return fits;
  const round = await roundOf(deps, record);
  if (!round.ok) return round;
  const files = await originals(deps, plan);
  if (!files.ok) return files;
  const pacing = await stylePacingOf(deps, record.projectId);
  if (!pacing.ok) return pacing;
  const slotMatch = await slotMatchOf(deps, record, timeline);
  const music = await musicPreflight(timeline.music, {
    referenceAudio: deps.referenceAudio ?? NO_REFERENCE_AUDIO,
    ownTrackPath: async (assetId) => {
      const found = await deps.assets.original(assetId);
      return found.ok ? ok(found.value?.path ?? null) : found;
    },
    ...(deps.generatedMusic ? { generatedMusic: deps.generatedMusic } : {}),
  });
  if (!music.ok) return music;

  const measurer = await deps.measurer();
  const fonts = createCompositionFonts(deps.fontsDir, measurer);
  const captions = record.captions.burnIn ? plan.captions : null;
  const qaPlan = planQa(plan, preset);
  const fontIds = [...new Set([TEXT_FONT, ...(captions ? [captions.style.font] : [])])];
  const preflight = await runPreflight({
    plan: qaPlan,
    preset,
    target: { projectId: record.projectId, timelineId: record.timelineId },
    captions,
    media: { items: files.value.items },
    fonts: fonts
      .faces(fontIds)
      .map((face) => ({ file: face.file, path: join(deps.fontsDir, face.file), sha256: face.sha256 })),
  });
  return ok({
    timeline,
    styled: styled.value,
    preset,
    plan,
    qaPlan,
    round: round.value,
    sources: files.value.sources,
    audioFiles: files.value.audioFiles,
    music: music.value,
    fonts,
    captionLayout: (text, style, safe, language, canvasHeight) =>
      layoutCue(text, style, measurer, safe, language, canvasHeight),
    preflight,
    ...pacing.value,
    ...slotMatch,
  });
}
