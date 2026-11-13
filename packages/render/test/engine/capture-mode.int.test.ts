// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Every frame of a long export is captured once, in order, from its own paint, however late the paint comes
 * (producer.ts; SPEC section 3, "Determinism"). HyperFrames picks its drawElement capture by itself for a render this
 * long on a Mac with a hardware GPU (from 700 frames with 24 GB, from 900 on any Mac). Upstream, that path drew the
 * canvas's last snapshot when a frame's paint was more than 250 ms late; the engine patch makes it wait for the
 * paint. A 32 s source whose every frame has its own colour is rendered with the export's own settings; then the same
 * bundle again with a page whose paint waits about 600 ms for a busy GPU on every 16th frame, as on a loaded Mac; and
 * again with the paint event of every 16th drawElement capture delivered 400 ms late, past the old fallback. Each
 * rendered frame k must show source frame k, in a capture mode the producer accepts.
 */
import { readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { FrameRate, newId } from '@taalcut/core';
import type { MediaContext } from '@taalcut/media';
import { runProducer, unexpectedCaptureMode } from '../../src/engine/producer';
import { renderVideo, type RenderedVideo } from '../../src/engine/render-video';
import { presetFor, videoBitrateKbps } from '../../src/presets/presets.v1';
import { ffmpeg, findTestMedia, mediaContext, patchColours, tempDir } from '../support/media';
import { findTestShell } from '../support/shell';
import { makeTimeline } from '../support/timeline';
import { FIXTURE_H264 } from '../support/host-video';
import { captureWithCli } from '../support/cli-capture';

const media = await findTestMedia('capture mode');
const shell = findTestShell('capture mode');
const toolchain = process.env.TAALCUT_SHELL_TOOLCHAIN_DIR;

const RATE = FrameRate.of(30);
/** Past both of HyperFrames' drawElement thresholds (700 and 900 frames). */
const FRAMES = 960;
const SLOW_MS = 600;
const SLOW_EVERY = 16;

/** The colour lavfi's geq gives source frame n (as in the frame oracle; small primes so neighbours differ a lot). */
const colourOf = (n: number): [number, number, number] => [
  (n * 37 + 20) % 256,
  (n * 91 + 40) % 256,
  (n * 53 + 60) % 256,
];
const distance = (a: readonly number[], b: readonly number[]) =>
  a.reduce((sum, value, index) => sum + (value - (b[index] ?? 0)) ** 2, 0);

/** Frames that show a neighbour's colour rather than their own: a repeated (or skipped) frame. */
function misplaced(colours: readonly (readonly number[])[]): number[] {
  return colours.flatMap((colour, k) => {
    const own = distance(colour, colourOf(k));
    const before = k > 0 ? distance(colour, colourOf(k - 1)) : Infinity;
    const after = distance(colour, colourOf(k + 1));
    return own <= before && own <= after ? [] : [k];
  });
}

/**
 * A page whose paint is late on every `every`-th frame: once that frame's video frame has decoded, a worker keeps the
 * GPU busy for about `ms` with one WebGL draw, so the frame's paint waits for the GPU while the page's main thread
 * stays free, the case drawElement capture gives up on after 250 ms. The draw is sized against the worker's own clock
 * (HyperFrames freezes the page's clocks, not a worker's) and resized after every draw, as the capture pages size it
 * together on one GPU at load. Each draw's time is logged for the test to check the paint really was late. (No
 * requestAnimationFrame in the page: that would make HyperFrames pick screenshot capture for compatibility, whatever
 * the config says.)
 */
const slowPaint = (ms: number, every: number, fps: number) => `<script>
(function () {
  var worker = new Worker(URL.createObjectURL(new Blob([[
    'var gl = new OffscreenCanvas(2048, 2048).getContext("webgl2");',
    'function shader(type, text) { var s = gl.createShader(type); gl.shaderSource(s, text); gl.compileShader(s); return s; }',
    'var program = gl.createProgram();',
    'gl.attachShader(program, shader(gl.VERTEX_SHADER, "#version 300 es\\\\nvoid main() { vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2); gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0); }"));',
    'gl.attachShader(program, shader(gl.FRAGMENT_SHADER, "#version 300 es\\\\nprecision highp float; uniform int n; out vec4 o; void main() { vec2 p = gl_FragCoord.xy / 2048.0; float c = p.x; for (int i = 0; i < n; i++) c = fract(sin(c * 12.9898 + p.y) * 43758.5453); o = vec4(c, c, c, 1.0); }"));',
    'gl.linkProgram(program); gl.useProgram(program);',
    'var count = gl.getUniformLocation(program, "n"), pixel = new Uint8Array(4);',
    'function draw(n) { gl.uniform1i(count, n); var t = performance.now(); gl.drawArrays(gl.TRIANGLES, 0, 3); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel); return performance.now() - t; }',
    'var n = 256; for (var k = 0; k < 14 && draw(n) < 40; k++) n *= 2;',
    'n = Math.max(1, Math.round(n * ${ms} / Math.max(1, draw(n))));',
    'onmessage = function () { var took = draw(n); n = Math.max(1, Math.round(n * Math.min(4, Math.max(0.25, ${ms} / Math.max(1, took))))); postMessage(took); };',
  ].join('\\n')], { type: 'text/javascript' })));
  worker.onmessage = function (e) { console.log('[slow-paint] gpu ' + Math.round(e.data)); };
  var last = -1;
  function frame() {
    var tl = window.__timelines && window.__timelines.taalcut;
    return tl && typeof tl.time === 'function' ? Math.round(tl.time() * ${fps}) : -1;
  }
  var decode = HTMLImageElement.prototype.decode;
  HTMLImageElement.prototype.decode = function () {
    var decoded = decode.apply(this, arguments);
    var at = frame();
    if (at >= 0 && at % ${every} === 0 && at !== last) {
      last = at;
      decoded.then(function () { worker.postMessage(at); }, function () {});
    }
    return decoded;
  };
})();
</script>`;

/** Every `every`-th drawElement capture (frame % every === every / 2) is handed its paint this late. */
const LATE_MS = 400;

/**
 * A page that hands the engine's drawElement capture its paint event `ms` late on every `every`-th frame: the
 * engine's paint listener is wrapped and called that long after the event. Each capture adds its paint listener and,
 * in the same task, schedules its own timeout; the timeout is bound to that capture and logs when it fires before the
 * capture's paint was handed over (upstream's 250 ms fallback did, and drew). Screenshot capture adds no listener.
 */
const latePaint = (ms: number, every: number, fps: number) => `<script>
(function () {
  function frame() {
    var tl = window.__timelines && window.__timelines.taalcut;
    return tl && typeof tl.time === 'function' ? Math.round(tl.time() * ${fps}) : -1;
  }
  var add = EventTarget.prototype.addEventListener;
  var remove = EventTarget.prototype.removeEventListener;
  var timeout = window.setTimeout;
  var captures = 0, current = -1, handed = {};
  EventTarget.prototype.addEventListener = function (type, fn) {
    if (type !== 'paint' || !(this instanceof HTMLCanvasElement) || typeof fn !== 'function') {
      return add.apply(this, arguments);
    }
    var id = captures++, at = frame(), canvas = this;
    current = id;
    handed[id] = false;
    var late = at % ${every} === ${every / 2};
    var listener = function (event) {
      remove.call(canvas, 'paint', listener);
      var hand = function () { handed[id] = true; fn.call(canvas, event); };
      if (late) { console.log('[late-paint] late ' + at); timeout(hand, ${ms}); } else hand();
    };
    return add.call(this, 'paint', listener);
  };
  window.setTimeout = function (fn) {
    if (current < 0 || typeof fn !== 'function') return timeout.apply(window, arguments);
    var id = current, at = frame();
    current = -1;
    var rest = Array.prototype.slice.call(arguments, 1);
    return timeout.apply(window, [function () {
      if (!handed[id]) console.log('[late-paint] ended-before-paint ' + at);
      return fn.apply(this, arguments);
    }].concat(rest));
  };
})();
</script>`;

describe.skipIf(!media.binaries || !shell.path)('capture mode', { timeout: 600_000 }, () => {
  let ctx: MediaContext;
  let work: Awaited<ReturnType<typeof tempDir>>;
  let rendered: RenderedVideo;

  beforeAll(async () => {
    ctx = mediaContext(media.binaries!);
    work = await tempDir('capture-mode');
    const source = join(work.dir, 'source.mp4');
    await ffmpeg(ctx, [
      ...['-f', 'lavfi', '-i', `nullsrc=s=108x192:r=30:d=${FRAMES / 30 + 1}`],
      ...['-vf', "geq=r='mod(N*37+20,256)':g='mod(N*91+40,256)':b='mod(N*53+60,256)',format=yuv444p"],
      ...['-c:v', FIXTURE_H264, '-b:v', '20M', '-pix_fmt', 'yuv420p', source],
    ]);
    const info = await stat(source);
    const assetId = newId<'Asset'>();
    const result = await renderVideo({
      timeline: makeTimeline({
        rate: RATE,
        items: [{ frames: FRAMES, sourceStart: 0, assetId, mediaFrames: FRAMES + 30, mediaRate: RATE }],
      }),
      preset: presetFor('device'),
      burnCaptions: false,
      source: () => ({ path: source, size: info.size, mtimeMs: info.mtimeMs }),
      ctx,
      conformDir: join(work.dir, 'conform'),
      workDir: join(work.dir, 'work'),
      chromePath: shell.path!,
      browserGpu: 'hardware',
      gpuEncode: true,
      workers: 'auto',
    });
    if (!result.ok) throw new Error(`${result.error.code}: ${result.error.detail ?? ''}`);
    rendered = result.value;
  });
  afterAll(() => work?.dispose());

  async function instrumentPage(script: string) {
    const index = join(rendered.bundleDir, 'index.html');
    original ??= await readFile(index, 'utf8');
    expect(original).toContain('<head>');
    await writeFile(index, original.replace('<head>', `<head>${script}`));
  }

  /** Render the instrumented page, retaining its tagged events and capture-routing diagnostics separately. */
  async function rerender(script: string, tag: string) {
    await instrumentPage(script);
    const out = join(work.dir, `${tag}.mp4`);
    const preset = presetFor('device');
    // The page's console reaches the host's: HyperFrames logs it, on console.log up to 0.8.149 and on console.error
    // since (both are watched, so the test doesn't depend on which).
    const lines: string[] = [];
    const diagnostics: string[] = [];
    const keep = (...args: unknown[]) => {
      const text = args.map(String).join(' ');
      if (text.includes(`[${tag}]`)) lines.push(text);
      else diagnostics.push(text);
    };
    const log = vi.spyOn(console, 'log').mockImplementation(keep);
    const error = vi.spyOn(console, 'error').mockImplementation(keep);
    const run = await runProducer({
      dir: rendered.bundleDir,
      out,
      rate: RATE,
      bitrateKbps: videoBitrateKbps(preset, RATE),
      chromePath: shell.path!,
      browserGpu: 'hardware',
      gpuEncode: true,
      workers: 'auto',
      binaries: ctx.binaries,
      log: (line) => diagnostics.push(line),
    }).finally(() => {
      log.mockRestore();
      error.mockRestore();
    });
    if (!run.ok) throw new Error(`${run.error.code}: ${run.error.detail ?? ''}`);
    return { run: run.value, out, lines, diagnostics };
  }
  let original: string | undefined;

  it('captures a long export every frame once and in order', async () => {
    expect(rendered.producer.captureMode).not.toBeNull();
    expect(unexpectedCaptureMode(rendered.producer.captureMode)).toBeNull();
    const colours = await patchColours(ctx, rendered.video, { x: 500, y: 900, size: 16 });
    expect(colours).toHaveLength(FRAMES);
    expect(misplaced(colours)).toEqual([]);
  });

  it('repeats no frame when the page paints late', async () => {
    const { run, out, lines } = await rerender(slowPaint(SLOW_MS, SLOW_EVERY, 30), 'slow-paint');
    // The paint really was late: every 16th frame's paint waited for the GPU, well past drawElement's old 250 ms.
    const gpuMs = lines.flatMap((line) => /gpu (\d+)/.exec(line)?.[1] ?? []).map(Number);
    expect(gpuMs.length).toBeGreaterThanOrEqual(FRAMES / SLOW_EVERY);
    const median = [...gpuMs].sort((a, b) => a - b)[Math.floor(gpuMs.length / 2)]!;
    expect(median, `GPU draws (ms): ${gpuMs.join(' ')}`).toBeGreaterThan(250);
    expect(unexpectedCaptureMode(run.captureMode)).toBeNull();
    const colours = await patchColours(ctx, out, { x: 500, y: 900, size: 16 });
    expect(colours).toHaveLength(FRAMES);
    expect(misplaced(colours)).toEqual([]);
  });

  // drawElement is HyperFrames' choice on a Mac; on Linux the headless shell captures by BeginFrame, which the two
  // tests above cover (each frame is a paint the capture asks for: no snapshot to fall back to).
  it.skipIf(process.platform !== 'darwin')(
    "waits for a drawElement capture's paint past the old 250 ms fallback",
    async () => {
      const { run, out, lines, diagnostics } = await rerender(
        latePaint(LATE_MS, SLOW_EVERY, 30),
        'late-paint',
      );
      expect(run.captureMode ?? '', diagnostics.join('\n')).toContain('drawelement');
      // Every 16th frame's capture was handed its paint 400 ms late, and none ended before its paint.
      const late = lines.filter((line) => line.includes(' late '));
      expect(late.length).toBeGreaterThanOrEqual(FRAMES / SLOW_EVERY - 4);
      expect(lines.filter((line) => line.includes('ended-before-paint'))).toEqual([]);
      const colours = await patchColours(ctx, out, { x: 500, y: 900, size: 16 });
      expect(colours).toHaveLength(FRAMES);
      expect(misplaced(colours)).toEqual([]);
    },
  );

  // A generated fixture outside Seatbelt exercises the packed CLI's hardware path. The tools suite separately
  // proves its confined software screenshot path; sandbox permissions are not widened for this probe.
  it.skipIf(process.platform !== 'darwin' || !toolchain)(
    'captures every delayed paint through the independently packed CLI drawElement path',
    async () => {
      await instrumentPage(latePaint(LATE_MS, SLOW_EVERY, 30));
      const out = join(work.dir, 'cli-late-paint.mp4');
      const run = await captureWithCli({
        toolchain: toolchain!,
        dir: rendered.bundleDir,
        out,
        debugDir: join(work.dir, 'cli-debug'),
        chromePath: shell.path!,
        binaries: ctx.binaries,
      });
      expect(run.captureMode ?? '', run.lines.join('\n')).toContain('drawelement');
      expect(run.lines.filter((line) => line.includes('[late-paint] late ')).length).toBeGreaterThanOrEqual(
        FRAMES / SLOW_EVERY - 4,
      );
      expect(run.lines.filter((line) => line.includes('ended-before-paint'))).toEqual([]);
      const colours = await patchColours(ctx, out, { x: 500, y: 900, size: 16 });
      expect(colours).toHaveLength(FRAMES);
      expect(misplaced(colours)).toEqual([]);
    },
  );
});
