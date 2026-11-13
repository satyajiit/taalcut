// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The primitives fixture (WEB2 foundation): every components/ui primitive, the brand icons and Kaatu's API in their
 * states, rendered to static HTML from the real components. test/e2e/primitives.spec.ts serves it on the built
 * site's origin, so it wears the site's own CSS and media. Playwright only: never a route of the site. Its own
 * layout is inline styles, since Tailwind only builds the classes it finds under src/.
 */
import { Check, Clapperboard, Copy, Images, Music, Shapes } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { AiMark } from '../../../src/components/brand/ai-mark';
import { BrandIcon } from '../../../src/components/brand/brand-icon';
import { SVGL } from '../../../src/components/brand/svgl/manifest';
import { Kaatu } from '../../../src/components/kaatu/kaatu';
import { AppWindow } from '../../../src/components/ui/app-window';
import { buttonClasses } from '../../../src/components/ui/button-classes';
import { IconText } from '../../../src/components/ui/icon-text';
import { ReelFrame } from '../../../src/components/ui/reel-frame';
import { Arrive, Section } from '../../../src/components/ui/section';
import { SegmentBar } from '../../../src/components/ui/segment-bar';
import type { Segment } from '../../../src/components/ui/segments';
import { Sticker, type StickerField } from '../../../src/components/ui/sticker';
import { DEFAULT_REEL_ID, reelById } from '../../../src/content/reels';

const reel = reelById(DEFAULT_REEL_ID);
const segments: Segment[] = reel.slots.map((s) => ({ start: s.start, end: s.end, group: s.role, unsure: s.uncertainCut }));
const row: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 24, alignItems: 'center' };
const label: CSSProperties = { fontSize: 12, fontWeight: 600, letterSpacing: '0.02em', opacity: 0.7, margin: '0 0 12px' };

function Block({ name, children, style }: { readonly name: string; readonly children: ReactNode; readonly style?: CSSProperties }) {
  return (
    <div data-fixture={name} style={{ marginTop: 56, ...style }}>
      <p style={label}>{name}</p>
      {children}
    </div>
  );
}

function SlotRow({ n, part, beat, time }: { readonly n: number; readonly part: string; readonly beat: string; readonly time: string }) {
  return (
    <li className="flex items-center gap-3 border-b border-rule-subtle px-4 py-3">
      <span className="type-label text-ink-3">{n}</span>
      <span className="inline-flex h-9 w-16 items-end justify-end rounded-md bg-viewer p-1">
        <span className="type-timecode text-viewer-ink">{time}</span>
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="type-label font-semibold text-ink">
          Slot {n} ({part})
        </span>
        <span className="type-meta text-ink-2">{beat}</span>
      </span>
      <span className="inline-flex items-center gap-1.5 rounded-pill bg-violet-soft px-3 py-1 type-label text-violet-strong">
        <AiMark className="size-4" />
        AI pick
      </span>
      <Check aria-hidden className="size-4 text-teal-strong" />
    </li>
  );
}

function Window({ platform, sidebar }: { readonly platform: 'mac' | 'ubuntu'; readonly sidebar: boolean }) {
  return (
    <AppWindow title="Remix a reel" platform={platform} sidebar={sidebar} area="make">
      <div className="flex flex-col gap-3 p-4">
        <div className="flex items-center gap-2">
          <IconText icon={Music} tone="beat" className="type-label text-rose-strong">
            23 music beats
          </IconText>
          <span className="type-label text-ink-3">·</span>
          <span className="type-label text-rose-strong">13 slots</span>
        </div>
        <SegmentBar segments={segments} beats={reel.beats} state="filled" tone="surface" labels numbers />
      </div>
      <ul className="border-t border-rule-subtle">
        <SlotRow n={1} part="Hook" beat="Beat 1–2" time="0:06.5" />
        <SlotRow n={2} part="Build" beat="Beat 12–13" time="0:00.6" />
        <SlotRow n={3} part="Build" beat="Beat 13–14" time="0:00.6" />
      </ul>
    </AppWindow>
  );
}

function Fixture() {
  return (
    <main id="main">
      <Section heading="Every primitive, in this world" lead="The reel frame, the segment bar, the app window, stickers, icon rows, brand icons and Kaatu.">
        <Arrive>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 48, alignItems: 'flex-start' }}>
            <div style={{ position: 'relative', flex: '0 1 300px', maxWidth: 300 }}>
              <ReelFrame
                sources={reel.reference}
                poster={reel.poster}
                label={`A saved reel: ${reel.title}`}
                bar={<SegmentBar segments={segments} beats={reel.beats} state="filled" labels tone="video" />}
                bottom={
                  <span className="inline-flex h-11 items-center gap-2 rounded-pill bg-sticker-paper px-5 type-label font-semibold text-sticker-paper-ink shadow-sticker">
                    <Copy aria-hidden className="size-4" />
                    Use template
                  </span>
                }
                stickers={
                  <>
                    <span style={{ position: 'absolute', right: -40, top: '38%' }}>
                      <Sticker field="pink" icon={Music} tilt={-6}>
                        23 music beats
                      </Sticker>
                    </span>
                    <span style={{ position: 'absolute', right: -28, top: '48%' }}>
                      <Sticker field="violet" icon={Images} tilt={4}>
                        13 slots
                      </Sticker>
                    </span>
                    <span style={{ position: 'absolute', right: -48, top: '58%' }}>
                      <Sticker field="marigold" mark={<AiMark className="size-4" />} tilt={-3}>
                        Your version
                      </Sticker>
                    </span>
                  </>
                }
              />
              <span style={{ position: 'absolute', left: -44, bottom: 56 }}>
                <Kaatu pose="peek-left" size={88} sticker />
              </span>
            </div>
            <div style={{ flex: '1 1 320px', minWidth: 0 }}>
              <Window platform="mac" sidebar />
              <div data-fixture="app window, scaled" style={{ display: 'flex', flexWrap: 'wrap', gap: 32, marginTop: 40, alignItems: 'flex-start' }}>
                <div data-fixture-box="320" style={{ width: 320, maxWidth: '100%' }}>
                  <Window platform="ubuntu" sidebar />
                </div>
                <div style={{ width: 300, maxWidth: '100%' }}>
                  <AppWindow title="Library" platform="mac" sidebar={false} size="sm">
                    <div className="flex flex-col gap-2 p-4">
                      <IconText icon={Clapperboard} tone="action" className="type-label text-ink">
                        Make
                      </IconText>
                      <span className="type-meta text-ink-2">No sidebar, design width 560, shown at 300.</span>
                    </div>
                  </AppWindow>
                </div>
              </div>
            </div>
          </div>
        </Arrive>

        <Block name="segment bar: idle, filled, lifted, unsure">
          <div style={{ display: 'grid', gap: 40, maxWidth: 640 }}>
            <SegmentBar segments={segments} beats={reel.beats} state="idle" tone="surface" labels numbers />
            <SegmentBar segments={segments} beats={reel.beats} state="filled" tone="surface" labels numbers />
            <SegmentBar segments={segments} beats={reel.beats} state="lifted" tone="surface" numbers />
            <SegmentBar segments={segments} beats={reel.beats} state="filled" tone="surface" layout="time" />
          </div>
        </Block>

        <Block name="stickers: every field">
          <div style={row}>
            {(['pink', 'violet', 'teal', 'marigold', 'sky', 'lime', 'paper'] as StickerField[]).map((f, i) => (
              <Sticker key={f} field={f} icon={i % 2 ? Shapes : Music} tilt={i % 2 ? 3 : -4}>
                {f}
              </Sticker>
            ))}
            <Sticker field="teal" brand="instagram" size="lg" tilt={-2}>
              Saved from Instagram
            </Sticker>
            <Sticker field="paper" size="sm" tilt={5}>
              sm
            </Sticker>
          </div>
        </Block>

        <Block name="icon text: tones and sizes">
          <ul style={{ display: 'grid', gap: 10 }}>
            <IconText as="li" icon={Music} tone="beat" className="type-body text-ink">
              Rose for music beats
            </IconText>
            <IconText as="li" mark={<AiMark className="size-4" />} tone="ai" className="type-body text-ink">
              Violet for the AI
            </IconText>
            <IconText as="li" icon={Images} tone="you" className="type-body text-ink">
              Teal for your clips
            </IconText>
            <IconText as="li" icon={Clapperboard} tone="action" size="lg" className="type-site-subhead text-ink">
              Marigold acts
            </IconText>
            <IconText as="li" icon={Check} tone="muted" size="sm" className="type-meta text-ink-2">
              Small and muted, for a fact under a title, that wraps onto a second line when the column is narrow
            </IconText>
          </ul>
        </Block>

        <Block name="brand icons (SVGL), named in words">
          <div style={row}>
            {SVGL.map((e) => (
              <IconText key={e.id} brand={e.id} size="lg" className="type-label text-ink">
                {e.name}
              </IconText>
            ))}
          </div>
          <div style={{ ...row, marginTop: 20 }}>
            <BrandIcon id="github" size={40} label="GitHub" />
            <BrandIcon id="apple" size={40} label="Apple" />
            <BrandIcon id="gemini" size={40} label="Gemini" />
          </div>
        </Block>

        <Block name="Kaatu: poses, moods, sticker">
          <div style={{ ...row, gap: 32 }}>
            <Kaatu pose="film" size={96} />
            <Kaatu pose="headphones" size={96} />
            <Kaatu pose="cheer" size={96} sticker />
            <Kaatu pose="nap" size={96} />
            <Kaatu pose="big-wave" size={120} sticker interactive />
            <Kaatu mood="thinking" size={96} />
            <Kaatu mood="delighted" size={64} />
          </div>
        </Block>

        <Block name="one marigold fill">
          <button type="button" className={buttonClasses('primary', 'lg')}>
            Join the waitlist
          </button>
        </Block>
      </Section>
    </main>
  );
}

/** The fixture's body markup. */
export function primitivesBody(): string {
  return renderToStaticMarkup(<Fixture />);
}
