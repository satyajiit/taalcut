// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Capture sessions on a written bundle: the producer's file server and
 * capture session over the pinned shell, seeking frame by frame. QA's DOM
 * probe reads the text boxes Chrome actually laid out (qa-gate.md, "DOM
 * probe": the authoritative measurement), and timeline.captureFrame takes
 * screenshots. The shell has no H.264 decoder, so a bundle meant for
 * screenshots carries stills in place of video (see stillBundle).
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { err, ok, type AsyncResult, type FrameRate } from '@taalcut/core';
import { CAPTION_FONT_FILES, fontCovers, type FontKey } from '../captions/fonts';
import { CaptureFailed, EngineUnavailable } from '../errors';
import type { ProbedTextBox, ProbedVisual } from '../types';
import { DOM_PROBE } from './dom-probe';
import { HEADLESS_SHELL } from './headless-shell';
import { loadProducer, useSidecarFfmpeg } from './producer';

export interface CaptureSessionOptions {
  readonly dir: string;
  readonly rate: FrameRate;
  readonly width: number;
  readonly height: number;
  readonly chromePath: string;
  readonly browserGpu: 'hardware' | 'software';
  readonly binaries: { readonly ffmpeg: string; readonly ffprobe: string };
  /**
   * DSG1-AUT: the page may load only the bundle's own server; every other request fails before it leaves Chrome,
   * and its URL is added to `blocked` (the validator's network check reads it).
   */
  readonly offline?: { readonly blocked: string[] };
  /** HFW1: 'png' captures lossless frames (comparisons within a channel step); default JPEG at quality 90. */
  readonly format?: 'jpeg' | 'png';
  /** WP-HFW-3D-CDP: hook called with the live browser page before initialization to attach CDP diagnostics. */
  readonly onPage?: (page: unknown) => void;
}

export interface CaptureHandle {
  /** Seeks to frame k and returns a JPEG of the canvas (a PNG when the session's format is 'png'). */
  screenshot(frame: number): AsyncResult<Buffer>;
  /** Seeks to frame k and reads every visible [data-tc-text] and [data-tc-composition] element. */
  probeText(frame: number): AsyncResult<ProbedTextBox[]>;
  /** Seeks to frame k and reads the text boxes and every [data-tc-visual] element's crop (P3-V2). */
  probeFrame(frame: number): AsyncResult<{ boxes: ProbedTextBox[]; visuals: ProbedVisual[] }>;
  /** Seeks to frame k and evaluates a page expression of Taalcut's own (the motion frame oracle, SPEC G.2). */
  evaluateAt(frame: number, expression: string): AsyncResult<unknown>;
  close(): Promise<void>;
}

type RawBox = Omit<ProbedTextBox, 'frame' | 'fontsReady'> & {
  readonly text: string;
  readonly families: string;
};

const unquote = (family: string) => family.trim().replace(/^["']|["']$/g, '');

/**
 * Whether every face the text is drawn with was loaded: for each character, the first family in the
 * stack whose font covers it (as Chrome picks). FontFaceSet.check can't say this: it also wants every
 * fallback face whose range merely touches the text (the emoji font covers digits and space).
 */
export function fontsReadyFor(text: string, familyList: string, loaded: ReadonlySet<string>): boolean {
  const keys = familyList.split(',').map((family) => {
    const name = unquote(family);
    return {
      name,
      key: CAPTION_FONT_FILES.find((file) => file.family === name)?.fontId as FontKey | undefined,
    };
  });
  for (const char of text) {
    const codepoint = char.codePointAt(0)!;
    if (/\s/u.test(char)) continue;
    const face = keys.find((entry) => entry.key !== undefined && fontCovers(entry.key, codepoint));
    // A character no bundled font covers is the glyph check's finding, not a loading one.
    if (face && !loaded.has(face.name)) return false;
  }
  return true;
}

/** Clamps a probed box's origin at 0 (a box that leaves the frame still reports its size). */
function sanitize(
  probed: { readonly boxes: readonly RawBox[]; readonly loaded: readonly string[] },
  frame: number,
): ProbedTextBox[] {
  const loaded = new Set(probed.loaded);
  return probed.boxes.map(({ text, families, ...box }) => ({
    ...box,
    fontsReady: text.length === 0 || fontsReadyFor(text, families, loaded),
    frame,
    box: {
      x: Math.max(0, box.box.x),
      y: Math.max(0, box.box.y),
      width: Math.max(1, box.box.width + Math.min(0, box.box.x)),
      height: Math.max(1, box.box.height + Math.min(0, box.box.y)),
    },
  }));
}

interface CdpPage {
  createCDPSession(): Promise<{
    send(method: string, params?: object): Promise<unknown>;
    on(event: string, listener: (event: { requestId: string; request: { url: string } }) => void): unknown;
  }>;
}

/** Fails every request but the bundle server's, before navigation (Chrome's Fetch domain on a session of ours). */
async function blockOutside(page: unknown, serverUrl: string, blocked: string[]): Promise<void> {
  const client = await (page as CdpPage).createCDPSession();
  const origin = new URL(serverUrl).origin;
  client.on('Fetch.requestPaused', ({ requestId, request }) => {
    if (request.url.startsWith(`${origin}/`)) {
      void client.send('Fetch.continueRequest', { requestId }).catch(() => undefined);
      return;
    }
    blocked.push(request.url.slice(0, 200));
    void client
      .send('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' })
      .catch(() => undefined);
  });
  await client.send('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
}

export async function openCaptureSession(options: CaptureSessionOptions): AsyncResult<CaptureHandle> {
  let producer: Awaited<ReturnType<typeof loadProducer>>;
  try {
    producer = await loadProducer();
  } catch (cause) {
    return err(EngineUnavailable({ reason: 'producer' }, { detail: String(cause) }));
  }
  useSidecarFfmpeg(options.binaries);
  const fps = { num: options.rate.num, den: options.rate.den };
  const scratch = await mkdtemp(join(tmpdir(), 'taalcut-capture-'));
  let server: Awaited<ReturnType<typeof producer.createFileServer>> | undefined;
  let session: Awaited<ReturnType<typeof producer.createCaptureSession>> | undefined;
  const cleanup = async () => {
    if (session) await producer.closeCaptureSession(session).catch(() => undefined);
    server?.close();
    await rm(scratch, { recursive: true, force: true });
  };
  try {
    server = await producer.createFileServer({ projectDir: options.dir, fps });
    const config = producer.resolveConfig({
      chromePath: options.chromePath,
      browserGpuMode: options.browserGpu,
      expectedChromiumMajor: HEADLESS_SHELL.chromiumMajor,
      forceScreenshot: true,
    });
    session = await producer.createCaptureSession(
      server.url,
      scratch,
      options.format === 'png'
        ? { width: options.width, height: options.height, fps, format: 'png' }
        : { width: options.width, height: options.height, fps, format: 'jpeg', quality: 90 },
      null,
      config,
    );
    if (options.offline) await blockOutside(session.page, server.url, options.offline.blocked);
    options.onPage?.(session.page);
    await producer.initializeSession(session);
  } catch (cause) {
    await cleanup();
    return err(CaptureFailed(undefined, { detail: String(cause) }));
  }
  const live = session;
  const seconds = (frame: number) => (frame * options.rate.den) / options.rate.num;
  let currentFrame: number | null = null;
  const seek = async (frame: number): AsyncResult<Buffer> => {
    const clamped = Math.max(0, Math.floor(frame));
    try {
      const captured = await producer.captureFrameToBuffer(live, clamped, seconds(clamped));
      currentFrame = clamped;
      return ok(captured.buffer);
    } catch (cause) {
      currentFrame = null;
      return err(CaptureFailed(undefined, { detail: String(cause) }));
    }
  };
  type Probed = Parameters<typeof sanitize>[0] & { readonly visuals: readonly Omit<ProbedVisual, 'frame'>[] };
  const probeAt = async (frame: number): AsyncResult<{ boxes: ProbedTextBox[]; visuals: ProbedVisual[] }> => {
    const clamped = Math.max(0, Math.floor(frame));
    if (currentFrame !== clamped) {
      const seeked = await seek(clamped);
      if (!seeked.ok) return seeked;
    }
    try {
      const probed = (await live.page.evaluate(DOM_PROBE)) as Probed;
      return ok({
        boxes: sanitize(probed, clamped),
        visuals: probed.visuals.map((visual) => ({ ...visual, frame: clamped })),
      });
    } catch (cause) {
      return err(CaptureFailed(undefined, { detail: String(cause) }));
    }
  };
  return ok({
    screenshot: seek,
    async probeText(frame) {
      const probed = await probeAt(frame);
      return probed.ok ? ok(probed.value.boxes) : probed;
    },
    probeFrame: probeAt,
    async evaluateAt(frame, expression) {
      const clamped = Math.max(0, Math.floor(frame));
      if (currentFrame !== clamped) {
        const seeked = await seek(clamped);
        if (!seeked.ok) return seeked;
      }
      try {
        return ok(await live.page.evaluate(expression));
      } catch (cause) {
        return err(CaptureFailed(undefined, { detail: String(cause) }));
      }
    },
    close: cleanup,
  });
}
