// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type { CardOf, ExportOptions, MusicPath, TaalcutError, TimelineItemId } from '@taalcut/core';
import { useEffect, useState } from 'react';
import { clipShot, videoClips } from '../make/timeline-math';
import { useShotFrames } from '../make/use-shot-frames';
import { useCardActions } from './card-actions';
import { useCardData, useTimelineRead } from './card-data';
import { liveValue } from './live-read';
import { useAnswer } from './use-answer';

export type ExportApprovalCard = CardOf<'exportApproval'>;

/** One preset as the picker offers it: whether it fits, and why not when it doesn't. */
export interface PresetOption {
  readonly id: ExportApprovalCard['presetId'];
  readonly available: boolean;
  readonly reasonKey: string | undefined;
  readonly maxSeconds: number | undefined;
  readonly estimateBytes: number | undefined;
}

/**
 * The one approval's choices and answers (P2-M13), shared by the review page and the chat's summary card (UX4): the
 * preset, captions and music as you change them (each change a command, put back if it fails), a swap being folded
 * in, and Export and Not now. Export saves a changed preset or captions first, then answers the approval.
 */
export function useExportApproval(card: ExportApprovalCard) {
  const actions = useCardActions();
  const data = useCardData();
  const watched = useTimelineRead(card.timelineId);
  const live = liveValue(watched.read) ?? (watched.read.status === 'loading' ? undefined : null);
  const answer = useAnswer<'export' | 'decline'>(card.status === 'pending' || card.status === 'updating');
  const [preset, setPreset] = useState(card.presetId);
  const [burnIn, setBurnIn] = useState(card.captions.burnIn);
  const [music, setMusic] = useState<MusicPath>(card.music);
  const [options, setOptions] = useState<ExportOptions | null>(null);
  const [open, setOpen] = useState<TimelineItemId | null>(null);
  const [swapped, setSwapped] = useState(false);
  const [busy, setBusy] = useState<'export' | 'decline' | null>(null);
  const [error, setError] = useState<TaalcutError | null>(null);
  const frames = useShotFrames(live ? videoClips(live).map(clipShot) : []);

  // A new revision of the card is the agent's answer to a swap: the preview is current again.
  useEffect(() => setSwapped(false), [card.timelineRevision, card.status]);
  useEffect(() => {
    if (live?.music.path) setMusic(live.music.path);
  }, [live?.music.path]);
  useEffect(() => {
    if (!data.exportOptions) return;
    let alive = true;
    data.exportOptions(card.projectId, card.timelineId).then(
      (found) => alive && setOptions(found ?? null),
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [data, card.projectId, card.timelineId, music]);

  const status = card.status;
  const updating = status === 'updating' || swapped;
  const settled = status === 'exported' || status === 'declined' || status === 'expired';
  const off = settled || status === 'exporting' || busy !== null || !actions.dispatch;
  const canAnswer = answer.canAnswer;
  const canExport = !settled && !updating && canAnswer && busy === null && status !== 'exporting';

  const send = async (name: string, payload: unknown) => {
    setError(null);
    const result = await actions.dispatch?.(name, payload);
    if (result && !result.ok) setError(result.error);
    return result?.ok ?? false;
  };
  const chooseMusic = async (path: MusicPath, acknowledgedAt?: number) => {
    const before = music;
    if (!live) return;
    const choice =
      path === 'referenceAudio'
        ? live.template
          ? { path, templateId: live.template.id, gainDb: 0 }
          : null
        : path === 'ownTrack'
          ? live.music.path === 'ownTrack'
            ? live.music
            : null
          : { path };
    if (!choice) return;
    setMusic(path);
    const done = await send('music.choosePath', {
      projectId: card.projectId,
      timelineId: card.timelineId,
      choice,
      ...(acknowledgedAt === undefined ? {} : { acknowledgedAt }),
    });
    if (!done) setMusic(before);
  };
  const chooseCaptions = async (next: boolean) => {
    setBurnIn(next);
    const done = await send('captions.setEnabled', {
      projectId: card.projectId,
      timelineId: card.timelineId,
      enabled: next,
    });
    if (!done) setBurnIn(!next);
  };
  /** Resolves true once the run has taken the answer. */
  const exportNow = async (): Promise<boolean> => {
    if (!canExport || off) return false;
    setBusy('export');
    try {
      if (preset !== card.presetId || burnIn !== card.captions.burnIn) {
        const saved = await send('render.setExportPreset', {
          projectId: card.projectId,
          timelineId: card.timelineId,
          presetId: preset,
          captions: { burnIn, sidecars: card.captions.sidecars },
        });
        if (!saved) return false;
      }
      return (await answer.send('export', card.approvalId, 'approve')) !== null;
    } finally {
      setBusy(null);
    }
  };
  const notNow = async (): Promise<boolean> => {
    if (!canAnswer || off) return false;
    setBusy('decline');
    try {
      return (await answer.send('decline', card.approvalId, 'deny')) !== null;
    } finally {
      setBusy(null);
    }
  };

  // P3-V7: the note as the agent sent it; a Phase 2 card has none, so the live options' (when they carry one).
  const credentials = card.credentials ?? options?.credentials;
  const presetOptions: PresetOption[] = card.presets.map((id) => {
    const known = options?.presets.find((entry) => entry.preset.id === id);
    return {
      id,
      available: known?.available ?? true,
      reasonKey: known?.reasonKey,
      maxSeconds: known?.preset.duration.maxSeconds,
      estimateBytes: known?.estimate.bytes,
    };
  });

  return {
    status,
    live,
    watched,
    answer,
    frames,
    updating,
    settled,
    off,
    canAnswer,
    canExport,
    busy,
    error,
    preset,
    setPreset,
    burnIn,
    chooseCaptions,
    music,
    chooseMusic,
    options,
    credentials,
    presetOptions,
    openClip: open,
    setOpenClip: setOpen,
    markSwapped: () => setSwapped(true),
    exportNow,
    notNow,
  };
}

export type ExportApprovalState = ReturnType<typeof useExportApproval>;
