// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The reference fetcher (P2-T3, D11): yt-dlp with the bundled Deno, run in
 * the sandbox's fetcher profile (network allowed, writes only to the
 * experiment). The components install through the component manager on the
 * first link; later fetches find them installed. The download lands in the
 * experiment as reference.<ext>; finalise keeps it with the template (REF1).
 * Anonymous first: an Instagram reel is tried with the person's session only
 * when yt-dlp says it needs a login (fetch-login.ts).
 */
import { stat } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import {
  CancelledError,
  err,
  instagramAuthRequiredError,
  NotFoundError,
  ok,
  RationalTime,
  type AsyncResult,
  type ComponentInstallerPort,
  type ExperimentId,
  type ExperimentSandbox,
  type JobProgress,
  type SandboxRunResult,
} from '@taalcut/core';
import { z } from 'zod';
import type { ReferenceProbe, StepOptions } from '../breakdown/ports';
import { ExperimentGone, FetchFailed, FetchUnavailable, NoVideo, ReferenceTooLong } from '../errors';
import type { ReferencePlatform } from '../types';
import {
  INSTAGRAM_COOKIES_FILE,
  lastWarning,
  needsLogin,
  removeCookieFile,
  sessionCookieFile,
  type FetchSource,
} from './fetch-login';
import { parseReferenceLink } from './reference-link';
import {
  parseSourceVideoLink,
  parseSourceVideoMetadata,
  SOURCE_FETCH_LIMITS,
  type SourceVideoMetadata,
} from './source-profile';

export const REFERENCE_FETCHER_COMPONENT = 'reference-fetcher';
export const DENO_COMPONENT = 'deno';
export const REFERENCE_STEM = 'reference';
/** yt-dlp's exit status for DownloadCancelled, which --max-downloads raises once it has its file. */
const MAX_DOWNLOADS_REACHED = 101;

/** yt-dlp stopped without its file: any exit but 0 and --max-downloads' 101. */
const failed = (run: SandboxRunResult) => run.exitCode !== 0 && run.exitCode !== MAX_DOWNLOADS_REACHED;
export const FETCH_STAGE_KEYS = {
  installing: 'jobs.stage.installingFetcher',
  fetching: 'jobs.stage.fetchingReference',
} as const;

const PROGRESS_TEMPLATE =
  'download:{"status":%(progress.status)j,"downloaded":%(progress.downloaded_bytes)j,' +
  '"total":%(progress.total_bytes)j,"totalEstimate":%(progress.total_bytes_estimate)j,"eta":%(progress.eta)j}';
const SOUND_TEMPLATE = 'after_move:%(.{track,artist})j';

/**
 * yt-dlp's arguments (research note, "Flags"): one short, at most 720p, one
 * output path. 720p either way up (BRK1): the long side at most 1280, so a vertical short gets its 720x1280 rather
 * than the 360x640 a height cap of 720 left it. `deno` and `ffmpeg` are placeholders the sandbox replaces with
 * the bundled paths; it refuses any other flag.
 */
export function referenceFetchArgs(
  url: string,
  options?: { readonly cookiesFile?: string; readonly profile?: 'source' },
): string[] {
  return [
    '--ignore-config',
    '--no-plugin-dirs',
    '--no-update',
    '--no-cache-dir',
    '--js-runtimes',
    'deno',
    '--ffmpeg-location',
    'ffmpeg',
    '--no-playlist',
    '--max-downloads',
    '1',
    ...(options?.profile === 'source' ? ['--match-filters', 'duration <= 14400 & !is_live'] : []),
    '-f',
    options?.profile === 'source'
      ? SOURCE_FETCH_LIMITS.format
      : 'bv*[height<=1280][width<=1280]+ba/b[height<=1280][width<=1280]/wv*+ba/w',
    '--merge-output-format',
    'mp4',
    '--max-filesize',
    options?.profile === 'source' ? SOURCE_FETCH_LIMITS.maxFileSize : '80M',
    '--socket-timeout',
    '20',
    '--retries',
    '3',
    '--fragment-retries',
    '3',
    '--no-mtime',
    '--newline',
    '--progress',
    '--progress-template',
    PROGRESS_TEMPLATE,
    '--print',
    'after_move:filepath',
    '--print',
    options?.profile === 'source'
      ? 'after_move:%(.{track,artist,title,channel,channel_url,uploader_id})j'
      : SOUND_TEMPLATE,
    ...(options?.cookiesFile ? ['--cookies', options.cookiesFile] : []),
    '-o',
    `scratch:${REFERENCE_STEM}.%(ext)s`,
    '--',
    url,
  ];
}

/** A progress line from the template above, as job progress; other lines are logs. */
export function parseFetchProgress(line: string): JobProgress | null {
  if (!line.startsWith('{')) return null;
  try {
    const value = JSON.parse(line) as {
      status?: unknown;
      downloaded?: unknown;
      total?: unknown;
      totalEstimate?: unknown;
      eta?: unknown;
    };
    const total =
      typeof value.total === 'number'
        ? value.total
        : typeof value.totalEstimate === 'number'
          ? value.totalEstimate
          : null;
    const done = typeof value.downloaded === 'number' ? value.downloaded : null;
    return {
      fraction: total && done !== null ? Math.min(1, done / total) : null,
      ...(done !== null ? { completed: done, unit: 'bytes' as const } : {}),
      ...(total ? { total } : {}),
      ...(typeof value.eta === 'number' ? { etaMs: value.eta * 1000 } : {}),
      stageKey: FETCH_STAGE_KEYS.fetching,
    };
  } catch {
    return null;
  }
}

/** One credit field: trimmed, at most 200 characters, null when absent, empty or not a string. */
const creditField = z
  .unknown()
  .transform((item) => (typeof item === 'string' && item.trim() ? item.trim().slice(0, 200) : null));
const soundLineSchema = z.object({ track: creditField, artist: creditField });

/**
 * The platform's credited sound ("add this sound in the app") from the fetcher's JSON line. Untrusted
 * text: parsed with a schema, never asserted, and fenced for the model by fetchReferenceOutputSchema.
 */
export function parseSoundCredit(
  line: string | undefined,
): { title: string | null; artist: string | null } | null {
  if (!line?.startsWith('{')) return null;
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return null;
  }
  const parsed = soundLineSchema.safeParse(value);
  if (!parsed.success) return null;
  const sound = { title: parsed.data.track, artist: parsed.data.artist };
  return sound.title || sound.artist ? sound : null;
}

export interface FetchedReference {
  /** Relative to the experiment. */
  readonly file: string;
  readonly bytes: number;
  readonly platform: ReferencePlatform;
  readonly url: string;
  readonly duration: RationalTime;
  readonly sound: { readonly title: string | null; readonly artist: string | null } | null;
  /** Without an account, or with the person's Instagram session after that failed (REF1). */
  readonly source: FetchSource;
  /** False for a silent reel: nothing for the music to use. */
  readonly hasAudio: boolean;
  readonly metadata?: SourceVideoMetadata;
}

export interface ReferenceFetcherDeps {
  /** Exec mode: the jobs process, where children start. */
  readonly sandbox: ExperimentSandbox;
  readonly components: ComponentInstallerPort;
  readonly probe: (path: string, options: StepOptions) => AsyncResult<ReferenceProbe>;
  readonly maxSeconds?: number;
  readonly profile?: 'source';
  /**
   * The Instagram session's Netscape cookies, read in this process for the second try (fetch-login.ts); wiped as
   * soon as yt-dlp is done. Absent (the jobs process), a cookie file the agent's tool left in the experiment counts.
   */
  readonly instagramCookies?: () => AsyncResult<string | null>;
}

export function createReferenceFetcher(deps: ReferenceFetcherDeps) {
  const maxSeconds = deps.maxSeconds ?? (deps.profile === 'source' ? SOURCE_FETCH_LIMITS.maxSeconds : 180);

  async function ensureFetcher(signal: AbortSignal, progress?: (p: JobProgress) => void): AsyncResult<void> {
    if (await deps.components.get(REFERENCE_FETCHER_COMPONENT)) return ok(undefined);
    progress?.({ fraction: null, stageKey: FETCH_STAGE_KEYS.installing });
    // The manager installs `deno` first: reference-fetcher depends on it.
    const installed = await deps.components.install(REFERENCE_FETCHER_COMPONENT, { signal });
    if (installed.ok) return ok(undefined);
    const { code, detail } = installed.error;
    if (CancelledError.is(installed.error)) return installed;
    return err(FetchUnavailable(undefined, { detail: `${code}: ${detail ?? ''}` }));
  }

  return {
    async fetch(
      input: { readonly experimentId: ExperimentId; readonly url: string },
      options: { readonly signal: AbortSignal; readonly progress?: (progress: JobProgress) => void },
    ): AsyncResult<FetchedReference> {
      const link =
        deps.profile === 'source' ? parseSourceVideoLink(input.url) : parseReferenceLink(input.url);
      if (!link.ok) return link;
      const experiment = await deps.sandbox.get(input.experimentId);
      if (!experiment.ok) return err(ExperimentGone(undefined, { detail: experiment.error.code }));

      const ready = await ensureFetcher(options.signal, options.progress);
      if (!ready.ok) return ready;
      const ytDlp = (cookiesFile?: string) =>
        deps.sandbox.run(
          input.experimentId,
          {
            program: 'ytDlp',
            args: referenceFetchArgs(link.value.url, {
              ...(cookiesFile ? { cookiesFile } : {}),
              ...(deps.profile ? { profile: deps.profile } : {}),
            }),
            network: 'outbound',
            ...(deps.profile === 'source'
              ? {
                  limits: {
                    wallMs: SOURCE_FETCH_LIMITS.timeoutMs,
                    diskBytes: SOURCE_FETCH_LIMITS.scratchBytes,
                    maxFileBytes: SOURCE_FETCH_LIMITS.maxFileBytes,
                    cpuSeconds: 2 * 60 * 60,
                  },
                }
              : {}),
          },
          {
            signal: options.signal,
            onOutputLine: (_stream, line) => {
              const progress = parseFetchProgress(line);
              if (progress) options.progress?.(progress);
            },
          },
        );

      options.progress?.({ fraction: 0, stageKey: FETCH_STAGE_KEYS.fetching });
      // Anonymous first: a public reel needs no account.
      let run = await ytDlp();
      let source: FetchSource = 'anonymous';
      if (
        link.value.platform === 'reels' &&
        run.ok &&
        failed(run.value) &&
        needsLogin(run.value.stderrTail)
      ) {
        const cookies = await sessionCookieFile(experiment.value.dir, deps.instagramCookies);
        if (!cookies)
          return err(instagramAuthRequiredError(undefined, { detail: lastWarning(run.value.stderrTail) }));
        try {
          options.progress?.({ fraction: 0, stageKey: FETCH_STAGE_KEYS.fetching });
          run = await ytDlp(`scratch:${INSTAGRAM_COOKIES_FILE}`);
          source = 'session';
        } finally {
          if (cookies.owned) await removeCookieFile(cookies.path);
        }
      }
      if (!run.ok) {
        const { code, detail } = run.error;
        if (CancelledError.is(run.error) || NotFoundError.is(run.error)) return run;
        return err(FetchFailed(undefined, { detail: `${code}: ${detail ?? ''}` }));
      }
      // 101 is yt-dlp stopping at --max-downloads 1 after the one file: a success when it printed the path.
      if (failed(run.value))
        return err(
          FetchFailed(undefined, {
            detail: `${source}: exit ${run.value.exitCode}; ${lastWarning(run.value.stderrTail)}`,
          }),
        );

      // Progress may share stdout with the two --print lines: the path, then the sound's JSON.
      const lines = run.value.stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('{"status"'));
      const printed = lines.find((line) => !line.startsWith('{'));
      const soundLine = lines.find((line) => line.startsWith('{'));
      const file = printed ? (isAbsolute(printed) ? relative(experiment.value.dir, printed) : printed) : '';
      if (!file || file.startsWith('..') || isAbsolute(file))
        return err(FetchFailed(undefined, { detail: 'yt-dlp printed no file inside the experiment' }));
      const path = join(experiment.value.dir, file);
      const probe = await deps.probe(path, { signal: options.signal });
      if (!probe.ok) return probe;
      if (!probe.value.hasVideo) return err(NoVideo());
      const seconds = RationalTime.toSeconds(probe.value.duration);
      if (seconds > maxSeconds) return err(ReferenceTooLong({ seconds: Math.round(seconds) }));
      const bytes = (await stat(path)).size;
      if (deps.profile === 'source' && bytes > SOURCE_FETCH_LIMITS.maxFileBytes) {
        return err(FetchFailed(undefined, { detail: 'Source exceeds the 4 GiB import limit' }));
      }
      return ok({
        file,
        bytes,
        platform: link.value.platform,
        url: link.value.url,
        duration: probe.value.duration,
        sound: parseSoundCredit(soundLine),
        source,
        hasAudio: probe.value.hasAudio,
        ...(deps.profile === 'source' ? { metadata: parseSourceVideoMetadata(soundLine) } : {}),
      });
    },
  };
}

export type ReferenceFetcher = ReturnType<typeof createReferenceFetcher>;

export const createSourceFetcher = (deps: Omit<ReferenceFetcherDeps, 'profile'>): ReferenceFetcher =>
  createReferenceFetcher({ ...deps, profile: 'source' });
