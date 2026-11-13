// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Render's Phase 3 contract: canvases, QA ids, credentials, batches, subject tracks, graphics, music, derived kinds. */
import { describe, expect, it } from 'vitest';
import {
  C2PA_PRESENCES,
  CANVASES,
  CAPTION_COMMANDS,
  captionCommandPayloads,
  credentialsSummarySchema,
  DERIVED_KEY_PATTERN,
  derivedFileRefSchema,
  exportCredentialsSchema,
  exportOptionsSchema,
  GRAPHICS_COMMANDS,
  graphicsCommandPayloads,
  isOutputCanvas,
  MUSIC_PATHS,
  musicChoiceSchema,
  newId,
  QA_CHECK_IDS,
  QA_UNITS,
  RENDER_COMMANDS,
  renderBatchProgressSchema,
  renderCommandPayloads,
  rendersContract,
  SUBJECT_TRACK_JOB_KIND,
  subjectTrackSchema,
  trackSubjectsJobInputSchema,
  trackSubjectsJobOutputSchema,
} from '@taalcut/core';
import { at, span } from './helpers/documents';

const projectId = newId<'Project'>();
const timelineId = newId<'Timeline'>();
const batchId = newId<'RenderBatch'>();
const HASH = 'b'.repeat(64);
const box = { x: 0.2, y: 0.1, width: 0.3, height: 0.4 };

describe('canvases and checks', () => {
  it('portrait, landscape and standard', () => {
    expect(CANVASES).toHaveLength(9);
    expect(isOutputCanvas({ width: 1440, height: 1080 })).toBe(true);
    expect(isOutputCanvas({ width: 1080, height: 1080 })).toBe(true);
  });

  it('QA names the nine new checks and two units, after the Phase 2 ones', () => {
    // The whole list, by name: a swapped or dropped id fails here, not only a changed count.
    expect(QA_CHECK_IDS.slice(21, 30)).toEqual([
      'subjectInFrame',
      'cropJitter',
      'captionCoversFace',
      'graphicsSafeZone',
      'graphicsOverlap',
      'graphicsReadability',
      'voiceOverMusic',
      'contentCredentials',
      'brandAssets',
    ]);
    expect(QA_CHECK_IDS.slice(0, 21)).toEqual([
      'preflightMedia',
      'preflightFonts',
      'rightsReferenceAudio',
      'container',
      'codec',
      'resolution',
      'aspectRatio',
      'frameRate',
      'duration',
      'bitrate',
      'blackFrames',
      'frozenFrames',
      'blackBars',
      'avSync',
      'beatSync',
      'loudness',
      'silence',
      'captionSafeZone',
      'captionOverflow',
      'captionGlyphs',
      'captionReadability',
    ]);
    expect(QA_UNITS).toEqual(expect.arrayContaining(['lu', 'percent']));
  });
});

describe('derived kinds (P3)', () => {
  it('keys the mix, warped music, subject tracks, LUTs, speech and looks', () => {
    for (const key of [
      `mix/bb/${HASH}.v1.wav`,
      `warped/bb/${HASH}.bpm-120.v1.flac`,
      `subjects/bb/${HASH}.v1.json`,
      `grades/bb/${HASH}.s33.v1.cube`,
      `speech/bb/${HASH}.v2.json`,
      `looks/bb/${HASH}.v1.json`,
    ])
      expect(DERIVED_KEY_PATTERN.test(key), key).toBe(true);
    expect(DERIVED_KEY_PATTERN.test(`grades/bb/${HASH}.v1.exe`)).toBe(false);
    const lut = {
      kind: 'gradeLut',
      key: `grades/bb/${HASH}.v1.cube`,
      bytes: 10,
      mimeType: 'text/plain',
      recipe: 1,
    };
    expect(derivedFileRefSchema.safeParse(lut).success).toBe(true);
  });
});

describe('generated music (path c)', () => {
  const generated = {
    path: 'generated',
    assetId: newId<'Asset'>(),
    warpedKey: `warped/bb/${HASH}.v1.flac`,
    bpm: 120,
    grid: { maxErrorMs: 12, p95ErrorMs: 6, missed: 0 },
    gainDb: -3,
  };

  it('is a fourth music path with its warped file and grid check', () => {
    expect(MUSIC_PATHS).toContain('generated');
    expect(musicChoiceSchema.safeParse(generated).success).toBe(true);
    expect(musicChoiceSchema.safeParse({ ...generated, warpedKey: '/tmp/x.flac' }).success).toBe(false);
    expect(musicChoiceSchema.safeParse({ ...generated, bpm: 300 }).success).toBe(false);
  });
});

describe('Content Credentials', () => {
  it("summarise a manifest and the export dialog's note", () => {
    expect(C2PA_PRESENCES).toEqual(['present', 'absent', 'unknown']);
    const summary = {
      state: 'valid',
      generator: 'Taalcut',
      issuer: null,
      digitalSourceTypes: [],
      ingredients: 2,
    };
    expect(credentialsSummarySchema.safeParse(summary).success).toBe(true);
    expect(credentialsSummarySchema.safeParse({ ...summary, state: 'signed' }).success).toBe(false);
    expect(
      exportCredentialsSchema.safeParse({ add: false, sourcesWithCredentials: 1, disclosures: ['tiktok'] })
        .success,
    ).toBe(true);
    expect(exportOptionsSchema.shape.credentials.safeParse(undefined).success).toBe(true);
  });

  it("turning them on is a person's command", () => {
    const set = renderCommandPayloads[RENDER_COMMANDS.setContentCredentials];
    expect(set.safeParse({ projectId, add: true }).success).toBe(true);
    expect(set.safeParse({ projectId }).success).toBe(false);
  });
});

describe('batches', () => {
  it('queue up to 50 timelines, as export or draft', () => {
    const exportBatch = renderCommandPayloads[RENDER_COMMANDS.exportBatch];
    const items = [{ projectId, timelineId, presetId: 'landscape' }];
    expect(exportBatch.parse({ batchId, items, mode: 'draft' })).toMatchObject({ notify: false });
    expect(exportBatch.safeParse({ batchId, items: [], mode: 'export' }).success).toBe(false);
    expect(exportBatch.safeParse({ batchId, items, mode: 'preview' }).success).toBe(false);
    expect(renderCommandPayloads[RENDER_COMMANDS.cancelBatch].safeParse({ batchId }).success).toBe(true);
    const preset = renderCommandPayloads[RENDER_COMMANDS.setExportPreset];
    expect(preset.safeParse({ projectId, presetId: 'standard', includeBumpers: false }).success).toBe(true);
  });

  it('report progress by state', () => {
    const progress = {
      batchId,
      total: 3,
      queued: 1,
      running: 1,
      ready: 1,
      needsAttention: 0,
      failed: 0,
      cancelled: 0,
      etaMs: null,
    };
    expect(renderBatchProgressSchema.safeParse(progress).success).toBe(true);
    expect(renderBatchProgressSchema.safeParse({ ...progress, total: 51 }).success).toBe(false);
    expect(Object.keys(rendersContract)).toContain('watchBatch');
  });
});

describe('caption translation', () => {
  it('gives every cue its new text', () => {
    const apply = captionCommandPayloads[CAPTION_COMMANDS.applyTranslation];
    const cues = [{ cueId: newId<'CaptionCue'>(), text: 'Primer día en Goa' }];
    expect(apply.safeParse({ projectId, timelineId, language: 'es', cues }).success).toBe(true);
    expect(apply.safeParse({ projectId, timelineId, language: 'es', cues: [] }).success).toBe(false);
    expect(apply.safeParse({ projectId, timelineId, language: 'Spanish', cues }).success).toBe(false);
  });
});

describe('subject tracks', () => {
  const sample = {
    t: at(0),
    source: 'detect',
    faces: [{ box, confidence: 0.9, roll: 0, yaw: 5, pitch: -2 }],
    humans: [],
    saliency: [{ box, confidence: 0.5 }],
    subject: { kind: 'face', box, focus: { x: 0.35, y: 0.3 }, confidence: 0.9 },
  };
  const track = {
    version: 1,
    assetId: newId<'Asset'>(),
    contentHash: HASH,
    range: span(0, 90),
    recipe: {
      faceRevision: 3,
      humanRevision: 2,
      saliencyRevision: 2,
      trackerRevision: 1,
      detectHz: 4,
      trackHz: 15,
      shortSide: 360,
    },
    compute: { faces: 'neuralEngine', track: 'gpu' },
    samples: [sample],
  };

  it('hold boxes only', () => {
    expect(subjectTrackSchema.safeParse(track).success).toBe(true);
    const landmarks = { ...sample, faces: [{ ...sample.faces[0], landmarks: [[0, 0]] }] };
    expect(subjectTrackSchema.safeParse({ ...track, samples: [landmarks] }).success).toBe(false);
    expect(subjectTrackSchema.safeParse({ ...track, identity: 'p1' }).success).toBe(false);
    expect(subjectTrackSchema.safeParse({ ...track, compute: { faces: 'tpu' } }).success).toBe(false);
  });

  it("are made by render's job", () => {
    expect(SUBJECT_TRACK_JOB_KIND).toBe('render.trackSubjects');
    expect(
      trackSubjectsJobInputSchema.safeParse({ assetId: track.assetId, range: span(0, 90) }).success,
    ).toBe(true);
    const ref = {
      kind: 'subjectTrack',
      key: `subjects/bb/${HASH}.v1.json`,
      bytes: 5,
      mimeType: 'application/json',
      recipe: 1,
    };
    expect(trackSubjectsJobOutputSchema.safeParse({ track: ref }).success).toBe(true);
  });
});

describe('graphics commands', () => {
  it('edit and remove a graphic', () => {
    const anchor = { kind: 'phrase', text: 'fifty percent', occurrence: 1 };
    const itemId = newId<'TimelineItem'>();
    const edit = graphicsCommandPayloads[GRAPHICS_COMMANDS.edit];
    expect(edit.safeParse({ projectId, timelineId, itemId, anchor, duration: at(60) }).success).toBe(true);
    expect(edit.safeParse({ projectId, timelineId, anchor }).success).toBe(false);
    expect(edit.safeParse({ projectId, timelineId, itemId, duration: at(3) }).success).toBe(false);
    expect(edit.safeParse({ projectId, timelineId, itemId, duration: at(451) }).success).toBe(true);
    expect(edit.safeParse({ projectId, timelineId, itemId, duration: at(18_001) }).success).toBe(false);
    expect(edit.safeParse({ projectId, timelineId, itemId, placement: 'top', revision: 3 }).success).toBe(
      true,
    );
    expect(
      graphicsCommandPayloads[GRAPHICS_COMMANDS.remove].safeParse({ projectId, timelineId, itemId }).success,
    ).toBe(true);
  });
});
