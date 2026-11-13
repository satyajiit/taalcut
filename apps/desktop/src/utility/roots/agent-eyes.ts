// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * AGT2 eyes in the agent process: what render's eyes tools read (video.compare, library.frameAt, library.subjects,
 * and timeline.captureFrame's pictures). Timelines with their saved versions, the template store and its kept reels,
 * the library's renders and originals, FRM1's subject source, and the app's FFmpeg, all read when a call asks.
 *
 * Pictures: the person's frames go to the agent's model as pictures under HFW1-DSN's rule for the make's frame checks
 * (agent-designer.ts, `designerSeesPictures`), read for every call: on this Mac, or under the person's standing upload
 * consent for the agent's module that covers every cloud provider its chain may call now. Nobody is asked mid-make.
 * The vision judge runs on the chat's model when it sees images, under the same rule (compare runs it only then).
 */
import { join } from 'node:path';
import {
  err,
  NotFoundError,
  NotImplementedError,
  ok,
  RenderStoreToken,
  SubjectSourceToken,
  TemplateMediaStoreToken,
  TemplateStoreToken,
  type Container,
  type SubjectSource,
} from '@taalcut/core';
import { slotVisionJudge, type EyesDeps, type FootagePictures } from '@taalcut/render';
import { storeTemplateReader } from '@taalcut/timeline';
import { renderAssetFiles, renderTimelines } from '../../shared/render-ports';
import { UtilityConfigToken } from '../../shared/tokens';
import { agentCloudProviders, designerSeesPictures } from './agent-designer';
import { LocalOnlyFlagToken } from './agent-local-only-flag';
import { ConsentStoreToken } from './agent-consent-token';
import { chatModelSeeing, judgeModelOf } from './agent-template-designing';
import { mediaBinaries } from './media-jobs';

const ON_MAC = 'On this Mac: the agent’s model runs here.';
const CONSENTED = 'Under the person’s standing upload consent for the agent’s cloud models.';
const KEPT =
  'No standing upload consent covers the agent’s cloud models (“Always allow” on an upload card grants one), so the ' +
  'person’s frames stay on this Mac; read the words.';

/** The pictures rule for the person's frames, read for every call. */
export function footagePicturesOf(container: Container): FootagePictures {
  return async () => {
    const localOnly = container.has(LocalOnlyFlagToken) && container.resolve(LocalOnlyFlagToken).get();
    const cloudProviders = agentCloudProviders(container);
    const shown = await designerSeesPictures({
      frames: 'footage',
      // Whether the model sees images at all is the agent's to say (tool-images.ts): this rule is consent's.
      sees: true,
      localOnly,
      cloudProviders,
      consent: async () =>
        container.has(ConsentStoreToken) ? container.resolve(ConsentStoreToken).get('agent') : undefined,
    });
    if (localOnly || cloudProviders.length === 0) return { shown: true, why: ON_MAC };
    return shown ? { shown, why: CONSENTED } : { shown, why: KEPT };
  };
}

/** FRM1's subject source, read when a call asks (render's root registers it). */
function lazySubjects(container: Container): SubjectSource {
  return {
    over: (clip, signal) =>
      container.has(SubjectSourceToken)
        ? container.resolve(SubjectSourceToken).over(clip, signal)
        : Promise.resolve(ok(undefined)),
    ensure: (ranges, signal) =>
      container.has(SubjectSourceToken)
        ? container.resolve(SubjectSourceToken).ensure(ranges, signal)
        : Promise.resolve(err(NotFoundError({ entity: 'subjectSource' }))),
  };
}

/** Render's eyes deps in the agent process. */
export function eyesDepsOf(container: Container): EyesDeps {
  const config = container.has(UtilityConfigToken) ? container.resolve(UtilityConfigToken) : undefined;
  const judge = slotVisionJudge(judgeModelOf(container));
  return {
    // Read per call: the library module composes these before render registers its ports (agent-loop.ts).
    timelines: {
      get: (timelineId) => renderTimelines(container).get(timelineId),
      atRevision: (timelineId, revision) => {
        const timelines = renderTimelines(container);
        return timelines.atRevision
          ? timelines.atRevision(timelineId, revision)
          : Promise.resolve(err(NotFoundError({ entity: 'timelineVersion', id: `${timelineId}@${revision}` })));
      },
    },
    templates: {
      read: (ref) =>
        container.has(TemplateStoreToken)
          ? storeTemplateReader(container.resolve(TemplateStoreToken)).read(ref)
          : Promise.resolve(err(NotFoundError({ entity: 'template', id: ref.id }))),
    },
    renders: {
      list: (filter) => container.resolve(RenderStoreToken).list(filter),
      get: (id) => container.resolve(RenderStoreToken).get(id),
    },
    reel: async (templateId) => {
      if (!container.has(TemplateMediaStoreToken)) return null;
      const kept = await container.resolve(TemplateMediaStoreToken).get(templateId);
      return kept.ok && kept.value ? kept.value.path : null;
    },
    media: async () => {
      if (!config) return null;
      const binaries = await mediaBinaries(config).resolve();
      return binaries.ok ? { binaries: binaries.value } : null;
    },
    scratch: join(config?.userData ?? '', 'scratch', 'eyes'),
    assets: renderAssetFiles(container),
    subjects: lazySubjects(container),
    pictures: footagePicturesOf(container),
    // Only the chat's model when it sees images: the person's frames go nowhere else (judgeModelOf would fall back
    // to the vision chain, which their consent for the agent's module doesn't cover).
    judge: async (input, signal) =>
      chatModelSeeing(container)
        ? judge(input, signal)
        : err(
            NotImplementedError(
              { feature: 'vision judge' },
              { detail: 'The chat’s model does not see images' },
            ),
          ),
  };
}
