// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: export section "Music" · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.7 · music made for this video first when there is some (the AI mark and the word, its
 *   tempo), then the kit's MusicPathPicker (REF1: "Music in the video" on, the reel's music by default, with its
 *   one line on platforms muting music; your own track; off, the add-this-sound steps for the export's app, with
 *   the reel's link and sound); without made music, "Generate music…" asks Taalcut in the chat, where the
 *   cost shows first (a paid follow-up; the Taalcut music pack row stays hidden while the pack is empty); then the
 *   mix: "Lower the music under the voice" (music.setDucking) and the hits on the cuts (MixRows).
 * states: default · made music chosen (its row checked) · made music set aside ("Use it again") · hover/focus/
 *   active (rows, buttons) · disabled (while the export starts; a path that isn't available, with why) · loading
 *   (the picker waits, a button spins) · error (the cause under the picker) · success (silent: the row is checked)
 * pre-emit critique: P5 H4 E4 S5 R4 V4
 */
import { useLingui } from '@lingui/react/macro';
import { MUSIC_COMMANDS, type MusicChoice, type MusicPath, type TaalcutError } from '@taalcut/core';
import { AiMark, Button, ErrorLine, MusicPathPicker } from '@taalcut/ui';
import { useEffect, useState } from 'react';
import { MixRows } from './mix-rows';
import { AskRow, SectionFrame } from './section-frame';
import type { ExportSection, SectionProps } from './types';

type Made = Extract<MusicChoice, { path: 'generated' }>;

function MadeMusic({
  made,
  chosen,
  busy,
  disabled,
  onUse,
}: {
  made: Made;
  chosen: boolean;
  busy: boolean;
  disabled: boolean;
  onUse: () => void;
}) {
  const { t, i18n } = useLingui();
  const bpm = i18n.number(Math.round(made.bpm));
  return (
    <div
      data-slot="made-music"
      data-chosen={chosen}
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-rule-subtle pb-2.5"
    >
      <span className="flex min-w-0 flex-1 items-center gap-2 type-body text-ink">
        <AiMark className="size-4" />
        <span className="min-w-0">
          {t`Music Taalcut made for this video`}
          <span className="block type-meta text-ink-2 tabular-nums">{t`${bpm} beats a minute, cut on its beats`}</span>
        </span>
      </span>
      {chosen ? (
        <span className="type-label-sm text-ink-2">{t`In the video`}</span>
      ) : (
        <Button size="sm" variant="secondary" loading={busy} disabled={disabled} onClick={onUse}>
          {t`Use it again`}
        </Button>
      )}
    </div>
  );
}

function Music(props: SectionProps) {
  const { context, choices, dispatch, ask, disabled } = props;
  const { t } = useLingui();
  const { options, timeline, projectId, timelineId } = context;
  const current = options.music.current;
  const [made, setMade] = useState<Made | null>(current.path === 'generated' ? current : null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<TaalcutError | null>(null);
  useEffect(() => {
    if (current.path === 'generated') setMade(current);
  }, [current]);

  // The steps are for the app this export is for; a file for this Mac lets the person pick the app.
  const platform =
    options.presets.find((entry) => entry.preset.id === choices.presetId)?.preset.platform ?? null;

  const choose = async (choice: MusicChoice) => {
    setBusy(true);
    setError(null);
    const result = await dispatch(MUSIC_COMMANDS.choosePath, { projectId, timelineId, choice });
    setBusy(false);
    if (!result.ok) setError(result.error);
  };
  const pick = async (path: MusicPath) => {
    const choice: MusicChoice | null =
      path === 'platformSound' || path === 'none'
        ? { path }
        : path === 'referenceAudio' && timeline.template
          ? { path, templateId: timeline.template.id, gainDb: 0 }
          : path === 'ownTrack' && current.path === 'ownTrack'
            ? current
            : path === 'generated' && made
              ? made
              : null;
    if (choice) await choose(choice);
  };

  return (
    <SectionFrame id="music" title={t`Music`}>
      {made ? (
        <MadeMusic
          made={made}
          chosen={current.path === 'generated'}
          busy={busy}
          disabled={disabled}
          onUse={() => void choose(made)}
        />
      ) : null}
      <MusicPathPicker
        value={current.path}
        onChange={pick}
        disabled={disabled || busy}
        referenceAudio={{ available: options.music.referenceAudioAvailable }}
        ownTrack={{ available: current.path === 'ownTrack' }}
        platformSound={options.music.platformSound}
        platform={platform}
      />
      {made ? null : (
        <AskRow
          label={t`Music made for this video`}
          note={t`Taalcut makes it in the chat, with what it costs before it starts.`}
          action={t`Generate music…`}
          disabled={disabled}
          onAsk={() => ask(t`Make music for this video that lands on its beats.`)}
        />
      )}
      {error ? <ErrorLine error={error} /> : null}
      <MixRows {...props} />
    </SectionFrame>
  );
}

export const musicSection: ExportSection = { id: 'music', available: () => true, Component: Music };
