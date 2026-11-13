// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A downloadable component as a window sees it (Settings › About's list, Settings › Models, first run, a clip
 * waiting for its models), and the download of everything this Mac needs (UX2-DOWNLOADER): the set's state, its
 * bytes, speed and time left, and each component's state, progress and last failure, which survives a restart.
 * The jobs process's component manager is the source; the desktop maps it here.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { publicErrorSchema } from '../basics/error-schema';
import { moduleIdSchema } from './models-contract';

/**
 * - `installed`: on this Mac and current.
 * - `downloading`: on its way now (`step` says which part).
 * - `queued`: in the set, waiting for a free download lane or for a component it needs to install first.
 * - `paused`: in the set, and the person paused the downloads.
 * - `not-installed`: not here, and nothing is fetching it.
 * - `update-available`: an older version is here.
 * - `failed`: its last download failed (`error` says why, after a restart too), or one it needs failed.
 */
export const COMPONENT_STATUSES = [
  'installed',
  'downloading',
  'queued',
  'paused',
  'not-installed',
  'update-available',
  'failed',
] as const;
export type ComponentStatus = (typeof COMPONENT_STATUSES)[number];

/**
 * What a downloading component is doing: picking up a partial file (re-reading what is already on disk),
 * receiving bytes, waiting to reconnect after a network error (`retryAt`), checking the file, or unpacking it.
 */
export const DOWNLOAD_STEPS = ['resuming', 'downloading', 'reconnecting', 'verifying', 'installing'] as const;
export type DownloadStep = (typeof DOWNLOAD_STEPS)[number];

/**
 * The job a component does for the person, which names its row: speech, search, text in frames, shots, beats,
 * writing, titles (the motion graphics renderer) and sound effects. A shared runtime counts toward the first job
 * that needs it. Tools fetched on demand have none.
 */
export const COMPONENT_JOBS = [
  'speech',
  'search',
  'text',
  'shots',
  'beats',
  'writing',
  'titles',
  'sounds',
] as const;
export type ComponentJob = (typeof COMPONENT_JOBS)[number];

/**
 * LNX1-TRM: terms the component's owner licenses it under, which the person accepts in the app before it downloads
 * (the manifest's `licence.acceptance`). Taalcut doesn't own, change or sell such a component: it downloads and
 * installs it at the person's request.
 */
export const componentTermsSchema = z.object({
  /** Who makes and owns it and licenses it to the person, e.g. 'NVIDIA Corporation'. Shown as is. */
  owner: z.string().min(1).max(120),
  /** The terms version the acceptance is kept under (acknowledgementsContract, componentTermsFeatureId). */
  termsVersion: z.string().min(1).max(100),
  /** Each licence text, on the owner's own https page: the title as the owner gives it, shown as is. */
  documents: z
    .array(
      z.object({
        title: z.string().min(1).max(120),
        url: z.url({ protocol: /^https$/ }),
      }),
    )
    .min(1)
    .max(8),
  /** The person accepted exactly this terms version. */
  accepted: z.boolean(),
});
export type ComponentTerms = z.infer<typeof componentTermsSchema>;

export const componentSchema = z.object({
  id: z.string(),
  /** Product name, e.g. 'FFmpeg' or 'EmbeddingGemma 2'. Shown as is. */
  name: z.string(),
  version: z.string(),
  /** SPDX licence id, e.g. 'LGPL-2.1-or-later'. */
  licence: z.string(),
  /**
   * Its licence notice is saved on this Mac (an installed version, UX2-DOWNLOADER round 3): Settings › Models and
   * Settings › About link it ("Licence"), and `files.openNotice` opens it.
   */
  notice: z.boolean().optional(),
  /** The download's size. */
  sizeBytes: z.number().nonnegative(),
  status: z.enum(COMPONENT_STATUSES),
  /** 0–1 while downloading. */
  progress: z.number().min(0).max(1).optional(),
  /** Bytes on disk toward `sizeBytes`: while it downloads, and a partial download that is paused, queued or failed. */
  bytesDone: z.number().nonnegative().optional(),
  /** While downloading: the time left once the rate is known. */
  etaMs: z.int().nonnegative().optional(),
  /** While downloading: its speed over the last few seconds. */
  bytesPerSecond: z.number().nonnegative().optional(),
  /** While downloading: which part. */
  step: z.enum(DOWNLOAD_STEPS).optional(),
  /** Step `reconnecting`: when the next attempt starts (epoch ms). */
  retryAt: z.int().nonnegative().optional(),
  /** Status `failed`: why, in the component manager's words (its own download's, or the one it needs). */
  error: publicErrorSchema.optional(),
  /** The modules that need it, if any (for "used for vision"). */
  usedBy: z.array(moduleIdSchema),
  /** The job its row is named for (absent for tools fetched on demand). */
  job: z.enum(COMPONENT_JOBS).optional(),
  /** This Mac needs it: its tier lists it, or something it lists depends on it (what `components.download` fetches). */
  needed: z.boolean().optional(),
  /**
   * The ids of the components it can't run without (the manifest's dependencies, direct and indirect). A job is
   * ready only once these are installed too, even a shared runtime whose row is another job's (ONNX Runtime, under
   * search, for text in frames, shots and beats).
   */
  needs: z.array(z.string()).optional(),
  /** Its owner's terms, which the person accepts before it downloads (LNX1-TRM). Absent for every other component. */
  terms: componentTermsSchema.optional(),
});
export type Component = z.infer<typeof componentSchema>;

/**
 * LNX1-TRM: a component the download would fetch here once the person accepts its owner's terms (`component.terms`,
 * not accepted), held out of `components` until then, with the ids of the components it brings in with it (the CUDA
 * builds that load NVIDIA's CUDA runtime). Without them the set holds the builds that run without it.
 */
export const termsHoldSchema = z.object({
  component: componentSchema,
  unlocks: z.array(z.string()),
});
export type TermsHold = z.infer<typeof termsHoldSchema>;

/**
 * - `ready`: everything this Mac needs is installed.
 * - `downloading`: on its way (a component may have failed already; the others carry on).
 * - `paused`: the person paused it; it stays paused across restarts until resumed.
 * - `failed`: it stopped with some components that didn't download (each says why).
 * - `missing`: some aren't here and nothing is fetching them (never started, or cancelled).
 */
export const DOWNLOADS_STATES = ['ready', 'downloading', 'paused', 'failed', 'missing'] as const;
export type DownloadsState = (typeof DOWNLOADS_STATES)[number];

const count = z.int().nonnegative();

/** The download of everything this Mac needs (`system.downloads`, the `components.downloads` event). */
export const downloadsSchema = z.object({
  state: z.enum(DOWNLOADS_STATES),
  /** What this Mac needs: every component its tier lists, with what they depend on, in download order. */
  components: z.array(componentSchema),
  /** How many components are in each state. */
  counts: z.object({
    installed: count,
    downloading: count,
    queued: count,
    paused: count,
    failed: count,
    missing: count,
  }),
  /** What this download is about: the components it fetches, including those it has finished. */
  bytesTotal: z.number().nonnegative(),
  /** Of those: installed, plus what is on disk of the rest. */
  bytesDone: z.number().nonnegative(),
  /** Over every component downloading now, over the last few seconds. */
  bytesPerSecond: z.number().nonnegative(),
  /** Until everything is installed, once the rate is known. */
  etaMs: z.int().nonnegative().optional(),
  /** Space the rest needs on this Mac (downloads, unpacking and headroom), and what the disk has free. */
  requiredBytes: z.number().nonnegative(),
  freeBytes: z.number().nonnegative().optional(),
  /**
   * Why the set couldn't start or go on: not enough space, a manifest this build can't trust, a probe that
   * failed. A component's own failure is on its row instead.
   */
  error: publicErrorSchema.optional(),
  /** What waits for the person to accept its owner's terms (LNX1-TRM). Absent or empty: nothing does. */
  awaitingTerms: z.array(termsHoldSchema).optional(),
});
export type Downloads = z.infer<typeof downloadsSchema>;
