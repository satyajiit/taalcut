// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Contract round 2 (SPEC 14.7): the follow-ups the build lanes asked for. */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  CLIP_FITS,
  cloudCallRecordSchema,
  createCommandBus,
  createEventBus,
  createMemoryAuditLogStore,
  createUiCommands,
  filesContract,
  frameRateJsonSchema,
  idSchema,
  LIBRARY_ENTITIES,
  newId,
  ok,
  PREVIEW_CSP,
  previewCsp,
  rationalTimeJsonSchema,
  REFERENCE_AUDIO_FEATURE,
  REFERENCE_AUDIO_TERMS_VERSION,
  referenceAudioAcknowledgementRequired,
  RenderAcknowledgementRequired,
  ShotProfileSourceToken,
  SYSTEM_SETTINGS_URLS,
  systemClock,
  templateSummaryFacts,
  templateSummarySchema,
  TIMELINE_COMMANDS,
  timelineCommandPayloads,
  ULID_PATTERN,
  ulidSchema,
  type LibraryEntity,
  type ShotProfileSource,
  type TaalcutEvent,
} from '../src/index';
import { formatTemplate, referenceTemplate } from './helpers/documents';

describe('cloud calls', () => {
  it('carry the project they worked for, as an id', () => {
    const record = {
      id: newId<'CloudCall'>(),
      module: 'vision',
      provider: 'google',
      model: 'gemini',
      reasoning: 'off',
      local: false,
      startedAt: 1,
      latencyMs: 2,
      bytesSent: 3,
      bytesReceived: 4,
      inputTokens: 5,
      outputTokens: 6,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      costUsd: 0.01,
      outcome: 'ok',
      attempt: 1,
    };
    const projectId = newId<'Project'>();
    expect(cloudCallRecordSchema.parse({ ...record, projectId })).toMatchObject({ projectId });
    expect(cloudCallRecordSchema.safeParse({ ...record, projectId: 'Goa' }).success).toBe(false);
  });
});

describe('template summaries', () => {
  it('carry the head sheet’s grid and the approved slots, so a list row needs no get', () => {
    const reference = referenceTemplate();
    const approved = {
      ...reference,
      slots: reference.slots.map((slot, i) => ({ ...slot, approved: i === 0 })),
    };
    const facts = templateSummaryFacts(approved);
    const sheet = reference.contactSheet!;
    expect(facts).toEqual({
      contactSheet: {
        asset: sheet.asset,
        mediaType: sheet.mediaType,
        columns: sheet.columns,
        rows: sheet.rows,
        tile: sheet.tile,
      },
      approvedSlots: 1,
      slotStrip: [30, 30, 30],
      formatId: null,
      language: 'en',
      styleId: null,
    });
    expect(templateSummaryFacts(formatTemplate())).toMatchObject({ contactSheet: null, approvedSlots: 0 });
    const summary = templateSummarySchema.shape;
    expect(summary.contactSheet.safeParse(facts.contactSheet).success).toBe(true);
    expect(summary.contactSheet.safeParse(sheet.asset).success).toBe(false);
    expect(summary.approvedSlots.safeParse(-1).success).toBe(false);
  });
});

describe('LibraryEntity', () => {
  it('is exported with the entities library.changed names', () => {
    const entities: readonly LibraryEntity[] = ['project', 'timeline'];
    expect(entities.every((entity) => LIBRARY_ENTITIES.includes(entity))).toBe(true);
  });
});

describe('fix buttons', () => {
  it('open the reference warning and Files and Folders from the window, without a shortcut', async () => {
    const events = createEventBus({ clock: systemClock });
    const seen: TaalcutEvent[] = [];
    events.onAny((event) => seen.push(event));
    const bus = createCommandBus({ store: createMemoryAuditLogStore(), clock: systemClock });
    bus.register(...createUiCommands({ events }).all);
    for (const name of ['reference.showWarning', 'system.openFilesAndFolders']) {
      expect(bus.list().find((command) => command.name === name)?.shortcut).toBeUndefined();
      expect((await bus.dispatch(name, {}, { source: 'ui', actor: 'user' })).ok).toBe(true);
    }
    expect(seen.map((event) => event.type === 'ui.action' && event.payload.action)).toEqual([
      'reference.showWarning',
      'system.openFilesAndFolders',
    ]);
    const pane = filesContract.openSystemSettings['~orpc'].inputSchema as z.ZodType;
    expect(pane.safeParse({ pane: 'filesAndFolders' }).success).toBe(true);
    expect(pane.safeParse({ pane: 'https://example.com' }).success).toBe(false);
    expect(SYSTEM_SETTINGS_URLS.filesAndFolders).toMatch(
      /^x-apple\.systempreferences:.*Privacy_FilesAndFolders$/,
    );
  });
});

describe('model-facing ids and times', () => {
  it('convert to JSON Schema, where idSchema and rationalTimeSchema can’t', () => {
    const schema = z.object({ shotId: ulidSchema('Shot'), at: rationalTimeJsonSchema });
    const json = z.toJSONSchema(schema, { unrepresentable: 'throw' }) as unknown as {
      properties: { shotId: { pattern: string; description: string } };
    };
    expect(json.properties.shotId).toMatchObject({ pattern: ULID_PATTERN.source, description: 'Shot id' });
    expect(() =>
      z.toJSONSchema(z.object({ id: idSchema<'Shot'>() }), { unrepresentable: 'throw' }),
    ).toThrow();
    const id = newId<'Shot'>();
    expect(schema.parse({ shotId: id, at: { value: 2, rate: { num: 60, den: 2 } } })).toEqual({
      shotId: id,
      at: { value: 2, rate: { num: 60, den: 2 } },
    });
    expect(ulidSchema('Shot').safeParse(id.toLowerCase()).success).toBe(false);
    expect(rationalTimeJsonSchema.safeParse({ value: 1.5, rate: { num: 30, den: 1 } }).success).toBe(false);
    expect(frameRateJsonSchema.safeParse({ num: 30, den: 0 }).success).toBe(false);
  });
});

describe('render.acknowledgement_required', () => {
  it('names the feature and opens the warning card for the project at the current terms', () => {
    const projectId = newId<'Project'>();
    const error = referenceAudioAcknowledgementRequired(projectId);
    expect(RenderAcknowledgementRequired.is(error)).toBe(true);
    expect(error).toEqual({
      code: 'render.acknowledgement_required',
      messageKey: 'errors.render.acknowledgement_required',
      params: { feature: REFERENCE_AUDIO_FEATURE },
      retryable: false,
      fix: {
        command: 'music.openReferenceAudioWarning',
        labelKey: 'fix.openReferenceAudioWarning',
        payload: { projectId, termsVersion: REFERENCE_AUDIO_TERMS_VERSION },
      },
    });
  });
});

describe('timeline.restore', () => {
  it('carries the music choice, so a re-time to the user’s track undoes in one step', () => {
    const restore = timelineCommandPayloads[TIMELINE_COMMANDS.restore];
    const target = { projectId: newId<'Project'>(), timelineId: newId<'Timeline'>() };
    const music = {
      path: 'ownTrack',
      assetId: newId<'Asset'>(),
      offset: { value: 3, rate: { num: 30, den: 1 } },
      gainDb: -6,
    };
    expect(restore.parse({ ...target, music, beatMap: null })).toEqual({ ...target, music, beatMap: null });
    expect(restore.safeParse({ ...target, music: { path: 'loud' } }).success).toBe(false);
  });
});

describe('QA fix commands', () => {
  it('name the clip fit, beat re-sync and trim to a platform length', () => {
    const target = { projectId: newId<'Project'>(), timelineId: newId<'Timeline'>() };
    const clipId = newId<'TimelineItem'>();
    const fit = timelineCommandPayloads[TIMELINE_COMMANDS.setClipFit];
    expect(fit.parse({ ...target, clipId, fit: 'cover' })).toEqual({ ...target, clipId, fit: 'cover' });
    expect(fit.safeParse({ ...target, clipId, fit: 'stretch' }).success).toBe(false);
    expect(timelineCommandPayloads[TIMELINE_COMMANDS.resyncBeats].parse(target)).toEqual(target);
    const trim = timelineCommandPayloads[TIMELINE_COMMANDS.trimToDuration];
    expect(trim.parse({ ...target, maxSeconds: 59.5 }).maxSeconds).toBe(59.5);
    expect(trim.safeParse({ ...target, maxSeconds: 0 }).success).toBe(false);
    expect(CLIP_FITS).toEqual(['cover', 'contain']);
  });
});

describe('previewCsp', () => {
  it('lets the dev server frame a preview, and drops anything but the app and a loopback origin', () => {
    const ancestors = (csp: string) => csp.split('; ').find((d) => d.startsWith('frame-ancestors'));
    expect(PREVIEW_CSP).toBe(previewCsp());
    expect(ancestors(PREVIEW_CSP)).toBe('frame-ancestors app://taalcut');
    const dev = previewCsp({ frameAncestors: ['app://taalcut', 'http://localhost:5173'] });
    expect(ancestors(dev)).toBe('frame-ancestors app://taalcut http://localhost:5173');
    expect(dev).toContain("default-src 'none'");
    const hostile = previewCsp({ frameAncestors: ['https://example.com', "*; script-src 'unsafe-inline'"] });
    expect(ancestors(hostile)).toBe("frame-ancestors 'none'");
    expect(hostile).not.toContain('unsafe-inline');
  });
});

describe('shot profiles', () => {
  it('names the library’s profile source for casting', async () => {
    const empty: ShotProfileSource = {
      profiles: async () => ok([]),
      list: async () => ok([]),
      recent: async () => ok([]),
    };
    expect(ShotProfileSourceToken.key).toBe('core.shotProfileSource');
    expect(await empty.list({ orientations: ['portrait'] }, 10)).toEqual(ok([]));
  });
});
