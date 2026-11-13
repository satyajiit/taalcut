// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-X1's agent tool: `audio.cloudCritique` (@taalcut/models, which alone may call a provider), joined to the
 * agent's tools by agent-audio.ts's `withAudioTools` after lanes A and B: a module whose `id` is `audio` joins its
 * namesake after the tools it already has. Never on MCP (the tool's `exposure`).
 *
 * What the tool needs from this process:
 * - the sound: a library asset's original, or an artifact copied to scratch, probed and encoded by FFmpeg as mono
 *   AAC (Gemini takes `audio/aac`; this LGPL build has no LAME for upstream's MP3), the window only, `-vn`;
 * - what this Mac hears over that window: an `audio.listen.analyse` job (measures; with `withTimeline` events and
 *   sections too), never downloading a model mid-call (`install: false`);
 * - the consent check: a granted consent approval for this very call in the agent's run log, which only the consent
 *   card's "Allow" gives (EAR1-R3: the tool asks every time, so no standing consent, vision's for frames or
 *   `vision.audio`, counts), else `audio.cloud_critique_consent_required`;
 * - the sound's name for that card (`critiqueUploadNames`, EAR1-R3), wired as the agent's `uploadNames`;
 * - Local only, refusing until the setting is read (agent-flows.ts).
 */
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fromCoreEventLog } from '@taalcut/agent';
import { CloudCritiqueConsentRequired, ListenBadInput, runListenAnalyse } from '@taalcut/audio';
import {
  defineToolModule,
  err,
  EventLogStoreToken,
  fileNameOf,
  FrameRate,
  JobRunnerToken,
  NotFoundError,
  ok,
  parseId,
  RationalTime,
  TemplateStoreToken,
  TimeRange,
  type ArtifactStore,
  type AsyncResult,
  type Container,
  type EventLogStore,
  type JobRunner,
  type Result,
  type ToolModule,
} from '@taalcut/core';
import { createAssetRepository } from '@taalcut/library';
import { probeMedia, runFfmpeg, type MediaContext } from '@taalcut/media';
import {
  CLOUD_CRITIQUE_KBPS,
  CLOUD_CRITIQUE_MODULE,
  CLOUD_CRITIQUE_TOOL,
  createCloudCritiqueTool,
  type CritiqueAudio,
  type CritiqueConsent,
  type CritiqueFacts,
  type CritiqueSource,
  type PreparedCritiqueAudio,
} from '@taalcut/models';
import { renderAssetFiles } from '../../shared/render-ports';
import {
  LibraryDatabaseToken,
  LibraryPortsToken,
  ModelClientToken,
  ModelProfilesToken,
  ModelRuntimeToken,
  UtilityConfigToken,
} from '../../shared/tokens';
import { LocalOnlyFlagToken } from './agent-local-only-flag';
import { mediaBinaries } from './media-jobs';

const MS = FrameRate.of(1000, 1);
const at = (seconds: number) => RationalTime.fromSeconds(seconds, MS);
const ARTIFACT_EXTENSIONS: Readonly<Record<string, string>> = {
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/flac': 'flac',
  'audio/mpeg': 'mp3',
  'audio/ogg': 'ogg',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
};

/** A granted consent approval for this call in its run's log, or the app's consent error. */
export function runLogConsent(events: () => EventLogStore | undefined): CritiqueConsent {
  return {
    async check({ callId, runId }) {
      const refused = (detail: string) => err(CloudCritiqueConsentRequired(undefined, { detail }));
      const store = events();
      if (!runId || !store) return refused('outside an agent run there is no consent card');
      const read = await fromCoreEventLog(store).read(runId);
      if (!read.ok) return read;
      const asked = new Set<string>();
      for (const event of read.value) {
        if (event.type === 'approval.requested') {
          const { kind, toolCallIds, localOnly, reference, missingFiles, standingConsentIds } = event.payload;
          if (kind !== 'consent' || !toolCallIds.includes(callId)) continue;
          // Only the card's "Allow" consents: Local only answers at once without asking, and no standing consent
          // (vision's for frames, EAR1-I5, nor `vision.audio`, EAR1-R3) answers for a tool that asks every time.
          if (localOnly === true || reference === true || missingFiles || standingConsentIds) continue;
          asked.add(event.payload.requestId);
        } else if (event.type === 'approval.granted' && asked.has(event.payload.requestId)) {
          return ok(undefined);
        }
      }
      return refused('no granted consent for this call');
    },
  };
}

/** A sound's name on the consent card is cut here: a long label would bury the warning. */
const CARD_NAME_MAX = 80;

/**
 * One line for the card, never a path: a word that is a path (it starts with a separator or has two) shows as its
 * file name, and any other slash as "∕", so the card's file-name rule keeps a name like "Before/After" whole.
 */
export function cardName(text: string): string {
  const words = text.split(/\s+/).filter((word) => word !== '');
  const line = words
    .map((word) => (/^(~|[A-Za-z]:)?[\\/]|[\\/].*[\\/]/.test(word) ? fileNameOf(word) : word))
    .join(' ')
    .replace(/[\\/]/g, '\u2215');
  const chars = [...line];
  return chars.length > CARD_NAME_MAX ? `${chars.slice(0, CARD_NAME_MAX - 1).join('')}…` : line;
}

/** An artifact's label: the first sentence of its summary (a tool's own words about it). */
async function artifactLabel(container: Container, id: string): Promise<string | undefined> {
  const parsed = parseId<'Artifact'>(id);
  if (!parsed.ok || !container.has(LibraryPortsToken)) return undefined;
  const stored = await container.resolve(LibraryPortsToken).artifacts.get(parsed.value);
  return stored.ok ? stored.value.ref.summary.split(/(?<=[.!?])\s/)[0] : undefined;
}

async function sourceName(container: Container, input: Readonly<Record<string, unknown>>) {
  const { assetId, artifactId, templateId } = input;
  if (typeof assetId === 'string') {
    const id = parseId<'Asset'>(assetId);
    if (!id.ok || !container.has(LibraryDatabaseToken)) return undefined;
    const asset = createAssetRepository(container.resolve(LibraryDatabaseToken)).get(id.value);
    return asset.ok ? fileNameOf(asset.value.originalFilename) : undefined;
  }
  if (typeof artifactId === 'string') return artifactLabel(container, artifactId);
  if (typeof templateId === 'string') {
    const id = parseId<'Template'>(templateId);
    if (!id.ok || !container.has(TemplateStoreToken)) return undefined;
    const template = await container.resolve(TemplateStoreToken).get(id.value);
    return template.ok ? template.value.summary.name : undefined;
  }
  return undefined;
}

/**
 * EAR1-R3: the agent's `uploadNames` for `audio.cloudCritique`, whose call names its sound by id: the library
 * asset's file name, the artifact's label, or the template's name for its reel, so the consent card says which sound
 * goes. Nothing for other tools, or for a source that isn't found (the card says "this sound", and the tool fails on
 * its own before anything leaves).
 */
export function critiqueUploadNames(container: Container) {
  return async ({ tool, input }: { readonly tool: string; readonly input: unknown }): Promise<string[]> => {
    if (tool !== CLOUD_CRITIQUE_TOOL || !input || typeof input !== 'object') return [];
    const name = await sourceName(container, input as Readonly<Record<string, unknown>>).catch(
      () => undefined,
    );
    const shown = name ? cardName(name) : '';
    return shown ? [shown] : [];
  };
}

/** The source on disk: a library original, or an artifact copied into the call's scratch folder. */
interface Located {
  readonly path: string;
  readonly name: string;
}

async function locate(
  container: Container,
  source: CritiqueSource,
  artifacts: ArtifactStore,
  scratch: string,
): AsyncResult<Located> {
  if (source.assetId) {
    const original = await renderAssetFiles(container).original(source.assetId);
    if (!original.ok) return original;
    if (!original.value)
      return err(
        NotFoundError({ entity: 'asset', id: source.assetId }, { detail: 'the original is offline' }),
      );
    const path = original.value.path;
    return ok({ path, name: fileNameOf(path) });
  }
  if (!source.artifactId) return err(ListenBadInput(undefined, { detail: 'give assetId or artifactId' }));
  const stored = await artifacts.get(source.artifactId);
  if (!stored.ok) return stored;
  const extension = ARTIFACT_EXTENSIONS[stored.value.ref.mediaType.split(';')[0]?.trim() ?? ''];
  if (!extension)
    return err(ListenBadInput(undefined, { detail: `artifact is ${stored.value.ref.mediaType}, not sound` }));
  const path = join(scratch, `artifact.${extension}`);
  await writeFile(path, stored.value.data);
  return ok({ path, name: `artifact ${source.artifactId}` });
}

/** What this Mac hears over the window; the listening summary falls back to the measurements alone. */
async function facts(
  jobs: Pick<JobRunner, 'run'>,
  path: string,
  window: { readonly startS: number; readonly endS: number },
  timeline: boolean,
  signal: AbortSignal,
): AsyncResult<CritiqueFacts> {
  const range = TimeRange.of(at(window.startS), at(window.endS - window.startS));
  const analyse = (more: boolean) =>
    runListenAnalyse(
      jobs,
      {
        path,
        range,
        want: { measures: true, ...(more ? { events: true, sections: true, tempo: true, key: true } : {}) },
        install: false,
        optionalModels: true,
      },
      { signal },
    );
  if (timeline) {
    const heard = await analyse(true);
    if (heard.ok) {
      const notes = heard.value.model ? [] : ['no sections: the listening models are not downloaded yet'];
      return ok({
        measures: heard.value.measures,
        timeline: { events: heard.value.events, sections: heard.value.sections },
        notes,
      });
    }
  }
  const measured = await analyse(false);
  if (!measured.ok) return measured;
  return ok({ measures: measured.value.measures, notes: [] });
}

interface PrepareRequest {
  readonly source: CritiqueSource;
  readonly range?: TimeRange;
  readonly maxSeconds: number;
  readonly artifacts: ArtifactStore;
  readonly signal: AbortSignal;
}

/** Locates, probes and encodes the window into `scratch`; the caller removes the folder on any failure. */
async function encodeWindow(
  container: Container,
  jobs: Pick<JobRunner, 'run'>,
  ffmpeg: MediaContext,
  scratch: string,
  request: PrepareRequest,
): AsyncResult<PreparedCritiqueAudio> {
  const { range, maxSeconds, signal } = request;
  await mkdir(scratch, { recursive: true });
  const located = await locate(container, request.source, request.artifacts, scratch);
  if (!located.ok) return located;
  const path = located.value.path;
  const probed = await probeMedia(path, ffmpeg, { signal });
  if (!probed.ok) return probed;
  if (!probed.value.audio) return err(ListenBadInput(undefined, { detail: 'the source has no sound' }));
  // media's probe keeps OTIO's single-number rate (microseconds), not core's { num, den }.
  const probedLength = probed.value.duration;
  const fileSeconds = probedLength && probedLength.rate > 0 ? probedLength.value / probedLength.rate : 0;
  const startS = range ? RationalTime.toSeconds(range.start) : 0;
  const asked = Math.min(fileSeconds, range ? startS + RationalTime.toSeconds(range.duration) : fileSeconds);
  const endS = Math.min(asked, startS + maxSeconds);
  if (!(endS > startS))
    return err(ListenBadInput(undefined, { detail: `empty window ${startS}-${endS} s of ${fileSeconds} s` }));
  const out = join(scratch, 'critique.aac');
  // Audio only, mono, small: the window and nothing else leaves (`-vn`: never the picture).
  const encoded = await runFfmpeg(
    ffmpeg,
    [
      ...['-ss', startS.toFixed(3), '-i', path, '-t', (endS - startS).toFixed(3)],
      ...['-vn', '-ac', '1', '-ar', '44100', '-c:a', 'aac', '-b:a', `${CLOUD_CRITIQUE_KBPS}k`, '-f', 'adts'],
      out,
    ],
    { holdsVideoSession: false, signal },
  );
  if (!encoded.ok) return encoded;
  return ok({
    name: located.value.name,
    bytes: new Uint8Array(await readFile(out)),
    mimeType: 'audio/aac',
    window: { startS, endS, fileSeconds, codec: `aac mono ${CLOUD_CRITIQUE_KBPS} kbps` },
    trimmed: asked - startS > maxSeconds,
    facts: (options) => facts(jobs, path, { startS, endS }, options.timeline, options.signal),
    done: () => rm(scratch, { recursive: true, force: true }),
  });
}

function critiqueAudio(
  container: Container,
  jobs: Pick<JobRunner, 'run'>,
  scratchRoot: string,
): CritiqueAudio {
  const config = container.resolve(UtilityConfigToken);
  return {
    async prepare(source, options) {
      const binaries = await mediaBinaries(config).resolve();
      if (!binaries.ok) return binaries;
      const scratch = join(scratchRoot, `critique-${randomUUID()}`);
      const failed = async <T>(result: Result<T>): Promise<Result<T>> => {
        await rm(scratch, { recursive: true, force: true });
        return result;
      };
      try {
        const prepared = await encodeWindow(container, jobs, { binaries: binaries.value }, scratch, {
          source,
          ...options,
        });
        return prepared.ok ? prepared : failed(prepared);
      } catch (cause) {
        return failed(
          err(
            ListenBadInput(undefined, {
              detail: `could not prepare the sound: ${String(cause)}`.slice(0, 300),
            }),
          ),
        );
      }
    },
  };
}

export function listenCloudToolModules(container: Container): ToolModule[] {
  for (const token of [
    ModelClientToken,
    ModelProfilesToken,
    ModelRuntimeToken,
    JobRunnerToken,
    UtilityConfigToken,
  ])
    if (!container.has(token)) return [];
  const profiles = container.resolve(ModelProfilesToken);
  const tool = createCloudCritiqueTool({
    models: container.resolve(ModelClientToken),
    chain: () => profiles.effective(CLOUD_CRITIQUE_MODULE).chain,
    runtime: container.resolve(ModelRuntimeToken),
    // Refuses until the setting is read (agent-flows.ts): nothing leaves before Local only is known.
    localOnly: () => !container.has(LocalOnlyFlagToken) || container.resolve(LocalOnlyFlagToken).get(),
    consent: runLogConsent(() =>
      container.has(EventLogStoreToken) ? container.resolve(EventLogStoreToken) : undefined,
    ),
    audio: critiqueAudio(
      container,
      container.resolve(JobRunnerToken),
      join(container.resolve(UtilityConfigToken).userData, 'scratch', 'listen'),
    ),
  });
  return [defineToolModule({ id: 'audio', tools: [tool] })];
}
