// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Live preview sessions (P2-M7, SPEC section 5): a timeline compiled as the
 * 'preview' variant into <preview>/<token>/, which main serves as
 * app://preview/<token>/… to the PreviewPlayer. Each session has a 32-hex
 * token (never guessable, never a path), plays proxies (originals when there
 * is none), and is recompiled in place on refresh: only files whose content
 * key changed are relinked, so the page still playing keeps its media.
 *
 * Fonts go through the session's manifest.json (they sit under the fonts
 * root main allows); media, the HyperFrames runtime and the sound are hard
 * links (copies across volumes). Sessions idle for 30 minutes are swept.
 *
 * The same token folders back the renders router's media URLs (mediaFolder).
 */
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  createSerialQueue,
  err,
  newId,
  NotFoundError,
  ok,
  previewSessionSchema,
  type AsyncResult,
  type PreviewSession,
  type PreviewSessionId,
  type ProjectId,
  type SerialQueue,
  type Timeline,
  type TimelineId,
} from '@taalcut/core';
import { createCompositionFonts } from '../captions/fonts';
import { layoutCue } from '../captions/layout';
import { compileComposition, type CaptionLayout, type CompositionBundle } from '../compile/composition';
import { PreviewSessionExpired } from '../errors';
import { showProposals } from '../compositions/timing-context';
import { planTimeline } from '../plan/render-plan';
import { DEFAULT_PRESET_ID, presetFor } from '../presets/presets.v1';
import { writeBundle } from './bundle-writer';
import type { RenderEngineDeps } from './deps';
import { previewMedia } from './preview-media';
import { canvasPreset } from '../presets/canvas-preset';
import { previewLook } from './preview-look';
import { previewMix, type PreviewMix } from './preview-sound';
import { producerRuntimeScript } from './producer';

export const PREVIEW_IDLE_MS = 30 * 60_000;
export const PREVIEW_MANIFEST = 'manifest.json';
const TOKEN = /^[0-9a-f]{32}$/;

export interface PreviewSessionsOptions {
  /** Idle time before sweep closes a session or a media folder. Default 30 minutes. */
  readonly idleMs?: number;
  /** Mix the clips' sound (and the music path's) into the session. Default true. */
  readonly audio?: boolean;
}

export interface MediaFolder {
  readonly token: string;
  readonly dir: string;
  /** app://preview/<token>/<file> */
  url(file: string): string;
}

export interface PreviewSessions {
  open(projectId: ProjectId, timelineId: TimelineId): AsyncResult<PreviewSession>;
  /** Recompiles at the timeline's latest revision: same session and token, next revision. */
  refresh(sessionId: PreviewSessionId): AsyncResult<PreviewSession>;
  close(sessionId: PreviewSessionId): AsyncResult<{ closed: boolean }>;
  /** One token folder per key (e.g. '<renderId>:poster'), made on first use and kept while used. */
  mediaFolder(key: string): Promise<MediaFolder>;
  /** Closes idle sessions and media folders and removes leftover token folders; returns how many went. */
  sweep(now?: number): Promise<number>;
  closeAll(): Promise<void>;
}

interface SessionState {
  readonly id: PreviewSessionId;
  readonly token: string;
  readonly dir: string;
  readonly projectId: ProjectId;
  readonly timelineId: TimelineId;
  revision: number;
  lastUsed: number;
  /** Bundle path → content key of what is linked there now. */
  links: Map<string, string>;
  /** The current mix, by the key of what it was made from. */
  mix: PreviewMix | null;
  snapshot: PreviewSession | null;
  /** Builds run one at a time per session. */
  readonly queue: SerialQueue;
}

const sha = (value: string) => createHash('sha256').update(value).digest('hex');
const urlOf = (token: string, file: string) => `app://preview/${token}/${file}`;

async function fileKey(path: string): Promise<string | null> {
  try {
    const info = await stat(path);
    return info.isFile() ? sha(`${path}\0${info.size}\0${Math.round(info.mtimeMs)}`).slice(0, 40) : null;
  } catch {
    return null;
  }
}

/** Writes what changed: text files always, links only when their key changed; drops paths no longer used. */
async function writeSession(state: SessionState, bundle: CompositionBundle, fontsDir: string): Promise<void> {
  const manifest: Record<string, string> = {};
  const changed: Record<string, { source: string; key: string }> = {};
  for (const [path, link] of Object.entries(bundle.links)) {
    if (path.startsWith('fonts/') && link.source.startsWith(fontsDir)) manifest[path] = link.source;
    else if (state.links.get(path) !== link.key) changed[path] = link;
  }
  await writeBundle({ files: bundle.files, links: changed }, state.dir);
  for (const path of state.links.keys()) {
    if (!(path in bundle.links) || path in manifest)
      await rm(join(state.dir, ...path.split('/')), { force: true });
  }
  await writeFile(join(state.dir, PREVIEW_MANIFEST), JSON.stringify(manifest));
  state.links = new Map(
    Object.entries(bundle.links)
      .filter(([path]) => !(path in manifest))
      .map(([path, link]) => [path, link.key]),
  );
}

export function createPreviewSessions(
  deps: RenderEngineDeps,
  options: PreviewSessionsOptions = {},
): PreviewSessions {
  const idleMs = options.idleMs ?? PREVIEW_IDLE_MS;
  const sessions = new Map<PreviewSessionId, SessionState>();
  const media = new Map<string, MediaFolder & { lastUsed: number }>();
  let runtime: Promise<{ file: string; key: string }> | undefined;
  const runtimeScript = () =>
    (runtime ??= producerRuntimeScript().then(async (file) => ({
      file,
      key: (await fileKey(file)) ?? sha(file),
    })));

  async function newFolder(): Promise<{ token: string; dir: string }> {
    const token = randomBytes(16).toString('hex');
    const dir = join(deps.folders.preview, token);
    await mkdir(dir, { recursive: true });
    return { token, dir };
  }

  async function build(state: SessionState, stored: Timeline): AsyncResult<PreviewSession> {
    // EDT1-GFX: the preview draws a graphic the chat proposed, so the person sees it before they use it.
    const timeline = showProposals(stored);
    const plan = planTimeline(timeline);
    if (!plan.ok) return plan;
    const entries = await previewMedia(deps, plan.value, state.dir);
    if (!entries.ok) return entries;
    if (options.audio !== false)
      state.mix = await previewMix(deps, plan.value, timeline, state.dir, state.mix);
    const measurer = await deps.measurer();
    const preset = canvasPreset(presetFor(DEFAULT_PRESET_ID), timeline.canvas);
    const captionLayout: CaptionLayout = (text, style, safe, language, canvasHeight) =>
      layoutCue(text, style, measurer, safe, language, canvasHeight);
    const look = await previewLook(deps, timeline, preset, entries.value, captionLayout);
    if (!look.ok) return look;
    const compiled = compileComposition(timeline, {
      variant: 'preview',
      ...look.value,
      preset,
      burnCaptions: true,
      media: (visual) => entries.value.get(visual.id),
      fonts: createCompositionFonts(deps.fontsDir, measurer),
      captionLayout,
      runtimeScript: await runtimeScript(),
      ...(state.mix ? { audio: state.mix } : {}),
    });
    if (!compiled.ok) return compiled;
    await writeSession(state, compiled.value, deps.fontsDir);
    state.lastUsed = deps.clock.now();
    state.snapshot = previewSessionSchema.parse({
      sessionId: state.id,
      url: `${urlOf(state.token, 'index.html')}?rev=${state.revision}`,
      revision: state.revision,
      timelineRevision: stored.revision,
      width: compiled.value.plan.width,
      height: compiled.value.plan.height,
      rate: compiled.value.rate,
      durationFrames: compiled.value.durationFrames,
      compositionHash: compiled.value.compositionHash,
    });
    return ok(state.snapshot);
  }

  async function closeSession(state: SessionState): Promise<void> {
    sessions.delete(state.id);
    await state.queue.settled();
    await rm(state.dir, { recursive: true, force: true });
  }

  return {
    async open(projectId, timelineId) {
      const timeline = await deps.timelines.get(timelineId);
      if (!timeline.ok) return timeline;
      if (timeline.value.projectId !== projectId)
        return err(NotFoundError({ entity: 'timeline', id: timelineId }));
      const folder = await newFolder();
      const state: SessionState = {
        id: newId<'PreviewSession'>(),
        ...folder,
        projectId,
        timelineId,
        revision: 0,
        lastUsed: deps.clock.now(),
        links: new Map(),
        mix: null,
        snapshot: null,
        queue: createSerialQueue(),
      };
      sessions.set(state.id, state);
      let ready = false;
      try {
        const built = await state.queue.run(() => build(state, timeline.value));
        ready = built.ok;
        return built;
      } finally {
        // A rejected filesystem operation must not leave a fresh session behind on every UI retry.
        if (!ready) await closeSession(state);
      }
    },
    async refresh(sessionId) {
      const state = sessions.get(sessionId);
      if (!state) return err(PreviewSessionExpired());
      state.lastUsed = deps.clock.now();
      return state.queue.run(async () => {
        const timeline = await deps.timelines.get(state.timelineId);
        if (!timeline.ok) return timeline;
        state.revision += 1;
        return build(state, timeline.value);
      });
    },
    async close(sessionId) {
      const state = sessions.get(sessionId);
      if (!state) return ok({ closed: false });
      await closeSession(state);
      return ok({ closed: true });
    },
    async mediaFolder(key) {
      const existing = media.get(key);
      if (existing) {
        existing.lastUsed = deps.clock.now();
        await mkdir(existing.dir, { recursive: true });
        return existing;
      }
      const folder = await newFolder();
      const entry = {
        ...folder,
        url: (file: string) => urlOf(folder.token, file),
        lastUsed: deps.clock.now(),
      };
      media.set(key, entry);
      return entry;
    },
    async sweep(now = deps.clock.now()) {
      let removed = 0;
      for (const state of [...sessions.values()]) {
        if (now - state.lastUsed < idleMs) continue;
        await closeSession(state);
        removed += 1;
      }
      for (const [key, entry] of [...media.entries()]) {
        if (now - entry.lastUsed < idleMs) continue;
        media.delete(key);
        await rm(entry.dir, { recursive: true, force: true });
        removed += 1;
      }
      // Folders of an earlier process (sessions live in memory): gone once idle as long.
      const live = new Set([
        ...[...sessions.values()].map((state) => state.token),
        ...[...media.values()].map((entry) => entry.token),
      ]);
      const names = await readdir(deps.folders.preview).catch(() => [] as string[]);
      for (const name of names) {
        if (!TOKEN.test(name) || live.has(name)) continue;
        const info = await stat(join(deps.folders.preview, name)).catch(() => null);
        if (!info || now - info.mtimeMs < idleMs) continue;
        await rm(join(deps.folders.preview, name), { recursive: true, force: true });
        removed += 1;
      }
      return removed;
    },
    async closeAll() {
      for (const state of [...sessions.values()]) await closeSession(state);
      for (const entry of media.values()) await rm(entry.dir, { recursive: true, force: true });
      media.clear();
    },
  };
}
