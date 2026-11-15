// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Impeccable · Operate · component: clip inspector (UX4) · system: DESIGN.md v0.6 + UX4 (icon registry)
 * one clip, in the column beside the viewer: its number, shot type, when and how long, then its own actions
 *   (Lock, Add to chat: scene-actions.tsx) right under them so they stay on screen at 1280×800 (UX4: its trims
 *   moved to the transport's edit tools, beside Undo); under Replace, the other shots as 9:16 frames, pressing one
 *   swaps it in (the frame moves into the pick's place), "Find something else" for fresh ones; under Sound, its
 *   own sound (clip-edit-controls.tsx); the Trim tool is "pick the part" (TRIM1, clip-part/clip-part.tsx) under
 *   its own title, with these actions beside it. The More tab is its own gallery (MORE1, more/more-gallery.tsx)
 * states: buttons and frames carry the eight · locked (swaps and trims off, the reason in words) · loading (the
 *   pressed frame dims, the button spins) · error (the editor's line under the transport) · success (silent:
 *   the cut shows it) · empty (no other shots: Find something else alone) */
import { useLingui } from '@lingui/react/macro';
import { callRpc, MIN_CLIP_FRAMES, type CastCandidate, type ShotId, type Timeline } from '@taalcut/core';
import { AlternatesStrip, Button, SHOT_TYPE_LABELS, shotKey, useTimecode, VERB_ICONS } from '@taalcut/ui';
import { useEffect, useState } from 'react';
import { useBackend } from '../../backend/backend';
import { ClipEditControls } from './clip-edit-controls';
import { mediaOf, type ClipView, type TimelineModel } from './model';
import { SceneActions } from './scene-actions';
import type { ShotLookup } from './shot-frames';
import type { SelectionTool } from './selection-tool';
import { ClipPart } from './clip-part/clip-part';
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
  tool = 'replace',
}: ClipInspectorProps) {
  const { t, i18n } = useLingui();
  const time = useTimecode();
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
  const actions = <SceneActions clip={clip} edits={edits} onAddToChat={onAddToChat} />;
  // TRIM1: the Trim tool is "pick the part": its own title, the clip's actions beside it, the exact trim folded.
  if (tool === 'trim')
    return (
      <div data-slot="clip-inspector" className="flex flex-col gap-4">
        <ClipPart clip={clip} model={model} edits={edits} lookup={lookup} actions={actions} />
      </div>
    );
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

      {actions}
      {locked ? (
        <p className="m-0 type-meta text-ink-2">{t`Locked: Taalcut and your edits leave it as it is. Unlock it to change it.`}</p>
      ) : !canShorten ? (
        <p className="m-0 type-meta text-ink-2">{t`It can’t get any shorter.`}</p>
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
      {tool === 'sound' ? <ClipEditControls model={model} clip={clip} edits={edits} /> : null}
    </div>
  );
}
