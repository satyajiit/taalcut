// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Impeccable · Operate · component: clip inspector (UX4) · system: DESIGN.md v0.6 + UX4 (icon registry)
 * one clip, in the column beside the viewer: its number, shot type, when and how long, then its own actions
 *   (Lock, Add to chat) right under them so they stay on screen at 1280×800 (UX4: its trims moved to the
 *   transport's edit tools, beside Undo); what the template asks for; the shot playing now (the AI's pick with its
 *   mark and confidence, or "You" on your swap); the other shots as 9:16 frames, pressing one swaps it in (the
 *   frame moves into the pick's place), "Find something else" for fresh ones
 * states: buttons and frames carry the eight · locked (swaps and trims off, the reason in words) · loading (the
 *   pressed frame dims, the button spins) · error (the editor's line under the transport) · success (silent:
 *   the cut shows it) · empty (no other shots: Find something else alone) */
import { useLingui } from '@lingui/react/macro';
import { callRpc, MIN_CLIP_FRAMES, type CastCandidate, type ShotId, type Timeline } from '@taalcut/core';
import {
  AiMarkIcon,
  AlternatesStrip,
  Button,
  Confidence,
  SHOT_TYPE_LABELS,
  ShotThumb,
  shotKey,
  UserContent,
  useTimecode,
  useShortcutFormat,
  VERB_ICONS,
} from '@taalcut/ui';
import { Lock, LockOpen } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useBackend } from '../../backend/backend';
import { ClipEditControls } from './clip-edit-controls';
import { ACCELERATORS } from './keys';
import { mediaOf, type ClipView, type TimelineModel } from './model';
import type { ShotLookup } from './shot-frames';
import type { SelectionTool } from './selection-tool';
import { ClipTrimControls } from './clip-trim-controls';
import type { Edits } from './use-edits';

export interface ClipInspectorProps {
  tool?: SelectionTool;
  model: TimelineModel;
  timeline: Timeline;
  clip: ClipView;
  edits: Edits;
  lookup: ShotLookup;
  onAddToChat: () => void;
}

export function ClipInspector({
  model,
  timeline,
  clip,
  edits,
  lookup,
  onAddToChat,
  tool = 'more',
}: ClipInspectorProps) {
  const { t, i18n } = useLingui();
  const time = useTimecode();
  const shortcut = useShortcutFormat();
  const addKeys = shortcut.text(ACCELERATORS.addToChat);
  const backend = useBackend();
  const [found, setFound] = useState<readonly CastCandidate[]>([]);
  const [finding, setFinding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [, setLoaded] = useState(0);
  const clipId = clip.item.id;
  const cast = clip.cast;
  const locked = clip.item.locked;
  const media = mediaOf(clip.item);

  // Another clip: its own shots.
  useEffect(() => setFound([]), [clipId]);

  const shown = [...(cast?.alternates ?? []), ...found].filter(
    (candidate, index, all) =>
      all.findIndex((other) => shotKey(other) === shotKey(candidate)) === index &&
      !(candidate.assetId === media.assetId && candidate.shotId === media.shotId),
  );
  const keys = shown.map(shotKey).join(' ');
  // Found shots can come from files the timeline doesn't name yet: load their pictures.
  useEffect(() => {
    let live = true;
    const missing = shown.filter((candidate) => lookup.loaded(candidate.assetId) === undefined);
    if (missing.length === 0) return;
    void Promise.all(missing.map((candidate) => lookup.detail(candidate.assetId))).then(() => {
      if (live) setLoaded((n) => n + 1);
    });
    return () => {
      live = false;
    };
  }, [keys, lookup]);

  const n = i18n.number(clip.number);
  const shotType = clip.slot?.intent.shotType;
  const kind = shotType ? i18n._(SHOT_TYPE_LABELS[shotType]) : null;
  const length = clip.end - clip.start;
  const beat = model.beatFrames;
  const canShorten = !locked && length - beat >= MIN_CLIP_FRAMES;
  const pick = lookup.frameNow(media.assetId, media.shotId);
  const ask = clip.slot?.intent.text?.trim() ? clip.slot.intent.text : null;

  const run = async (key: string, action: () => Promise<unknown>) => {
    setBusy(key);
    try {
      await action();
    } finally {
      setBusy(null);
    }
  };

  const findMore = async () => {
    if (!clip.item.slotId) return;
    setFinding(true);
    const exclude = [cast?.pick, ...shown]
      .map((candidate) => candidate?.shotId)
      .filter((id): id is ShotId => !!id);
    const result = await callRpc(
      backend.timelines.findAlternates({
        timelineId: timeline.id,
        slotId: clip.item.slotId,
        exclude,
        limit: 6,
      }),
    );
    setFinding(false);
    if (result.ok) setFound((before) => [...before, ...result.value]);
  };

  const fromCast = new Set((cast?.alternates ?? []).map(shotKey));
  return (
    <div data-slot="clip-inspector" className="flex flex-col gap-4">
      <div className="flex flex-col gap-0.5">
        <h2 className="m-0 type-card-title text-ink">
          {t`Clip ${n}`}
          {kind ? <span className="font-normal text-ink-2"> · {kind}</span> : null}
        </h2>
        <p className="m-0 type-meta text-ink-2 tabular-nums">
          {time.clock(clip.start, model.rate)} · {time.length(length, model.rate)}
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-1.5" data-slot="clip-actions">
        <Button
          size="sm"
          variant="ghost"
          aria-pressed={locked}
          loading={busy === 'lock'}
          icon={locked ? LockOpen : Lock}
          onClick={() => void run('lock', () => edits.lock(clipId, !locked))}
        >
          {locked ? t`Unlock` : t`Lock`}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          aria-keyshortcuts={shortcut.aria(ACCELERATORS.addToChat)}
          title={t`Add to chat (${addKeys})`}
          icon={VERB_ICONS.addToChat}
          onClick={onAddToChat}
        >
          {t`Add to chat`}
        </Button>
      </div>
      {locked ? (
        <p className="m-0 type-meta text-ink-2">{t`Locked: Taalcut and your edits leave it as it is. Unlock it to change it.`}</p>
      ) : !canShorten ? (
        <p className="m-0 type-meta text-ink-2">{t`It can’t get any shorter.`}</p>
      ) : null}

      {tool === 'more' ? (
        <details>
          <summary className="cursor-pointer type-label text-ink-2">{t`Source details`}</summary>
          {ask ? (
            <div className="flex flex-col gap-1">
              <p className="m-0 type-meta text-ink-2">{t`The template asks for`}</p>
              <p className="m-0 type-body text-ink">
                <UserContent>{ask}</UserContent>
              </p>
            </div>
          ) : null}

          <div className="flex items-start gap-3" data-slot="clip-pick">
            <ShotThumb url={pick?.url} size="lg" marker={clip.chosenBy} layoutId={`shot:${shotKey(media)}`} />
            <div className="flex min-w-0 flex-col gap-1.5">
              {pick ? (
                <UserContent translate="no" className="truncate text-sm font-medium text-ink">
                  {pick.name}
                </UserContent>
              ) : null}
              {pick?.description ? (
                <p className="m-0 line-clamp-3 text-xs text-ink-2">
                  <UserContent>{pick.description}</UserContent>
                </p>
              ) : null}
              {clip.chosenBy === 'ai' ? (
                <span className="inline-flex items-center gap-1 text-xs text-ink-2">
                  <AiMarkIcon aria-hidden className="size-3.5 text-ai-strong" />
                  {t`Taalcut picked this`}
                </span>
              ) : clip.chosenBy === 'you' ? (
                <span className="inline-flex items-center gap-1.5 text-xs text-ink-2">
                  <span className="rounded-sm bg-you-soft px-1 type-caption text-you-strong">{t`You`}</span>
                  {t`You changed this`}
                </span>
              ) : null}
              {clip.chosenBy === 'ai' && cast ? (
                <Confidence value={cast.confidence} reranked={cast.note === 'reranked'} />
              ) : null}
            </div>
          </div>
        </details>
      ) : null}
      {tool === 'replace' ? (
        <section className="flex flex-col gap-2" aria-labelledby="clip-others">
          <h3 id="clip-others" className="m-0 type-label text-ink-2">
            {t`Other shots`}
          </h3>
          <AlternatesStrip
            items={shown.map((candidate) => ({
              key: shotKey(candidate),
              frame: lookup.frameNow(candidate.assetId, candidate.shotId),
              layoutId: `shot:${shotKey(candidate)}`,
            }))}
            size="md"
            disabled={locked}
            swapping={busy?.startsWith('swap:') ? Number(busy.slice(5)) : null}
            label={t`Other shots for clip ${n}`}
            finding={finding}
            {...(clip.item.slotId && !locked ? { onFindMore: () => void findMore() } : {})}
            emptyAction={
              clip.item.slotId ? null : (
                <p className="m-0 text-xs text-ink-2">{t`No other shots for this clip.`}</p>
              )
            }
            onSwap={(index) => {
              const candidate = shown[index];
              if (!candidate || locked) return;
              const from = fromCast.has(shotKey(candidate)) ? 'alternate' : 'search';
              void run(`swap:${index}`, () => edits.swap(clipId, candidate, from));
            }}
          />
          {clip.item.slotId && !locked && shown.length === 0 ? (
            <Button
              size="sm"
              variant="secondary"
              className="self-start"
              loading={finding}
              icon={VERB_ICONS.findSimilar}
              onClick={() => void findMore()}
            >
              {t`Find something else`}
            </Button>
          ) : null}
        </section>
      ) : null}
      {tool === 'trim' ? <ClipTrimControls clip={clip} model={model} edits={edits} /> : null}
      {tool === 'sound' || tool === 'more' ? (
        <ClipEditControls model={model} clip={clip} edits={edits} section={tool} />
      ) : null}
    </div>
  );
}
