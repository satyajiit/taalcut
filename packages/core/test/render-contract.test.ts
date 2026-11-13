// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Render's contract (P2-M6, M8, M9, M10, M11): QA reports, renders, commands, the event and the CSP. */
import { describe, expect, it } from 'vitest';
import {
  APP_CSP_DIRECTIVES,
  CAPTION_COMMANDS,
  captionCommandPayloads,
  exportOptionsSchema,
  exportRequestSchema,
  FrameRates,
  MUSIC_COMMANDS,
  musicCommandPayloads,
  newId,
  PREVIEW_CSP,
  PREVIEW_CSP_DIRECTIVES,
  previewSessionSchema,
  qaReportSchema,
  qaSummarySchema,
  RENDER_COMMANDS,
  renderCommandPayloads,
  renderSnapshotSchema,
  taalcutEventSchema,
  type QaReport,
  type RenderSnapshot,
} from '@taalcut/core';
import { json } from './helpers/documents';

const projectId = newId<'Project'>();
const timelineId = newId<'Timeline'>();
const renderId = newId<'Render'>();

const report: QaReport = {
  version: 1,
  renderId,
  round: 2,
  verdict: 'passedWithWarnings',
  presetId: 'reels',
  checks: [
    {
      id: 'loudness',
      status: 'fixed',
      labelKey: 'qa.checks.loudness',
      measured: { value: -14.2, unit: 'lufs' },
      threshold: { min: -15, max: -13, unit: 'lufs' },
      findings: [],
      overridable: false,
      fixes: [{ kind: 'auto', action: 'renormaliseAudio' }],
      durationMs: 1200,
    },
    {
      id: 'captionSafeZone',
      status: 'warn',
      labelKey: 'qa.checks.captionSafeZone',
      findings: [{ frames: { start: 30, end: 60 }, target: { kind: 'caption', id: 'cue-1' } }],
      overridable: true,
      fixes: [
        {
          kind: 'command',
          labelKey: 'qa.fixes.moveCaptions',
          command: 'captions.setStyle',
          payload: { anchorY: 0.6 },
        },
        { kind: 'agent', instructionKey: 'qa.agent.shortenText', params: { cue: 'cue-1', maxWords: 3 } },
      ],
      durationMs: 80,
    },
  ],
  overrides: [{ check: 'captionSafeZone', at: 1, actor: 'user' }],
  createdAt: 1,
};

const snapshot: RenderSnapshot = {
  id: renderId,
  projectId,
  timelineId,
  timelineRevision: 4,
  presetId: 'reels',
  status: 'ready',
  jobId: newId<'Job'>(),
  progress: null,
  name: 'Goa – Reels',
  width: 1080,
  height: 1920,
  rate: FrameRates.fps30,
  durationFrames: 900,
  bytes: 12_000_000,
  music: 'platformSound',
  captions: { burnIn: true, sidecars: ['srt'] },
  qa: {
    verdict: 'passedWithWarnings',
    round: 2,
    passed: 19,
    warned: 1,
    failed: 0,
    fixed: 1,
    failing: [],
  },
  supersedes: null,
  credentials: { added: false, state: null },
  batchId: null,
  notify: true,
  error: null,
  createdAt: 1,
  finishedAt: 2,
  deletedAt: null,
};

describe('render contract', () => {
  it('a QA report round-trips; at most three rounds, fixes are typed', () => {
    expect(qaReportSchema.parse(json(report))).toEqual(report);
    expect(qaReportSchema.safeParse({ ...report, round: 4 }).success).toBe(false);
    const badFix = {
      ...report.checks[0]!,
      fixes: [{ kind: 'command', labelKey: 'x', command: 'Not A Command' }],
    };
    expect(qaReportSchema.safeParse({ ...report, checks: [badFix] }).success).toBe(false);
    expect(qaSummarySchema.safeParse({ ...snapshot.qa, failing: ['nope'] }).success).toBe(false);
  });

  it('an export request defaults notify and credentials off, bumpers on; a snapshot never carries a path', () => {
    const request = { projectId, timelineId, presetId: 'tiktok', captions: { burnIn: false, sidecars: [] } };
    expect(exportRequestSchema.parse(request)).toEqual({
      ...request,
      notify: false,
      contentCredentials: { add: false },
      includeBumpers: true,
    });
    expect(exportRequestSchema.safeParse({ ...request, presetId: 'youtube' }).success).toBe(false);
    expect(renderSnapshotSchema.parse(json(snapshot))).toEqual(snapshot);
    expect(Object.keys(renderSnapshotSchema.parse({ ...snapshot, filePath: '/x.mp4' }))).not.toContain(
      'filePath',
    );
  });

  it('preview sessions and media live under app://preview', () => {
    const session = {
      sessionId: newId<'PreviewSession'>(),
      url: 'app://preview/abc/index.html?rev=1',
      revision: 1,
      width: 1080,
      height: 1920,
      rate: FrameRates.fps30,
      durationFrames: 900,
      compositionHash: 'd'.repeat(64),
    };
    expect(previewSessionSchema.parse(json(session))).toEqual({ ...session, timelineRevision: 0 });
    expect(previewSessionSchema.parse({ ...session, timelineRevision: 17 }).timelineRevision).toBe(17);
    expect(previewSessionSchema.safeParse({ ...session, timelineRevision: -1 }).success).toBe(false);
    expect(previewSessionSchema.safeParse({ ...session, url: 'file:///tmp/index.html' }).success).toBe(false);
    expect(APP_CSP_DIRECTIVES['frame-src']).toEqual(['app://preview']);
    expect(PREVIEW_CSP_DIRECTIVES['frame-ancestors']).toEqual(['app://taalcut']);
    expect(PREVIEW_CSP).toContain("default-src 'none'");
  });

  it('export options carry the music choice and each preset with its availability', () => {
    const options = {
      projectId,
      timelineId,
      timelineRevision: 4,
      rate: FrameRates.fps30,
      durationFrames: 900,
      presets: [],
      defaultPresetId: 'reels',
      music: {
        current: { path: 'platformSound' },
        referenceAudioAvailable: true,
        referenceAudioAcknowledged: false,
        platformSound: null,
      },
      captions: { available: true, enabled: true, language: 'en' },
    };
    expect(exportOptionsSchema.parse(json(options))).toEqual(options);
  });

  it('command payloads: renders, captions and music', () => {
    expect(
      renderCommandPayloads[RENDER_COMMANDS.setExportPreset].parse({ projectId, presetId: 'device' }),
    ).toEqual({
      projectId,
      presetId: 'device',
    });
    expect(
      renderCommandPayloads[RENDER_COMMANDS.overrideQa].safeParse({ projectId, renderId, checks: [] })
        .success,
    ).toBe(false);
    const style = captionCommandPayloads[CAPTION_COMMANDS.setStyle];
    expect(style.parse({ projectId, timelineId, style: { sizePx: 72 } }).style).toEqual({ sizePx: 72 });
    expect(style.safeParse({ projectId, timelineId, style: { version: 1 } }).data?.style).toEqual({});
    const choose = musicCommandPayloads[MUSIC_COMMANDS.choosePath];
    expect(choose.safeParse({ projectId, timelineId, choice: { path: 'platformSound' } }).success).toBe(true);
    expect(Object.values(RENDER_COMMANDS)).toContain('render.restore');
  });

  it('render.finished tells main whether to notify', () => {
    const event = {
      type: 'render.finished',
      at: 1,
      payload: { renderId, projectId, status: 'ready', notify: true, name: 'Goa – Reels' },
    };
    expect(taalcutEventSchema.parse(event)).toEqual(event);
    expect(
      taalcutEventSchema.safeParse({ ...event, payload: { ...event.payload, status: 'queued' } }).success,
    ).toBe(false);
  });
});
