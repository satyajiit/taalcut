// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * TXT1 through the pinned shell: a timeline with text over a moving picture, drawn in the default look (no Style:
 * what every one of the owner's videos had) and in three designed looks saved as the video's Style: heavy white
 * sans with a black outline, a thin serif in a colour, condensed capitals. Each look's letters are measured where
 * Chrome drew them: the outline's black beside the white letters, the serif's colour, the capitals' height the
 * same in every face. With TXT1_STILLS_DIR set the frames are kept there, to look at, and so are nine frames of
 * each designed title as raw pixels with what was drawn (`reader/`), for templates' reader to measure
 * (templates' test/overlay-look/type-look-real-faces.int.test.ts): the drawn look against the measured one.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  err,
  FrameRate,
  newId,
  NotFoundError,
  ok,
  styleSchema,
  timelineSchema,
  type CaptureFrameInput,
  type Style,
  type TextItem,
  type TextLook,
  type Timeline,
} from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { captureFrame } from '../../src/engine/capture-frame';
import { createStyleSource } from '../../src/style/resolve-style';
import { fakeWorld, type FakeWorld } from '../router/fixtures';
import { movingClip } from '../support/engine';
import { findTestMedia, frameRegion, mediaContext, patchColour, tempDir } from '../support/media';
import { findTestShell } from '../support/shell';
import { makeTimeline } from '../support/timeline';

const media = await findTestMedia('text design');
const shell = findTestShell('text design');
const rate = FrameRate.of(30);
const KEEP = process.env.TXT1_STILLS_DIR;

interface Design {
  readonly name: string;
  readonly look: TextLook | null;
  readonly upper?: boolean;
}

const look = (value: Partial<TextLook> & Pick<TextLook, 'font' | 'colour'>): TextLook => ({
  background: null,
  stroke: null,
  shadow: null,
  ...value,
});

const DESIGNS: readonly Design[] = [
  { name: 'default', look: null },
  {
    name: 'heavy-white-outline',
    look: look({
      font: { family: 'montserrat', weight: 800 },
      colour: '#ffffff',
      stroke: { colour: '#000000', widthPx: 5 },
    }),
  },
  {
    name: 'thin-serif-colour',
    look: look({
      font: { family: 'cormorantGaramond', weight: 400 },
      colour: '#f4d35e',
      shadow: { colour: '#000000', opacity: 0.9, blurPx: 6, offsetPx: 3 },
    }),
  },
  {
    name: 'condensed-caps',
    look: look({
      font: { family: 'bebasNeue', weight: 400 },
      colour: '#ffffff',
      shadow: { colour: '#000000', opacity: 0.75, blurPx: 10, offsetPx: 4 },
      letterSpacing: 0.04,
    }),
    upper: true,
  },
];

/**
 * Kept for templates' reader only (with TXT1_STILLS_DIR): capitals of known faces, plain white and set apart, so a
 * letter's width for its height can be measured face by face.
 */
const CALIBRATION: readonly Design[] = (
  [
    ['bebasNeue', 400],
    ['oswald', 500],
    ['anton', 400],
    ['notoSans', 700],
    ['poppins', 600],
    ['playfairDisplay', 700],
  ] as const
).map(([family, weight]) => ({
  name: `caps-${family}`,
  look: look({ font: { family, weight }, colour: '#ffffff', letterSpacing: 0.1 }),
  upper: true,
}));

function styleOf(design: Design): Style {
  const text = design.look!;
  return styleSchema.parse({
    schemaVersion: 1,
    id: newId<'Style'>(),
    revision: 1,
    name: design.name,
    kind: 'look',
    colours: {
      primary: text.colour,
      secondary: '#000000',
      accent: text.colour,
      text: text.colour,
      background: '#000000',
    },
    fonts: { heading: text.font, body: text.font },
    captions: null,
    textStyles: { title: text, label: text },
    logo: null,
    watermark: null,
    intro: null,
    outro: null,
    grade: null,
    fontMatch: null,
    madeFrom: null,
    createdAt: 0,
    updatedAt: 0,
  });
}

describe.skipIf(!media.binaries || !shell.path)(
  'TXT1: designed text in the frame',
  { timeout: 360_000 },
  () => {
    let ctx: MediaContext;
    let work: Awaited<ReturnType<typeof tempDir>>;
    let world: FakeWorld;
    let base: Timeline;
    const shots = new Map<
      string,
      { file: string; boxes: readonly { x: number; y: number; width: number; height: number }[] }
    >();

    /** The timeline in a design: its Style named, its texts in the role's case. */
    function designed(design: Design, style: Style | null): Timeline {
      return timelineSchema.parse({
        ...base,
        id: newId<'Timeline'>(),
        styleId: style?.id ?? null,
        tracks: base.tracks.map((track) =>
          track.kind !== 'text'
            ? track
            : {
                ...track,
                items: track.items.map((item) =>
                  item.type === 'text' && design.upper
                    ? { ...item, appearance: { ...item.appearance, case: 'upper' } }
                    : item,
                ),
              },
        ),
      });
    }

    beforeAll(async () => {
      ctx = mediaContext(media.binaries!);
      work = await tempDir('text-design');
      world = await fakeWorld(join(work.dir, 'world'), { ctx, shell: shell.path! });
      const clip = newId<'Asset'>();
      const file = join(work.dir, 'moving.mp4');
      await movingClip(ctx, file, { frames: 90, rate: '30', size: '1080x1920', silent: true });
      world.originals.set(clip, file);
      const made = makeTimeline({
        rate,
        items: [{ frames: 60, assetId: clip, sourceStart: 0, mediaFrames: 90 }],
        texts: [
          { start: 0, frames: 30, text: 'After 9 to 5', reveal: 'none' },
          { start: 30, frames: 30, text: 'I come alive', reveal: 'none' },
        ],
      });
      // Two lines inside the text safe area: a title a third down, a lyric word line below the middle.
      const place = (item: TextItem, index: number): TextItem => ({
        ...item,
        styleKey: index === 0 ? 'title' : 'label',
        box:
          index === 0
            ? { x: 0.1, y: 0.3, width: 0.8, height: 0.06 }
            : { x: 0.1, y: 0.56, width: 0.8, height: 0.05 },
        appearance: { ...item.appearance, size: index === 0 ? 0.04 : 0.03 },
      });
      // One text track holds no overlaps: the title shows over the first second, the lyric line over the next.
      base = timelineSchema.parse({
        ...made,
        tracks: made.tracks.map((track) =>
          track.kind !== 'text'
            ? track
            : {
                ...track,
                items: track.items.map((item, index) => (item.type === 'text' ? place(item, index) : item)),
              },
        ),
      });
      if (KEEP) await mkdir(KEEP, { recursive: true });
      for (const design of KEEP ? [...DESIGNS, ...CALIBRATION] : DESIGNS) {
        const style = design.look ? styleOf(design) : null;
        const timeline = designed(design, style);
        world.timelines.set(timeline.id, timeline);
        const styles = createStyleSource({
          styles: {
            get: async (styleId) =>
              style && styleId === style.id
                ? ok(style)
                : err(NotFoundError({ entity: 'style', id: styleId })),
            assetPath: async (sha256) => err(NotFoundError({ entity: 'styleAsset', id: sha256 })),
          },
        });
        for (const [index, frame] of [10, 40].entries()) {
          const input: CaptureFrameInput = {
            projectId: timeline.projectId,
            timelineId: timeline.id,
            frame,
            source: { kind: 'preview' },
            maxDimension: 1920,
          };
          const shot = await captureFrame({ ...world.deps, styles }, input);
          if (!shot.ok) throw new Error(`${design.name}: ${shot.error.code} ${shot.error.detail ?? ''}`);
          const name = `${design.name}-${index === 0 ? 'title' : 'lyric'}`;
          const out = join(KEEP ?? work.dir, `${name}.jpg`);
          await writeFile(out, Buffer.from(shot.value.dataBase64, 'base64'));
          shots.set(name, {
            file: out,
            boxes: shot.value.textBoxes.filter((box) => box.kind === 'text').map((box) => box.box),
          });
        }
        if (!KEEP || !design.look) continue;
        // For templates' reader: the title's region over nine frames of the moving picture, as rgb24, and what
        // was drawn. The region is the title's glyph box with room round it for an outline and a shadow.
        const glyphs = shots.get(`${design.name}-title`)!.boxes[0]!;
        const pad = 48;
        const region = {
          x: Math.max(0, Math.floor(glyphs.x) - pad),
          y: Math.max(0, Math.floor(glyphs.y) - pad),
          width: Math.min(1080, Math.ceil(glyphs.width) + 2 * pad),
          height: Math.ceil(glyphs.height) + 2 * pad,
        };
        const reader = join(KEEP, 'reader');
        await mkdir(reader, { recursive: true });
        const frames: string[] = [];
        for (const frame of [2, 5, 8, 11, 14, 17, 20, 23, 26]) {
          const shot = await captureFrame(
            { ...world.deps, styles },
            {
              projectId: timeline.projectId,
              timelineId: timeline.id,
              frame,
              source: { kind: 'preview' },
              maxDimension: 1920,
            },
          );
          if (!shot.ok) throw new Error(`${design.name} frame ${frame}: ${shot.error.code}`);
          const jpeg = join(work.dir, `${design.name}-${frame}.jpg`);
          await writeFile(jpeg, Buffer.from(shot.value.dataBase64, 'base64'));
          const file = `${design.name}-${frame}.rgb`;
          await writeFile(join(reader, file), await frameRegion(ctx, jpeg, 0, region));
          frames.push(file);
        }
        await writeFile(
          join(reader, `${design.name}.json`),
          JSON.stringify({
            name: design.name,
            text: design.upper ? 'AFTER 9 TO 5' : 'After 9 to 5',
            look: design.look,
            capPx: 0.04 * 1920,
            region: { width: region.width, height: region.height },
            words: {
              left: Math.floor(glyphs.x) - region.x,
              top: Math.floor(glyphs.y) - region.y,
              right: Math.ceil(glyphs.x + glyphs.width) - region.x,
              bottom: Math.ceil(glyphs.y + glyphs.height) - region.y,
            },
            frames,
          }),
        );
      }
    });
    afterAll(async () => work?.dispose());

    const boxOf = (name: string) => shots.get(name)!.boxes[0]!;

    it('draws every design, each text where its box puts it', () => {
      for (const design of DESIGNS)
        for (const part of ['title', 'lyric']) {
          const box = boxOf(`${design.name}-${part}`);
          expect(box.width).toBeGreaterThan(100);
          expect(box.x).toBeGreaterThanOrEqual(1080 * 0.1 - 12);
          expect(box.x + box.width).toBeLessThanOrEqual(1080 * 0.9 + 12);
        }
    });

    it('the faces differ where a look says so: condensed capitals are narrower, the heavy sans wider', () => {
      const width = (name: string) => boxOf(`${name}-title`).width;
      expect(width('heavy-white-outline')).toBeGreaterThan(width('default'));
      expect(width('thin-serif-colour')).toBeLessThan(width('heavy-white-outline'));
      // Capitals of the same height: the condensed face sets twelve characters in far less width.
      expect(width('condensed-caps')).toBeLessThan(width('heavy-white-outline') * 0.75);
    });

    it('the serif look is its colour, and the outline look has black round white letters', async () => {
      // The fullest part of a letter's ink: sample the title's box for the look's colour.
      const inked = async (name: string, wanted: readonly [number, number, number]) => {
        const { file } = shots.get(`${name}-title`)!;
        const box = boxOf(`${name}-title`);
        let best = Infinity;
        for (let x = box.x + 4; x < box.x + box.width - 4; x += 6)
          for (let y = box.y + 4; y < box.y + box.height - 4; y += 6) {
            const [r, g, b] = await patchColour(ctx, file, 0, {
              x: Math.round(x),
              y: Math.round(y),
              size: 2,
            });
            best = Math.min(
              best,
              Math.abs(r - wanted[0]) + Math.abs(g - wanted[1]) + Math.abs(b - wanted[2]),
            );
            if (best < 45) return best;
          }
        return best;
      };
      expect(await inked('thin-serif-colour', [244, 211, 94])).toBeLessThan(45);
      expect(await inked('heavy-white-outline', [255, 255, 255])).toBeLessThan(45);
      expect(await inked('heavy-white-outline', [0, 0, 0])).toBeLessThan(45);
    });
  },
);
