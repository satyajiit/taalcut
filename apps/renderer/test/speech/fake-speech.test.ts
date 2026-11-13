// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// LIB1-LANG, the fake as the pages see it: the languages you speak (null until answered), core's own command on the
// fake's bus (undoable), the Indian-language identifier joining the download only once those languages need it and
// staying when they no longer do; and the clip page's language states, with a clip's language set by hand.
import {
  assetDetailSchema,
  callRpc,
  COMPONENT_COMMANDS,
  LIBRARY_COMMANDS,
  SPEECH_COMMANDS,
  type AssetId,
} from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { createFakeBackend } from '../../src/backend/fake/fake-backend';
import { KIND } from '../../src/backend/fake/library/assets';
import {
  BRIEF_SPEECH_CLIP,
  RECHECK_SPEECH_CLIP,
  MIXED_SPEECH_CLIP,
  ODIA_SPEECH_CLIP,
  UNCLEAR_SPEECH_CLIP,
} from '../../src/backend/fake/library/language-clips';
import { fakeUlid } from '../../src/backend/fake/library/seed';

function setup() {
  const { client } = createFakeBackend({
    phase2: { library: { tickMs: 0 } },
    phase2b: { onboarding: { downloadTickMs: 0 } },
  });
  const dispatch = (name: string, payload: unknown) =>
    callRpc(client.commands.dispatch({ name, payload, source: 'ui' }));
  const undo = () => callRpc(client.commands.undo({ projectId: null, source: 'ui' }));
  const identifier = async () => {
    const listed = await callRpc(client.system.components(undefined));
    if (!listed.ok) throw new Error(listed.error.code);
    return listed.value.find((each) => each.id === 'anuvani-lid');
  };
  const detail = async (n: number) => {
    const read = await callRpc(
      client.library.asset({ assetId: fakeUlid<'Asset'>(KIND.asset, n) as AssetId }),
    );
    if (!read.ok || !read.value) throw new Error('no clip');
    return read.value;
  };
  return { client, dispatch, undo, identifier, detail };
}

describe('the fake languages you speak', () => {
  it('starts unanswered, and the identifier is not part of an English Mac’s download', async () => {
    const { client, identifier } = setup();
    const state = await callRpc(client.speech.spokenLanguages(undefined));
    expect(state.ok && state.value).toEqual({ languages: null });
    expect(await identifier()).toBeUndefined();
  });

  it('an Indian language brings the identifier into the download, which fetches it first; removing it keeps it', async () => {
    const { client, dispatch, undo, identifier } = setup();
    expect((await dispatch(SPEECH_COMMANDS.setSpokenLanguages, { languages: ['en', 'or'] })).ok).toBe(true);
    const state = await callRpc(client.speech.spokenLanguages(undefined));
    expect(state.ok && state.value).toEqual({ languages: ['en', 'or'] });
    expect(await identifier()).toMatchObject({
      name: 'Language identifier for Odia and other Indian languages',
      status: 'not-installed',
      sizeBytes: 436.99 * 1000 ** 2,
    });
    expect((await dispatch(COMPONENT_COMMANDS.download, { first: ['anuvani-lid'] })).ok).toBe(true);
    expect((await identifier())?.status).toBe('installed');

    // Not needed any more: it stays on this Mac, listed; detection just stops using it.
    expect((await dispatch(SPEECH_COMMANDS.setSpokenLanguages, { languages: ['en'] })).ok).toBe(true);
    expect((await identifier())?.status).toBe('installed');
    // And ⌘Z puts the languages back.
    expect((await undo()).ok).toBe(true);
    const back = await callRpc(client.speech.spokenLanguages(undefined));
    expect(back.ok && back.value).toEqual({ languages: ['en', 'or'] });
  });

  it('wanted and never downloaded, it leaves the set again when the languages no longer need it', async () => {
    const { dispatch, identifier } = setup();
    await dispatch(SPEECH_COMMANDS.setSpokenLanguages, { languages: ['hi', 'en'] });
    expect((await identifier())?.status).toBe('not-installed');
    await dispatch(SPEECH_COMMANDS.setSpokenLanguages, { languages: ['en'] });
    expect(await identifier()).toBeUndefined();
  });
});

describe('the fake clip page’s spoken languages', () => {
  it('has speech it couldn’t place, Hindi and English, and Odia with its transcript skipped for the reason', async () => {
    const { detail } = setup();
    const unclear = await detail(UNCLEAR_SPEECH_CLIP);
    const mixed = await detail(MIXED_SPEECH_CLIP);
    const odia = await detail(ODIA_SPEECH_CLIP);
    for (const each of [unclear, mixed, odia])
      expect(assetDetailSchema.safeParse(each).error?.issues ?? []).toEqual([]);
    expect(unclear.asset).toMatchObject({ language: null, speech: { state: 'unclear', languages: [] } });
    expect(mixed.asset).toMatchObject({
      language: 'hi',
      speech: { state: 'mixed', languages: ['hi', 'en'] },
    });
    expect(odia.asset).toMatchObject({ language: 'or', speech: { state: 'detected', languages: ['or'] } });
    expect(odia.transcript).toBeNull();
    const reasons = new Map(odia.stages.map((row) => [row.stage, row.reasonKey ?? row.state]));
    expect(reasons.get('audio.language')).toBe('done');
    expect(reasons.get('audio.transcript')).toBe('indexing.skip.cannotTranscribe');
  });

  it('has a second of speech nobody could place, its transcript empty and in no language', async () => {
    const { detail } = setup();
    const brief = await detail(BRIEF_SPEECH_CLIP);
    expect(assetDetailSchema.safeParse(brief).error?.issues ?? []).toEqual([]);
    expect(brief.asset).toMatchObject({ language: null, speech: { state: 'unclear' } });
    expect(brief.transcript).toEqual({ language: 'und', lines: [], truncated: false });
  });

  it('holds back an old clip’s guess while its language is decided again; a choice names it', async () => {
    const { dispatch, detail } = setup();
    const held = await detail(RECHECK_SPEECH_CLIP);
    expect(assetDetailSchema.safeParse(held).error?.issues ?? []).toEqual([]);
    expect(held.asset).toMatchObject({ language: null, languagePending: true });
    expect(held.asset.speech).toBeUndefined();
    expect(held.transcript?.language).toBe('und');
    const id = fakeUlid<'Asset'>(KIND.asset, RECHECK_SPEECH_CLIP);
    await dispatch(LIBRARY_COMMANDS.setAssetLanguage, { assetId: id, language: 'ta' });
    const chosen = (await detail(RECHECK_SPEECH_CLIP)).asset;
    expect(chosen).toMatchObject({ language: 'ta', speech: { state: 'chosen' } });
    expect(chosen.languagePending).toBeUndefined();
    await dispatch(LIBRARY_COMMANDS.setAssetLanguage, { assetId: id, language: null });
    expect((await detail(RECHECK_SPEECH_CLIP)).asset).toMatchObject({
      language: null,
      languagePending: true,
    });
  });

  it('a language set by hand wins and files the clip; null and ⌘Z give back what was heard', async () => {
    const { dispatch, undo, detail } = setup();
    const id = fakeUlid<'Asset'>(KIND.asset, UNCLEAR_SPEECH_CLIP);
    expect((await dispatch(LIBRARY_COMMANDS.setAssetLanguage, { assetId: id, language: 'vi' })).ok).toBe(
      true,
    );
    expect((await detail(UNCLEAR_SPEECH_CLIP)).asset).toMatchObject({
      language: 'vi',
      speech: { state: 'chosen', languages: ['vi'], confidence: null },
    });
    expect((await undo()).ok).toBe(true);
    expect((await detail(UNCLEAR_SPEECH_CLIP)).asset).toMatchObject({
      language: null,
      speech: { state: 'unclear' },
    });

    // Odia chosen on a Hindi and English clip: filed under Odia, and nothing written out.
    const mixed = fakeUlid<'Asset'>(KIND.asset, MIXED_SPEECH_CLIP);
    await dispatch(LIBRARY_COMMANDS.setAssetLanguage, { assetId: mixed, language: 'or' });
    const odia = await detail(MIXED_SPEECH_CLIP);
    expect(odia.asset.language).toBe('or');
    expect(odia.transcript).toBeNull();
    await dispatch(LIBRARY_COMMANDS.setAssetLanguage, { assetId: mixed, language: null });
    expect((await detail(MIXED_SPEECH_CLIP)).asset.speech).toMatchObject({ state: 'mixed' });
  });
});
