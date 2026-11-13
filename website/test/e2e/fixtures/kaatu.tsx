// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Kaatu's fixture (WEB2 lane L5): every pose, every mood, and every mode of the Kaatu API on one Playwright-only page,
 * never a route. test/e2e/kaatu.spec.ts renders it to HTML on the server side and hydrates it in the browser with a
 * bundle of kaatu-client.tsx, so it runs exactly as on the site. The dancing Kaatu dances to `kaatu-beat` events the
 * spec dispatches on window. Nothing here imports CSS or next/link.
 */
import type { ReactNode } from 'react';
import { KAATU_POSES, Kaatu, KaatuMoodProvider, type KaatuMood } from '../../../src/components/kaatu/kaatu';
import { POSES } from '../../../src/components/kaatu/kaatu-poses';

const MOODS: readonly KaatuMood[] = ['idle', 'glance', 'thinking', 'delighted', 'oops', 'asleep', 'wave'];

/** A beat source the spec drives: every `kaatu-beat` event on window is one music beat. */
function onBeat(listener: () => void): () => void {
  window.addEventListener('kaatu-beat', listener);
  return () => window.removeEventListener('kaatu-beat', listener);
}

function Cell({ name, children, note }: { readonly name: string; readonly children: ReactNode; readonly note?: string }) {
  return (
    <li data-fixture={name} className="flex flex-col items-center gap-2 rounded-window border border-rule-subtle bg-panel p-3">
      {children}
      <span className="type-meta text-ink-2">{name}</span>
      {note ? <span className="max-w-[16rem] text-center type-caption text-ink-3">{note}</span> : null}
    </li>
  );
}

export function KaatuFixture() {
  return (
    <main className="mx-auto flex max-w-site flex-col gap-10 px-gutter py-10">
      <h1 className="type-site-headline m-0 text-ink">Kaatu: every pose and mode</h1>

      <section aria-labelledby="poses" className="flex flex-col gap-4">
        <h2 id="poses" className="type-site-subhead m-0">
          Poses
        </h2>
        <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-4 p-0">
          {KAATU_POSES.map((pose) => (
            <Cell key={pose} name={`pose-${pose}`} note={POSES[pose].about}>
              <Kaatu pose={pose} size={120} />
            </Cell>
          ))}
        </ul>
      </section>

      <section aria-labelledby="moods" className="flex flex-col gap-4">
        <h2 id="moods" className="type-site-subhead m-0">
          Moods
        </h2>
        <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-4 p-0">
          {MOODS.map((mood) => (
            <Cell key={mood} name={`mood-${mood}`}>
              <Kaatu mood={mood} size={96} />
            </Cell>
          ))}
          <Cell name="section-thinking" note="A KaatuMoodProvider sets thinking">
            <KaatuMoodProvider mood="thinking">
              <Kaatu size={96} />
            </KaatuMoodProvider>
          </Cell>
        </ul>
      </section>

      <section aria-labelledby="modes" className="flex flex-col gap-4">
        <h2 id="modes" className="type-site-subhead m-0">
          Modes
        </h2>
        <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-4 p-0">
          <Cell name="interactive" note="Follows the pointer; poke it">
            <Kaatu interactive size={160} />
          </Cell>
          <Cell name="follow" note="Decoration that follows the pointer, inside an aria-hidden box">
            <span aria-hidden className="inline-flex">
              <Kaatu follow size={160} />
            </span>
          </Cell>
          <Cell name="interactive-pose" note="A posed button">
            <Kaatu pose="big-wave" interactive sticker size={160} />
          </Cell>
          <Cell name="sticker">
            <Kaatu pose="thumbs-up" sticker size={160} />
          </Cell>
          <Cell name="dancing" note="Dances to the spec's beats">
            <Kaatu beat={onBeat} size={160} />
          </Cell>
          <Cell name="dancing-pose">
            <Kaatu pose="headphones" beat={onBeat} size={160} />
          </Cell>
          <Cell name="large" note="240 px, the atlases' sharpest">
            <Kaatu pose="cheer" sticker size={240} />
          </Cell>
        </ul>
      </section>

      <div aria-hidden className="h-[160vh]" />

      <section aria-labelledby="below" className="flex flex-col gap-4 pb-[60vh]">
        <h2 id="below" className="type-site-subhead m-0">
          Below the fold
        </h2>
        <ul className="m-0 grid list-none grid-cols-[repeat(auto-fill,minmax(14rem,1fr))] gap-4 p-0">
          <Cell name="far" note="Paused until it is on screen">
            <Kaatu mood="idle" size={120} />
          </Cell>
          <Cell name="far-peek-left">
            <Kaatu pose="peek-left" size={160} />
          </Cell>
          <Cell name="far-peek-up">
            <Kaatu pose="peek-up" size={160} />
          </Cell>
          <Cell name="far-sticker">
            <Kaatu pose="heart-hands" sticker size={160} />
          </Cell>
        </ul>
      </section>
    </main>
  );
}
