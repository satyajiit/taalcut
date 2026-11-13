// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// REF1's kept reel in the renderer's fake, as keep's contract describes it: a template read since REF1 carries its
// `media`; one read before it fetches its origin link again (templates.fetchMedia), running a
// templates.fetchReference job whose progress the page follows, and answers the summary with `media` set.
import { callRpc, templateMediaSchema, templateSchema, type EventOf } from '@taalcut/core';
import { flattenedWaveform } from '@taalcut/ui';
import { describe, expect, it } from 'vitest';
import { createFakeBackend } from '../src/backend/fake/fake-backend';
import { templateMediaOptions } from '../src/backend/fake/options/template-media';
import type { FakeTemplateMediaScenario } from '../src/backend/fake/templates/template-media';
import { GOLDEN_HOUR, HOOK_TEST, MORNING, templateIdOf } from '../src/backend/fake/templates/template-data';

const setup = (scenario?: FakeTemplateMediaScenario) =>
  createFakeBackend({
    phase2: { library: { tickMs: 0 }, templateMedia: { tickMs: 0, ...(scenario ? { scenario } : {}) } },
  });

describe('a template’s kept reel, in the fake', () => {
  it('Golden hour keeps its reel; Slow morning routine, read before REF1, has none yet', async () => {
    const { client } = setup();
    const golden = (await client.templates.get({ templateId: templateIdOf(GOLDEN_HOUR) })).summary;
    expect(templateMediaSchema.parse(golden.media)).toMatchObject({ file: 'reference.mp4', hasAudio: true });
    expect((await client.templates.get({ templateId: templateIdOf(MORNING) })).summary.media).toBeNull();
  });

  it('fetches an older template’s reel again: the job’s states and progress, then the summary with media', async () => {
    const { client, controls } = setup();
    const seen: EventOf<'job.stateChanged' | 'job.progress' | 'library.changed'>[] = [];
    for (const type of ['job.stateChanged', 'job.progress', 'library.changed'] as const)
      controls.events.on(type, (event) => seen.push(event));
    const id = templateIdOf(MORNING);
    const kept = await client.templates.fetchMedia({ id });
    expect(kept.media).toMatchObject({ file: 'reference.mp4', hasAudio: true, source: 'anonymous' });
    expect((await client.templates.get({ templateId: id })).summary.media).toEqual(kept.media);

    const states = seen.flatMap((event) => (event.type === 'job.stateChanged' ? [event.payload.to] : []));
    expect(states).toEqual(['queued', 'running', 'succeeded']);
    const progress = seen.flatMap((event) => (event.type === 'job.progress' ? [event.payload] : []));
    expect(progress.every((each) => each.kind === 'templates.fetchReference')).toBe(true);
    expect(progress.map((each) => each.progress.fraction)).toEqual([0, 0.45, 1]);
    expect(progress[0]?.progress.stageKey).toBe('jobs.stage.fetchingReference');
    expect(seen.some((event) => event.type === 'library.changed' && event.payload.ids.includes(id))).toBe(
      true,
    );
  });

  it('fails as the fetch does, and Try again works', async () => {
    const { client } = setup('failsOnce');
    const id = templateIdOf(MORNING);
    const first = await callRpc(client.templates.fetchMedia({ id }));
    expect(!first.ok && first.error).toMatchObject({ code: 'templates.fetch_failed', retryable: true });
    const again = await callRpc(client.templates.fetchMedia({ id }));
    expect(again.ok && again.value.media?.hasAudio).toBe(true);
  });

  it('`templateWaveform: "flat"` gives Slow morning routine the flat waveform of before keep’s 04e87739', async () => {
    expect(templateMediaOptions({ templateWaveform: 'flat' })).toEqual({
      phase2: { templates: { flatWaveform: true } },
    });
    const { client } = createFakeBackend({ phase2: { templates: { flatWaveform: true } } });
    const morning = (await client.templates.get({ templateId: templateIdOf(MORNING) })).template;
    expect(flattenedWaveform(morning.audio.waveform!.peaks)).toBe(true);
    expect(templateSchema.safeParse(morning).success).toBe(true);
    const golden = (await client.templates.get({ templateId: templateIdOf(GOLDEN_HOUR) })).template;
    expect(flattenedWaveform(golden.audio.waveform!.peaks)).toBe(false);
  });

  it('a template with no link to its reel says so', async () => {
    const { client } = setup();
    const answer = await callRpc(client.templates.fetchMedia({ id: templateIdOf(HOOK_TEST) }));
    expect(!answer.ok && answer.error.code).toBe('templates.no_origin_link');
  });
});
