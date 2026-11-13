// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: Sounds trending in Edits, the showcase and its fragment · mode: Operate · system: WEB2 Remix Vernacular
 * the coded app window open on Make, with the shelf the app puts there once Instagram Edits is connected: Trending
 *   sounds & hooks, "Instagram Edits live"; the tabs the story needs and the licence filter switch real lists (no
 *   more on show: the page's words name every tab); each sound's row is its waveform, its hook drops marked in
 *   seconds, beside the reel it would cut; the chosen sound plays its waveform's playhead and shows where the hook
 *   drops; Cut with AI lays your next video's template on its beats, the AI scores your clips with Edits' vibe score
 *   as it cuts, and the video is staged in Edits (an ink pill) to post from there. The fragment is the shelf's list
 *   and the chosen sound's waveform, working.
 * states: the arrival (once, when scrolled to: the playhead runs to the hook, the hook's time pops, Cut with AI, the
 *   scores one by one, the stage card) · finished (the server's HTML and reduced motion) · Replay (default, hover,
 *   focus, active; plays the arrival again, said once to screen readers) · the parts' own (feed-tabs, sound-list,
 *   sound-studio, vibe-stage, waveform) · the stickers pop once and lean */

import { PlugZap, Send } from 'lucide-react';
import { useId } from 'react';
import { AppWindow } from '#components/ui/app-window';
import { buttonClasses } from '#components/ui/button-classes';
import { Sticker } from '#components/ui/sticker';
import { Chip } from '../chip';
import { SHOWCASE_ICONS } from '../icons';
import { ShowcasePlate } from '../plate';
import { Segmented } from '../segmented';
import { FeedTabs, tabId } from './feed-tabs';
import { SoundList } from './sound-list';
import { SoundStudio } from './sound-studio';
import { LICENCES, SHOWN_TABS, SOUNDS } from './sounds';
import { useShelf, type Shelf } from './use-shelf';
import { Waveform } from './waveform';

const DESCRIPTION = 'What is trending in Instagram Edits, each sound’s hook drop marked. Cut your next video on its beats.';

function Live() {
  return (
    <Chip tone="success">
      <PlugZap aria-hidden />
      Instagram Edits live
    </Chip>
  );
}

function Filters({ shelf, panel }: { readonly shelf: Shelf; readonly panel: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <FeedTabs value={shelf.tab} onChange={shelf.setTab} panel={panel} saved={shelf.saved.size} tabs={SHOWN_TABS} />
      <Segmented label="Audio licence" options={LICENCES} value={shelf.licence} onChange={shelf.setLicence} />
    </div>
  );
}

export function EditsShowcase() {
  const shelf = useShelf({ autoplay: true });
  const panel = useId();
  const Replay = SHOWCASE_ICONS.replay;
  const replaying = shelf.phase === 'play' && !shelf.reveal.stage;
  return (
    <div className="relative">
      <AppWindow title="Make" area="make" size="lg" fit="fluid">
        <ShowcasePlate
          slug="instagram-edits"
          label="Trending sounds and hooks from Instagram Edits, on Make"
          className="flex flex-col gap-5"
        >
          <header className="flex flex-col gap-3 border-b border-rule-subtle pb-4 @min-[52rem]:flex-row @min-[52rem]:items-start @min-[52rem]:justify-between">
            <div className="flex min-w-0 flex-col gap-1">
              <h3 className="m-0 flex items-center gap-2 type-page-title text-ink">
                <SHOWCASE_ICONS.music aria-hidden className="size-5 shrink-0 text-rose-strong" />
                Trending sounds &amp; hooks
              </h3>
              <p className="m-0 max-w-prose type-body text-ink-2">{DESCRIPTION}</p>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Live />
              <button type="button" onClick={shelf.replay} className={buttonClasses('quiet', 'md')}>
                <Replay aria-hidden className="size-4" />
                Replay
              </button>
              <span role="status" className="sr-only">
                {replaying ? 'Replaying: a sound plays to its hook, then Cut with AI.' : ''}
              </span>
            </div>
          </header>
          <Filters shelf={shelf} panel={panel} />
          <div
            ref={shelf.box}
            data-run={shelf.running ? 'playing' : 'done'}
            className="grid grid-cols-1 gap-5 @min-[60rem]:grid-cols-[minmax(0,24rem)_minmax(0,1fr)] @min-[60rem]:gap-6"
          >
            <SoundList
              id={panel}
              labelledBy={tabId(panel, shelf.tab)}
              sounds={shelf.sounds}
              listKey={`${shelf.tab}-${shelf.licence}`}
              fresh={shelf.fresh}
              chosen={shelf.chosen}
              at={shelf.at}
              saved={shelf.saved}
              onChoose={shelf.choose}
              onSave={shelf.toggleSave}
              onClear={shelf.clearFilters}
              reduce={shelf.reduce}
            />
            <div className="border-t border-rule-subtle pt-5 @min-[60rem]:border-t-0 @min-[60rem]:border-s @min-[60rem]:ps-6 @min-[60rem]:pt-0">
              <SoundStudio shelf={shelf} />
            </div>
          </div>
        </ShowcasePlate>
      </AppWindow>
      <span className="pointer-events-none absolute -top-5 right-4 max-sm:hidden [&>*]:pointer-events-auto">
        <Sticker field="paper" brand="instagram" tilt={4}>
          Edits, open on your Mac
        </Sticker>
      </span>
      <span className="pointer-events-none absolute -bottom-5 left-6 max-sm:hidden [&>*]:pointer-events-auto">
        <Sticker field="sky" icon={Send} tilt={-3} delay={0.12}>
          You post from Edits
        </Sticker>
      </span>
    </div>
  );
}

/** The features index's piece of the shelf: the trending list and the chosen sound's waveform, working. */
export function EditsFragment() {
  const shelf = useShelf({ autoplay: false });
  const trending = SOUNDS.filter((s) => s.tabs.includes('Trending')).slice(0, 3);
  return (
    <AppWindow title="Make" area="make" size="md" fit="fluid">
      <ShowcasePlate slug="instagram-edits-fragment" label="Trending sounds and hooks from Instagram Edits" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="m-0 flex items-center gap-2 type-section text-ink">
            <SHOWCASE_ICONS.music aria-hidden className="size-4 shrink-0 text-rose-strong" />
            Trending sounds &amp; hooks
          </h3>
          <Live />
        </div>
        <SoundList
          sounds={trending}
          listKey="trending"
          fresh={false}
          chosen={shelf.chosen}
          at={shelf.at}
          saved={shelf.saved}
          onChoose={shelf.choose}
          onSave={shelf.toggleSave}
          reduce={shelf.reduce}
          compact
        />
        <Waveform sound={shelf.sound} at={shelf.at} cut={false} reduce={shelf.reduce} bars={56} />
        <p className="m-0 type-meta text-ink-2">Choose a sound to play it and see where its hook drops.</p>
      </ShowcasePlate>
    </AppWindow>
  );
}
