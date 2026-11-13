// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: the chosen sound · mode: Operate · system: WEB2 Remix Vernacular (rose the beat, violet the AI, teal
 *   yours, the playhead a marigold line)
 * the sound you chose from the shelf: its name, artist, length and licence; Play, Save audio and Cut with AI; its
 *   waveform with the hook drops marked in seconds; once Cut with AI has run, your next video's template laid on the
 *   sound (the segment bar, Hook to Outro, rose music-beat ticks, each cut on a beat) and the cut lines down the
 *   waveform; then the vibe scores the AI used and the hand-off to Edits (vibe-stage.tsx)
 * states: Play: default · hover · focus · active · playing (Pause) · Save audio: saved (aria-pressed, teal) · Cut with
 *   AI: default · cutting (its words, aria-busy) · cut (the bar is laid, the button says Cut again) · not cut yet (a
 *   dashed ghost where the bar goes, one line) · the waveform's, the scores' and the card's own
 * motion: the segment bar rises 6 px and fades in, then fills from the playhead while it plays; reduced motion: at
 *   once, no fill motion */

import { Bookmark, BookmarkCheck, Pause, Play } from 'lucide-react';
import { motion, useMotionValue } from 'motion/react';
import { useEffect, useMemo } from 'react';
import { AiMark } from '#components/brand/ai-mark';
import { SegmentBar } from '#components/ui/segment-bar';
import { buttonClasses } from '#components/ui/button-classes';
import { cn } from '#lib/cn';
import { EASE_OUT } from '#lib/motion';
import { Chip } from '../chip';
import { beatsOf, cutOf, hookLabel, hooksOf } from './sounds';
import type { Shelf } from './use-shelf';
import { StageCard, VibeScores } from './vibe-stage';
import { Waveform } from './waveform';

/** The template Cut with AI laid on the sound, under the waveform on the same clock. */
function CutBar({ shelf, shown }: { readonly shelf: Shelf; readonly shown: boolean }) {
  const { sound, at, playing, reduce } = shelf;
  const slots = useMemo(() => cutOf(sound), [sound]);
  const end = slots.at(-1)?.end ?? sound.durationSec;
  const time = useMotionValue(end);
  useEffect(() => {
    time.set(at ?? end);
  }, [at, end, time]);
  const beats = useMemo(() => beatsOf(sound).filter((b) => b <= end + 0.01), [sound, end]);
  const segments = slots.map((s) => ({ start: s.start, end: s.end, group: s.group }));
  return (
    <div className="relative px-2">
      <motion.div
        style={{ width: `${((end / sound.durationSec) * 100).toFixed(3)}%` }}
        initial={false}
        animate={{ opacity: shown ? 1 : 0, y: shown ? 0 : 6 }}
        transition={reduce || !shown ? { duration: reduce ? 0.15 : 0 } : { duration: 0.4, ease: EASE_OUT }}
        className={cn(!shelf.cut && 'invisible')}
      >
        <SegmentBar
          segments={segments}
          beats={beats}
          time={time}
          state={playing ? 'playing' : 'filled'}
          layout="time"
          tone="surface"
          labels
          label={`Your next video’s template on this sound: ${slots.length} slots, the hook up to ${hookLabel(slots[0]?.end ?? 0)}, each cut on a music beat`}
        />
      </motion.div>
      {shelf.cut ? null : (
        <p className="absolute inset-x-2 inset-y-0 m-0 flex items-center justify-center rounded-lg border border-dashed border-rule-strong px-3 text-center type-meta text-ink-2">
          Cut with AI lays your next video’s cuts on this sound’s beats.
        </p>
      )}
    </div>
  );
}

export function SoundStudio({ shelf }: { readonly shelf: Shelf }) {
  const { sound, playing, at, cut, reveal, reduce, cutting } = shelf;
  const saved = shelf.saved.has(sound.id);
  const licence = sound.licence === 'royalty_free' ? 'Royalty-free' : sound.licence === 'licensed' ? 'Licensed' : null;
  const slots = cutOf(sound).length;
  return (
    <div data-slot="sound-studio" className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h4 className="m-0 type-page-title text-ink">{sound.title}</h4>
          <p className="m-0 flex flex-wrap items-center gap-2 type-meta text-ink-2">
            <span>{sound.artist}</span>
            <span aria-hidden>·</span>
            <span className="tabular-nums">{Math.round(sound.durationSec)} s</span>
            {licence ? <Chip tone={sound.licence === 'royalty_free' ? 'you' : 'neutral'}>{licence}</Chip> : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={shelf.togglePlay} className={buttonClasses('secondary', 'md')}>
            {playing ? <Pause aria-hidden className="size-4" /> : <Play aria-hidden className="size-4" />}
            {playing ? 'Pause' : 'Play'}
          </button>
          <button
            type="button"
            aria-pressed={saved}
            onClick={() => shelf.toggleSave(sound.id)}
            className={buttonClasses('quiet', 'md', saved ? 'text-teal-strong! hover:text-teal-strong!' : undefined)}
          >
            {saved ? <BookmarkCheck aria-hidden className="size-4" /> : <Bookmark aria-hidden className="size-4" />}
            {saved ? 'Saved' : 'Save audio'}
          </button>
          <button
            type="button"
            aria-busy={cutting || undefined}
            onClick={shelf.cutWithAi}
            className={buttonClasses('secondary', 'md', 'border-violet-strong/40! text-violet-strong!')}
          >
            <AiMark className="size-4" />
            {cutting ? 'Cutting with AI…' : cut ? 'Cut again' : 'Cut with AI'}
          </button>
        </div>
      </div>
      <Waveform sound={sound} at={at} cut={cut && reveal.cut} hooks={reveal.hooks} reduce={reduce} />
      <CutBar shelf={shelf} shown={cut && reveal.cut} />
      <p role="status" className="m-0 min-h-[1lh] type-meta text-ink-2">
        {cutting
          ? 'The AI is cutting your clips to this sound…'
          : cut && reveal.cut
            ? `Cut with AI: ${slots} slots, each cut on a music beat, the hook up to ${hookLabel(hooksOf(sound)[0] ?? 0)}.`
            : ''}
      </p>
      <VibeScores cut={cut} shown={reveal.scores} reduce={reduce} />
      <StageCard
        sound={sound}
        cut={cut}
        status={shelf.stage}
        shown={reveal.stage}
        reduce={reduce}
        onStage={shelf.stageInEdits}
      />
    </div>
  );
}
