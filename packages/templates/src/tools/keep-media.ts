// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Keeping the reel (REF1, the owner's decision of 2026-10-29): a template keeps its reel's video and music on this
 * Mac, because the music is what its shots are cut to. At finalise a fetched download moves out of the experiment
 * into the library's template media store, and a dropped file or screen recording is copied in (the person's file
 * stays where it is, untouched; a screen recording is cropped only for analysis, so its original is kept).
 */
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import {
  ok,
  RationalTime,
  type AsyncResult,
  type KeepTemplateMediaInput,
  type TemplateId,
  type TemplateMedia,
  type TemplateMediaStore,
} from '@taalcut/core';
import type { BreakdownDraft } from '../breakdown/draft';
import { readKeepRecord } from '../jobs/handlers';

/** The download in an experiment: reference.<ext>, as the fetcher names it. */
export const DOWNLOAD_FILE = /^reference\.[a-z0-9]+$/i;

/** Whole milliseconds, at least 1 (the media schema's durationMs is positive). */
export function durationMs(duration: RationalTime): number {
  return Math.max(1, Math.round(RationalTime.toSeconds(duration) * 1000));
}

async function isFile(path: string): Promise<boolean> {
  return (await stat(path).catch(() => null))?.isFile() ?? false;
}

/**
 * What to keep for a breakdown's experiment: the download (moved) or the person's file (copied). Null when there is
 * nothing to keep: an experiment from before REF1 with no record of the file, or a file that is no longer there.
 */
export async function keepInputFor(
  draft: BreakdownDraft,
  dir: string,
): Promise<KeepTemplateMediaInput | null> {
  const record = await readKeepRecord(dir);
  const hasAudio = draft.reference.source.hasAudio ?? record.hasAudio ?? draft.audio.kind !== 'silent';
  const measured = { durationMs: durationMs(draft.reference.source.duration), hasAudio };
  if (draft.reference.input === 'link') {
    const names = await readdir(dir).catch(() => [] as string[]);
    const file = names.find((name) => DOWNLOAD_FILE.test(name));
    if (!file || !(await isFile(join(dir, file)))) return null;
    // A fetch from before REF1 recorded no source: it went out without an account unless signed in.
    return { path: join(dir, file), mode: 'move', source: record.source ?? 'anonymous', ...measured };
  }
  if (!record.path || !(await isFile(record.path))) return null;
  return { path: record.path, mode: 'copy', source: 'file', ...measured };
}

/**
 * Keeps the breakdown's reel as the template's media. With nothing left to keep (a finalise called again after its
 * download moved), the media kept already. Ok(null) when there is no store or nothing kept; a store that refuses is
 * the caller's to report (the template is saved either way).
 */
export async function keepReference(
  media: TemplateMediaStore | undefined,
  templateId: TemplateId,
  draft: BreakdownDraft,
  dir: string,
): AsyncResult<TemplateMedia | null> {
  if (!media) return ok(null);
  const input = await keepInputFor(draft, dir);
  if (input) return media.keep(templateId, input);
  const kept = await media.get(templateId);
  return kept.ok ? ok(kept.value?.media ?? null) : kept;
}
