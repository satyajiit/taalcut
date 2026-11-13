// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * compileComposition (SPEC section 3): deterministic bytes and hash,
 * frame-exact half-open windows at every rate, escaping of user text, the
 * measured caption layout (and the pop's lead) drawn as laid out, the pop's
 * scale and push tweens, and HyperFrames' own linter finding no errors.
 */
import { lintHyperframeHtml } from '@hyperframes/core/lint';
import { FrameRate, RationalTime, type Timeline } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { POP_SCALE } from '../../src/captions/pop';
import { captionAnimations } from '../../src/compile/caption-motion';
import type { MotionTween } from '../../src/motion/motion-data';
import { compileComposition, type CompileOptions } from '../../src/compile/composition';
import { jsonForScript } from '../../src/compile/html';
import { presetFor } from '../../src/presets/presets.v1';
import { captionTrackOf, makeTimeline } from '../support/timeline';

const media: CompileOptions['media'] = (visual) => ({
  file: `/media/${visual.assetId}.mp4`,
  key: `key-${visual.assetId}`,
  mediaStart: RationalTime.zero(FrameRate.of(30)),
  ext: 'mp4',
});

const compile = (timeline: Timeline, extra: Partial<CompileOptions> = {}) => {
  const result = compileComposition(timeline, {
    variant: 'export',
    preset: presetFor('device'),
    burnCaptions: true,
    media,
    ...extra,
  });
  if (!result.ok) throw new Error(result.error.code);
  return result.value;
};

/** Every `data-start`/`data-duration` pair of the video elements, in document order. */
const videoWindows = (html: string) =>
  [...html.matchAll(/<video [^>]*data-start="([^"]+)" data-duration="([^"]+)"/g)].map((m) => [m[1], m[2]]);

/** The moving tweens (not the rest-value sets) of one property of one element. */
const tweensOf = (tweens: readonly MotionTween[], target: string, property: string) =>
  tweens.filter(
    (tween) =>
      'ids' in tween.targets &&
      tween.targets.ids.includes(target) &&
      tween.duration > 0 &&
      property in tween.to,
  );

describe('compileComposition', () => {
  it('compiles the same timeline to the same bytes and hash', () => {
    const timeline = makeTimeline({
      items: [{ frames: 30 }, { frames: 45 }],
      texts: [{ start: 0, frames: 30, text: 'Hi' }],
    });
    const a = compile(timeline);
    const b = compile(timeline);
    expect(a.files).toEqual(b.files);
    expect(a.links).toEqual(b.links);
    expect(a.compositionHash).toBe(b.compositionHash);
    expect(a.compositionHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('changes the hash when a media key changes, and only then', () => {
    const timeline = makeTimeline({ items: [{ frames: 30 }] });
    const base = compile(timeline).compositionHash;
    const changed = compile(timeline, {
      media: (visual) => ({ ...media(visual)!, key: 'other' }),
    }).compositionHash;
    expect(changed).not.toBe(base);
    expect(
      compile(timeline, { media: (visual) => ({ ...media(visual)!, file: '/elsewhere.mp4' }) })
        .compositionHash,
    ).toBe(base);
  });

  it('writes half-open windows whose ends meet the next start exactly', () => {
    const timeline = makeTimeline({
      rate: FrameRate.of(30000, 1001),
      items: [{ frames: 7 }, { frames: 11 }, { frames: 13 }],
    });
    const windows = videoWindows(compile(timeline).files['index.html']!);
    expect(windows).toEqual([
      ['0', '0.233566666'],
      ['0.233566666', '0.367033334'],
      ['0.6006', '0.433766666'],
    ]);
    // start + duration of each clip is exactly the next clip's start (nanosecond arithmetic, no drift).
    const nanos = (s: string) => {
      const [whole = '0', fraction = ''] = s.split('.');
      return BigInt(whole) * 1_000_000_000n + BigInt(fraction.padEnd(9, '0'));
    };
    for (let i = 0; i + 1 < windows.length; i++) {
      expect(nanos(windows[i]![0]!) + nanos(windows[i]![1]!)).toBe(nanos(windows[i + 1]![0]!));
    }
  });

  it('marks the root with the fps and duration HyperFrames reads, and waits for tc.js’s GSAP timeline', () => {
    const timeline = makeTimeline({ rate: FrameRate.of(60000, 1001), items: [{ frames: 120 }] });
    const bundle = compile(timeline);
    const html = bundle.files['index.html']!;
    expect(html).toContain('data-fps="59.94"');
    expect(html).toContain('data-duration="2.002"');
    expect(html).not.toContain('data-no-timeline');
    expect(html).toContain('data-composition-id="taalcut"');
    // GSAP loads from the bundle before tc.js, which registers the timeline under the composition id.
    expect(html.indexOf('<script src="vendor/gsap/gsap.min.js">')).toBeLessThan(
      html.indexOf('<script src="tc.js">'),
    );
    expect(bundle.links['vendor/gsap/gsap.min.js']?.key).toMatch(/^[0-9a-f]{64}$/);
    expect(bundle.files['tc.js']).toContain("window.__timelines['taalcut'] = tl");
  });

  it('escapes user text and keeps the data script closed', () => {
    const nasty = '</script><img src=x onerror=alert(1)> & "q"';
    const timeline = makeTimeline({
      items: [{ frames: 30 }],
      texts: [{ start: 0, frames: 30, text: nasty }],
    });
    const html = compile(timeline).files['index.html']!;
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;/script&gt;&lt;img src=x onerror=alert(1)&gt; &amp; &quot;q&quot;');
    expect(jsonForScript({ t: '</script>' })).not.toContain('</script>');
    // Every closer is one the compiler wrote: the data script and each script it loads (GSAP's files, then tc.js).
    const opened = html.match(/<script[\s>]/g) ?? [];
    expect(html.match(/<\/script>/g)).toHaveLength(opened.length);
    expect(opened.length).toBe(1 + [...html.matchAll(/<script src="/g)].length);
  });

  it('refuses an unsupported rate and a visual without media', () => {
    const odd = compileComposition(makeTimeline({ rate: FrameRate.of(25), items: [{ frames: 25 }] }), {
      variant: 'export',
      preset: presetFor('device'),
      burnCaptions: false,
      media,
    });
    expect(odd.ok ? null : odd.error.code).toBe('render.unsupported_frame_rate');
    const missing = compileComposition(makeTimeline({ items: [{ frames: 30 }] }), {
      variant: 'export',
      preset: presetFor('device'),
      burnCaptions: false,
      media: () => undefined,
    });
    expect(missing.ok ? null : missing.error.code).toBe('render.media_missing');
  });

  it('draws a measured caption layout line for line at its line height', () => {
    const rate = FrameRate.of(30);
    const captions = captionTrackOf(rate, [[0, 30, 'one two three four']]);
    const timeline = makeTimeline({ items: [{ frames: 30 }], captions });
    const bundle = compile(timeline, {
      captionLayout: () => ({
        lines: ['one two', 'three four'],
        lineWords: [2, 2],
        widthPx: 400,
        heightPx: 200,
        topPx: 900,
        lineHeightPx: 96,
      }),
    });
    const html = bundle.files['index.html']!;
    expect(html.match(/<br>/g)).toHaveLength(1);
    expect(html.indexOf('<br>')).toBeGreaterThan(html.indexOf('>two<'));
    expect(html.indexOf('<br>')).toBeLessThan(html.indexOf('>three<'));
    // The text starts below the stroke the layout keeps room for (4 px), so the drawn block is the laid-out one.
    expect(bundle.files['tc.css']).toContain(
      `#q-${captions.cues[0]!.id} { top: 904px; line-height: 96px; white-space: nowrap; }`,
    );
    const padded = compile(
      makeTimeline({
        items: [{ frames: 30 }],
        captions: {
          ...captions,
          style: {
            ...captions.style,
            background: { color: '#000000', opacity: 0.6, paddingPx: 18, radiusPx: 14 },
          },
        },
      }),
      {
        captionLayout: () => ({
          lines: ['one two three four'],
          lineWords: [4],
          widthPx: 400,
          heightPx: 200,
          topPx: 900,
          lineHeightPx: 96,
        }),
      },
    );
    expect(padded.files['tc.css']).toContain(`#q-${captions.cues[0]!.id} { top: 922px;`);
    expect(compile(timeline, { burnCaptions: false }).files['index.html']).not.toContain('tc-cue');
  });

  it('breaks lines after the laid-out count of the cue’s words, whatever spaces the words hold', () => {
    const rate = FrameRate.of(30);
    const track = captionTrackOf(rate, [[0, 30, 'Meet the team that']]);
    // An edit's joined tail: one cue word with spaces inside it.
    const captions = {
      ...track,
      cues: track.cues.map((cue) => ({
        ...cue,
        words: cue.words.map((word, index) =>
          index === 3 ? { ...word, text: 'that ships every Friday' } : word,
        ),
      })),
    };
    const html = compile(makeTimeline({ items: [{ frames: 30 }], captions }), {
      captionLayout: () => ({
        lines: ['Meet the team', 'that ships every Friday'],
        lineWords: [3, 1],
        widthPx: 400,
        heightPx: 200,
        topPx: 900,
        lineHeightPx: 96,
      }),
    }).files['index.html']!;
    expect(html.match(/<br>/g)).toHaveLength(1);
    expect(html).toContain('<br><span id="w-0-3"');
  });

  it('draws the pop’s lead on word boxes one line tall, and nothing for other highlights', () => {
    const rate = FrameRate.of(30);
    const pop = captionTrackOf(rate, [[0, 30, 'one two three']], { highlight: 'pop' });
    const layout = {
      lines: ['one two', 'three'],
      lineWords: [2, 1],
      widthPx: 400,
      heightPx: 260,
      topPx: 900,
      lineHeightPx: 100,
    };
    const css = (track: typeof pop, withPop: boolean) =>
      compile(makeTimeline({ items: [{ frames: 30 }], captions: track }), {
        captionLayout: () => ({
          ...layout,
          ...(withPop ? { pop: { push: [9, 7.5, 6.25], leadPx: 10.8 } } : {}),
        }),
      }).files['tc.css']!;
    const drawn = css(pop, true);
    expect(drawn).toContain(`#q-${pop.cues[0]!.id} .tc-word { height: 100px; margin-top: 10.8px; }`);
    expect(drawn).toContain('.tc-cap .tc-word { display: inline-block; transform-origin: 50% 60%; }');
    // At rest the words are set as plain text: no room of their own on either side.
    expect(drawn).not.toContain('#w-0-0 {');
    expect(drawn).not.toMatch(/tc-word[^}]*margin(:|-left|-right)/);
    const plain = css(captionTrackOf(rate, [[0, 30, 'one two three']]), false);
    expect(plain).not.toContain('.tc-word { height');
  });

  it('pops each word to POP_SCALE and back, one word at a time', () => {
    const rate = FrameRate.of(30);
    const track = captionTrackOf(rate, [[0, 30, 'one two three']], { highlight: 'pop' });
    const overlapping = {
      ...track,
      cues: track.cues.map((cue) => ({
        ...cue,
        // The first word runs 5 frames into the second.
        words: cue.words.map((word, index) =>
          index === 0 ? { ...word, range: { ...word.range, duration: RationalTime.of(15, rate) } } : word,
        ),
      })),
    };
    const scaleTweens = (target: string) =>
      tweensOf(captionAnimations(overlapping, rate, []), target, 'scale');
    const first = scaleTweens('w-0-0');
    expect(first.map((tween) => tween.to.scale)).toEqual([POP_SCALE, 1]);
    // Back at rest by frame 10, when the second word starts.
    const last = first[first.length - 1]!;
    expect((last.at + last.duration) * 30).toBeCloseTo(10, 6);
    expect(scaleTweens('w-0-1')[0]!.at * 30).toBeCloseTo(10, 6);
  });

  it('moves the other words of the popped word’s line apart by its push, in time with its scale', () => {
    const rate = FrameRate.of(30);
    const track = captionTrackOf(rate, [[0, 30, 'one two three']], { highlight: 'pop' });
    const layout = {
      lines: ['one two', 'three'],
      lineWords: [2, 1],
      widthPx: 400,
      heightPx: 260,
      topPx: 900,
      lineHeightPx: 100,
      pop: { push: [9, 7.5, 6.25], leadPx: 10.8 },
    };
    const tweens = captionAnimations(track, rate, [layout]);
    const moves = (target: string) =>
      tweensOf(tweens, target, 'x').map((tween) => [tween.from.x, tween.to.x]);
    // 'one' pops: 'two' moves right by its push and back; then 'two' pops: 'one' moves left by its push.
    expect(moves('w-0-1')).toEqual([
      [0, 9],
      [9, 0],
    ]);
    expect(moves('w-0-0')).toEqual([
      [0, -7.5],
      [-7.5, 0],
    ]);
    // 'three' is alone on its line: nothing moves for it, and it moves for no one.
    expect(moves('w-0-2')).toEqual([]);
    const timing = (target: string, property: 'x' | 'scale') =>
      tweensOf(tweens, target, property).map((tween) => [tween.at, tween.duration, tween.ease]);
    expect(timing('w-0-1', 'x')).toEqual(timing('w-0-0', 'scale'));
    expect(timing('w-0-0', 'x')).toEqual(timing('w-0-1', 'scale'));
    // Without the layout's room there is nothing to push by: the words only scale.
    expect(tweensOf(captionAnimations(track, rate, [{ ...layout, pop: undefined }]), 'w-0-1', 'x')).toEqual(
      [],
    );
  });

  it('passes HyperFrames lint without errors', async () => {
    const timeline = makeTimeline({
      items: [
        { frames: 30 },
        { frames: 30, transition: { kind: 'dissolve', inFrames: 5, outFrames: 5 } },
        { frames: 30 },
      ],
      texts: [{ start: 10, frames: 40, text: 'Title' }],
      captions: captionTrackOf(FrameRate.of(30), [[0, 45, 'hello there friend']]),
    });
    const bundle = compile(timeline);
    // Linted as the page runs it: tc.js (which registers the timeline) in place of its tag. The preview's CSP
    // allows no inline script, so the bundle loads it as a file.
    const html = bundle.files['index.html']!.replace(
      '<script src="tc.js"></script>',
      () => `<script>${bundle.files['tc.js']!}</script>`,
    );
    const lint = await lintHyperframeHtml(html, {
      filePath: 'index.html',
      externalStyles: [{ href: 'tc.css', content: bundle.files['tc.css']! }],
    });
    expect(lint.findings.filter((finding) => finding.severity === 'error')).toEqual([]);
  });
});
