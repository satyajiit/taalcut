// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The clip page's spoken-language states (LIB1-LANG), as edge-clips.ts keeps its own: reachable by id only, so the
 * grid, search and their counts stay as they are. Speech Taalcut couldn't place ("Speech, language unclear"), Hindi
 * and English in one clip, and Odia, which nothing here writes out yet: its transcript step is skipped with the
 * honest reason. And a second or two of speech the transcriber wrote nothing down for: no language, and no "No one
 * speaks". And a clip analysed before LIB1, whose old guess the library holds back until Taalcut decides its
 * language again (`languagePending`). `library.setAssetLanguage` corrects any clip, as the real one does: the choice files the clip at
 * once and wins over what was heard; null gives it back; the inverse restores the previous choice.
 */
import {
  defineCommand,
  effectiveLanguage,
  err,
  LIBRARY_COMMANDS,
  libraryCommandPayloads,
  NotFoundError,
  ok,
  type AnyCommand,
  type AssetDetail,
  type AssetSummary,
  type EventBus,
  type Id,
  type SpokenLanguage,
} from '@taalcut/core';
import { DEFAULT_ASSET_COUNT, fakeAsset, KIND, type FakeAsset, type FakeSource } from './assets';
import type { ClipStore } from './clip-commands';
import { SPEECH } from './scenes';
import { fakeUlid } from './seed';

/** Their numbers for fakeUlid(KIND.asset, n): past the edge clips. */
export const UNCLEAR_SPEECH_CLIP = 90_011;
export const MIXED_SPEECH_CLIP = 90_012;
export const ODIA_SPEECH_CLIP = 90_013;
/** A second or two of speech nobody could place, and that the transcriber wrote nothing down for. */
export const BRIEF_SPEECH_CLIP = 90_014;
/** Analysed before LIB1: its old guess is held back until Taalcut decides its language again. */
export const RECHECK_SPEECH_CLIP = 90_015;

/** The languages no engine here writes out (packages/audio SPEC.md): their transcript step is skipped. */
const UNWRITTEN: ReadonlySet<string> = new Set(['or', 'mai', 'sat', 'brx', 'doi', 'ks', 'kok', 'mni']);

type Outcome = NonNullable<AssetSummary['speech']>;

const HEARD: Readonly<Record<number, Outcome>> = {
  [UNCLEAR_SPEECH_CLIP]: { state: 'unclear', languages: [], confidence: 0.41 },
  [MIXED_SPEECH_CLIP]: { state: 'mixed', languages: ['hi', 'en'], confidence: 0.88 },
  [ODIA_SPEECH_CLIP]: { state: 'detected', languages: ['or'], confidence: 0.93 },
  [BRIEF_SPEECH_CLIP]: { state: 'unclear', languages: [], confidence: 0.21 },
};

/** The first finished generated clip with speech in `language` (any, for null), from `from` on. */
function spokenClip(sources: readonly FakeSource[], language: string | null, from: number): FakeAsset {
  for (let n = from; n < DEFAULT_ASSET_COUNT; n += 1) {
    const asset = fakeAsset(n, DEFAULT_ASSET_COUNT, sources);
    const speech = asset.extras.speech === null ? null : SPEECH[asset.extras.speech];
    if (asset.summary.index.state === 'done' && speech && (!language || speech.language === language))
      return asset;
  }
  return fakeAsset(from, DEFAULT_ASSET_COUNT, sources);
}

function asClip(base: FakeAsset, n: number, keepSpeech: boolean): FakeAsset {
  const heard = HEARD[n]!;
  return {
    summary: {
      ...base.summary,
      id: fakeUlid<'Asset'>(KIND.asset, n),
      language: effectiveLanguage(heard),
      speech: heard,
    },
    // Odia: nothing was written out, so the generator has no lines for it.
    extras: { ...base.extras, n, ...(keepSpeech ? {} : { speech: null }) },
  };
}

/** As the library reads an old clip: its old step's guess held back, no decision yet, being decided again. */
function asRecheck(base: FakeAsset, n: number): FakeAsset {
  const { speech: _none, ...summary } = base.summary;
  return {
    summary: { ...summary, id: fakeUlid<'Asset'>(KIND.asset, n), language: null, languagePending: true },
    extras: { ...base.extras, n },
  };
}

export function languageClips(sources: readonly FakeSource[]): FakeAsset[] {
  if (sources.length === 0) return [];
  return [
    asClip(spokenClip(sources, null, 2100), UNCLEAR_SPEECH_CLIP, true),
    asClip(spokenClip(sources, 'hi', 2200), MIXED_SPEECH_CLIP, true),
    asClip(spokenClip(sources, null, 2300), ODIA_SPEECH_CLIP, false),
    asClip(spokenClip(sources, null, 2400), BRIEF_SPEECH_CLIP, true),
    asRecheck(spokenClip(sources, null, 2500), RECHECK_SPEECH_CLIP),
  ];
}

/**
 * The generated detail, told the truth about a clip in a language nothing here writes out: its language was heard,
 * and its transcript step was skipped with the reason (no transcript). Other clips are as they were.
 */
export function languageDetail(detail: AssetDetail): AssetDetail {
  // As the library reads it: an empty transcript in the clip's settled language, `und` when unclear (LIB1-LANG).
  if (detail.asset.id === fakeUlid<'Asset'>(KIND.asset, BRIEF_SPEECH_CLIP))
    return { ...detail, transcript: { language: 'und', lines: [], truncated: false } };
  // A held language names no transcript language either; the old words stay.
  if (detail.asset.languagePending && detail.transcript)
    return { ...detail, transcript: { ...detail.transcript, language: 'und' } };
  const language = detail.asset.language;
  if (!language || !UNWRITTEN.has(language)) return detail;
  return {
    ...detail,
    transcript: null,
    stages: detail.stages.map((row) =>
      row.stage === 'audio.language' && row.state === 'skipped'
        ? { stage: row.stage, state: 'done' as const, ...(row.milestone ? { milestone: row.milestone } : {}) }
        : row.stage === 'audio.transcript' && (row.state === 'skipped' || row.state === 'done')
          ? {
              stage: row.stage,
              state: 'skipped' as const,
              reasonKey: 'indexing.skip.cannotTranscribe',
              ...(row.milestone ? { milestone: row.milestone } : {}),
            }
          : row,
    ),
  };
}

/** `library.setAssetLanguage` on the fake's clips: what was heard is kept, so null (and an undo) gives it back. */
export function createLanguageCommand(events: EventBus, store: ClipStore): AnyCommand {
  const heard = new Map<string, Pick<AssetSummary, 'speech' | 'language' | 'languagePending'>>();
  const chosen = new Map<string, SpokenLanguage | null>();
  return defineCommand({
    name: LIBRARY_COMMANDS.setAssetLanguage,
    payload: libraryCommandPayloads[LIBRARY_COMMANDS.setAssetLanguage],
    sideEffect: 'write',
    project: () => null,
    handle: async ({ assetId, language }) => {
      const asset = store.find(assetId);
      if (!asset) return err(NotFoundError({ entity: 'asset', id: assetId }));
      const { speech: was, language: filed, languagePending: held } = asset.summary;
      if (!heard.has(assetId))
        heard.set(assetId, { speech: was, language: filed, ...(held ? { languagePending: held } : {}) });
      const previous = chosen.get(assetId) ?? null;
      chosen.set(assetId, language);
      const before = heard.get(assetId)!;
      const speech: Outcome | undefined = language
        ? { state: 'chosen', languages: [language], confidence: null }
        : before.speech;
      const effective = speech ? effectiveLanguage(speech) : before.language;
      // A choice is a decision: a held clip names it at once; null gives back what was there.
      const pending = !language && before.languagePending ? { languagePending: before.languagePending } : {};
      const { speech: _dropped, languagePending: _held, ...rest } = asset.summary;
      store.put({
        ...asset,
        summary: { ...rest, ...(speech ? { speech } : {}), ...pending, language: effective },
      });
      events.emit('library.changed', {
        projectId: null,
        entity: 'asset',
        change: 'updated',
        ids: [assetId as Id<'Asset'>],
      });
      return ok({
        result: { assetId, language, effective },
        inverse: { name: LIBRARY_COMMANDS.setAssetLanguage, payload: { assetId, language: previous } },
      });
    },
  });
}
