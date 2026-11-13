// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it, vi } from 'vitest';
import { CAPTION_PRESETS, newId, RationalTime, type Timeline } from '@taalcut/core';
import type { Backend } from '../src/backend/backend';
import { createEditorDrafts } from '../src/backend/editor-drafts';
import { seedProjects } from '../src/backend/fake/make/seed';

function setup() {
  let timeline = structuredClone(
    seedProjects().projects.flatMap((project) => project.timelines)[0]!,
  ) as Timeline;
  const cueId = newId<'CaptionCue'>();
  const secondId = newId<'CaptionCue'>();
  const range = {
    start: RationalTime.of(0, timeline.canvas.rate),
    duration: RationalTime.of(30, timeline.canvas.rate),
  };
  timeline.captions = {
    enabled: true,
    language: 'en',
    style: CAPTION_PRESETS.classic,
    styleSource: 'preset',
    cues: [cueId, secondId].map((id) => ({
      id,
      range,
      edited: false,
      words: [{ text: 'Original', range, confidence: 1 }],
    })),
  };
  const dispatch = vi.fn(async ({ payload }) => {
    expect(payload.revision).toBe(timeline.revision);
    remote(payload.text, payload.cueId);
    return {};
  });
  const backend = {
    timelines: { get: async () => structuredClone(timeline) },
    commands: { dispatch },
  } as unknown as Backend;
  function remote(text: string, id = cueId) {
    timeline = {
      ...timeline,
      revision: timeline.revision + 1,
      captions: {
        ...timeline.captions!,
        cues: timeline.captions!.cues.map((cue) =>
          cue.id === id ? { ...cue, words: [{ ...cue.words[0]!, text }] } : cue,
        ),
      },
    };
  }
  const store = createEditorDrafts(backend);
  const target = { timeline, itemId: cueId, kind: 'caption' } as const;
  const draft = store.get(target);
  const second = store.get({ ...target, itemId: secondId });
  return { store, draft, second, target, dispatch, remote, timeline: () => timeline };
}

describe('window-owned drafts', () => {
  it('keeps a draft across panel unmounts and refuses an unseen conflicting remote change', async () => {
    const env = setup();
    env.draft.set('My words');
    expect(env.store.get(env.target)).toBe(env.draft);
    env.remote('AI words');
    expect((await env.store.flush(env.target.timeline.id)).ok).toBe(false);
    expect(env.dispatch).not.toHaveBeenCalled();
    expect(env.draft.snapshot()).toMatchObject({ value: 'My words', conflict: true });
    expect((await env.draft.save(true)).ok).toBe(true);
    expect(env.timeline().captions!.cues[0]!.words[0]!.text).toBe('My words');
  });
  it('follows clean remote text, retains dirty text, and explicitly accepts updated words', () => {
    const env = setup();
    env.remote('New');
    env.draft.observe(env.timeline());
    expect(env.draft.snapshot().value).toBe('New');
    env.draft.set('Draft');
    env.remote('Other window');
    env.draft.observe(env.timeline());
    expect(env.draft.snapshot().value).toBe('Draft');
    env.draft.discard();
    expect(env.draft.snapshot()).toMatchObject({ value: 'Other window', conflict: false });
  });
  it('flushes a valid draft at the current revision after unrelated edits', async () => {
    const env = setup();
    env.draft.set('  Saved words  ');
    env.remote('Original');
    expect((await env.store.flush(env.target.timeline.id)).ok).toBe(true);
    expect(env.dispatch).toHaveBeenCalledTimes(1);
    expect(env.draft.snapshot()).toMatchObject({
      value: 'Saved words',
      base: 'Saved words',
      conflict: false,
    });
    await env.store.flush(env.target.timeline.id);
    expect(env.dispatch).toHaveBeenCalledTimes(1);
  });
});

function gate() {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

it('flush waits for an active save and then saves words typed during it', async () => {
  const env = setup();
  const entered = gate();
  const pending = gate();
  const dispatch = env.dispatch.getMockImplementation()!;
  env.dispatch.mockImplementationOnce(async (input) => {
    entered.release();
    await pending.promise;
    return dispatch(input);
  });
  env.draft.set('First');
  const save = env.draft.save();
  await entered.promise;
  env.draft.set('Later');
  const flush = env.store.flush(env.target.timeline.id);
  pending.release();
  await save;
  expect((await flush).ok).toBe(true);
  expect(env.draft.snapshot()).toMatchObject({ value: 'Later', base: 'Later' });
  expect(env.dispatch).toHaveBeenCalledTimes(2);
});

it('flush revisits an earlier field changed while a later field is saving', async () => {
  const env = setup();
  env.draft.set('First field');
  env.second.set('Second field');
  const entered = gate();
  const pending = gate();
  const dispatch = env.dispatch.getMockImplementation()!;
  env.dispatch.mockImplementationOnce(dispatch).mockImplementationOnce(async (input) => {
    entered.release();
    await pending.promise;
    return dispatch(input);
  });
  const flush = env.store.flush(env.target.timeline.id);
  await entered.promise;
  env.draft.set('Changed first field');
  pending.release();
  expect((await flush).ok).toBe(true);
  expect(env.draft.snapshot()).toMatchObject({ value: 'Changed first field', base: 'Changed first field' });
  expect(env.dispatch).toHaveBeenCalledTimes(3);
});
