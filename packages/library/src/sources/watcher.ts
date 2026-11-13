// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Watching folders (P2-L2, jobs process). One recursive `fs.watch` (FSEvents
 * on macOS) per watched, online source; the set is re-read from `sources`
 * every 2 s, so commands in the agent process take effect without IPC. A
 * changed path waits 2 s after its last event, then until its size and mtime
 * are the same across two checks 1 s apart (a copy in progress), or 10
 * minutes have passed; ready paths are batched (≤ 500, or 2 s) into one
 * `library.scanSource { mode: 'paths' }`. A lost event stream, a watcher
 * error or a drive mounting under /Volumes falls back to a full scan, as does
 * every start (stat-only for unchanged files, so it is cheap).
 */
import { watch as fsWatch } from 'node:fs';
import { stat as fsStat } from 'node:fs/promises';
import type { SourceId } from '@taalcut/core';
import type { LibraryDatabase } from '../db/database';
import { inTransaction } from '../repositories/shared';
import { createSourceRepository } from '../repositories/sources';
import { enqueueScan } from './enqueue';
import type { ScanSourceInput } from './job-kinds';
import { mediaTypeOf } from './media-files';
import { absolutePathOf } from './scan-store';
import { isIgnoredSegment } from './walk';

export interface WatchHandle {
  close(): void;
}

export interface WatchBackend {
  /** Watches `root` (recursively unless told not to). `onChange(null)`: events were lost (rescan everything). */
  watch(
    root: string,
    onChange: (relativePath: string | null) => void,
    onError: (cause: unknown) => void,
    options?: { readonly recursive?: boolean },
  ): WatchHandle;
}

/** Node's recursive fs.watch: FSEvents on macOS. */
export const fsWatchBackend: WatchBackend = {
  watch(root, onChange, onError, options = {}) {
    const recursive = options.recursive ?? true;
    const watcher = fsWatch(root, { recursive, persistent: false }, (_event, filename) => {
      onChange(filename === null ? null : String(filename).split('\\').join('/').normalize('NFC'));
    });
    watcher.on('error', onError);
    return { close: () => watcher.close() };
  },
};

export interface WatchTimings {
  /** How often the set of watched sources is re-read. */
  readonly refreshMs: number;
  /** Quiet time after a path's last event. */
  readonly debounceMs: number;
  /** Gap between the two size + mtime checks. */
  readonly stableCheckMs: number;
  /** A file still changing after this is scanned as is. */
  readonly settleTimeoutMs: number;
  readonly batchMs: number;
  readonly batchMax: number;
}

export const DEFAULT_WATCH_TIMINGS: WatchTimings = {
  refreshMs: 2_000,
  debounceMs: 2_000,
  stableCheckMs: 1_000,
  settleTimeoutMs: 600_000,
  batchMs: 2_000,
  batchMax: 500,
};

type FileState = { readonly size: number; readonly mtimeMs: number; readonly directory: boolean };

export interface FolderWatcherDeps {
  readonly db: LibraryDatabase;
  readonly backend?: WatchBackend;
  /** Default: a `library.scanSource` job row (enqueueScan). */
  readonly enqueue?: (input: ScanSourceInput) => void;
  readonly stat?: (path: string) => Promise<FileState | undefined>;
  readonly timings?: Partial<WatchTimings>;
  /** Watched for drives mounting (default '/Volumes'; null: not watched). */
  readonly volumesDir?: string | null;
  readonly log?: (message: string) => void;
}

export interface FolderWatcher {
  /** Starts watching and asks for a full scan of every watched folder. */
  start(): void;
  stop(): void;
  /** Re-reads the watched sources now (also runs every `refreshMs`). */
  refresh(): void;
  watching(): SourceId[];
}

interface Pending {
  readonly firstAt: number;
  timer?: ReturnType<typeof setTimeout>;
  last?: FileState | undefined;
}

interface Watched {
  readonly root: string;
  handle: WatchHandle | null;
  readonly pending: Map<string, Pending>;
  readonly batch: Set<string>;
  batchTimer?: ReturnType<typeof setTimeout>;
}

const defaultStat = async (path: string): Promise<FileState | undefined> => {
  const info = await fsStat(path).catch(() => undefined);
  return info && { size: info.size, mtimeMs: info.mtimeMs, directory: info.isDirectory() };
};

export function createFolderWatcher(deps: FolderWatcherDeps): FolderWatcher {
  const t = { ...DEFAULT_WATCH_TIMINGS, ...deps.timings };
  const backend = deps.backend ?? fsWatchBackend;
  const stat = deps.stat ?? defaultStat;
  const log = deps.log ?? (() => {});
  const sources = createSourceRepository(deps.db);
  const enqueue =
    deps.enqueue ??
    ((input: ScanSourceInput) => {
      const queued = inTransaction(deps.db, 'job', () => enqueueScan(deps.db, input));
      if (!queued.ok) log(`scan of ${input.sourceId} not enqueued: ${queued.error.code}`);
    });
  const watched = new Map<SourceId, Watched>();
  let refreshTimer: ReturnType<typeof setInterval> | undefined;
  let volumes: WatchHandle | null = null;

  const fullScan = (sourceId: SourceId) => enqueue({ sourceId, mode: 'full', via: 'watcher' });

  const flush = (sourceId: SourceId, entry: Watched) => {
    if (entry.batchTimer) clearTimeout(entry.batchTimer);
    entry.batchTimer = undefined;
    const paths = [...entry.batch];
    entry.batch.clear();
    for (let i = 0; i < paths.length; i += t.batchMax) {
      enqueue({ sourceId, mode: 'paths', paths: paths.slice(i, i + t.batchMax), via: 'watcher' });
    }
  };

  const ready = (sourceId: SourceId, entry: Watched, path: string) => {
    entry.pending.delete(path);
    entry.batch.add(path);
    if (entry.batch.size >= t.batchMax) flush(sourceId, entry);
    else entry.batchTimer ??= setTimeout(() => flush(sourceId, entry), t.batchMs);
  };

  const check = async (sourceId: SourceId, entry: Watched, path: string, state: Pending) => {
    state.timer = undefined;
    const now = await stat(absolutePathOf(entry.root, path));
    if (entry.pending.get(path) !== state || state.timer) return; // A newer event took over.
    if (!now || now.directory) return ready(sourceId, entry, path);
    if (!mediaTypeOf(path)) return void entry.pending.delete(path);
    const stable = state.last && state.last.size === now.size && state.last.mtimeMs === now.mtimeMs;
    if (stable || Date.now() - state.firstAt >= t.settleTimeoutMs) return ready(sourceId, entry, path);
    state.last = now;
    state.timer = setTimeout(() => void check(sourceId, entry, path, state), t.stableCheckMs);
  };

  const onChange = (sourceId: SourceId, entry: Watched, path: string | null) => {
    if (path === null) return fullScan(sourceId);
    if (!path || path.split('/').some((segment) => isIgnoredSegment(segment))) return;
    const state = entry.pending.get(path) ?? { firstAt: Date.now() };
    if (state.timer) clearTimeout(state.timer);
    state.last = undefined; // It changed again: stability is measured from here.
    state.timer = setTimeout(() => void check(sourceId, entry, path, state), t.debounceMs);
    entry.pending.set(path, state);
  };

  const open = (sourceId: SourceId, entry: Watched) => {
    try {
      entry.handle = backend.watch(
        entry.root,
        (path) => onChange(sourceId, entry, path),
        (cause) => {
          log(`watcher for ${sourceId} failed: ${String(cause)}`);
          entry.handle?.close();
          entry.handle = null; // Re-opened by the next refresh.
          fullScan(sourceId);
        },
      );
    } catch (cause) {
      log(`can't watch ${sourceId}: ${String(cause)}`);
      entry.handle = null;
    }
  };

  const close = (sourceId: SourceId, entry: Watched) => {
    entry.handle?.close();
    for (const state of entry.pending.values()) if (state.timer) clearTimeout(state.timer);
    if (entry.batch.size > 0) flush(sourceId, entry);
    watched.delete(sourceId);
  };

  const refresh = () => {
    const wanted = new Map(
      sources
        .list({ kinds: ['watched_folder'] })
        .filter((s) => s.watch && s.status === 'online')
        .map((s) => [s.id, s.rootPath] as const),
    );
    for (const [id, entry] of watched) if (wanted.get(id) !== entry.root) close(id, entry);
    for (const [id, root] of wanted) {
      const entry = watched.get(id);
      if (entry) {
        if (!entry.handle) open(id, entry);
        continue;
      }
      const created: Watched = { root, handle: null, pending: new Map(), batch: new Set() };
      watched.set(id, created);
      open(id, created);
    }
  };

  /** A drive mounted or went away: sources on drives rescan (a scan marks them online or offline). */
  const onVolumes = () => {
    for (const source of sources.list({ kinds: ['watched_folder'] })) {
      if (source.watch && source.rootPath.startsWith(`${deps.volumesDir ?? '/Volumes'}/`))
        fullScan(source.id);
    }
    refresh();
  };

  return {
    start() {
      if (refreshTimer) return;
      refresh();
      for (const source of sources.list({ kinds: ['watched_folder'] })) if (source.watch) fullScan(source.id);
      refreshTimer = setInterval(refresh, t.refreshMs);
      const volumesDir = deps.volumesDir === undefined ? '/Volumes' : deps.volumesDir;
      if (volumesDir) {
        try {
          // Not recursive: only drives appearing and going, never what is on them.
          volumes = backend.watch(
            volumesDir,
            () => onVolumes(),
            (cause) => log(`volumes watcher: ${String(cause)}`),
            { recursive: false },
          );
        } catch {
          volumes = null;
        }
      }
    },
    stop() {
      if (refreshTimer) clearInterval(refreshTimer);
      refreshTimer = undefined;
      volumes?.close();
      volumes = null;
      for (const [id, entry] of [...watched]) close(id, entry);
    },
    refresh,
    watching: () => [...watched.keys()],
  };
}
