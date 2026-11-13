// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1's listening tools, as the desktop's agent process joins them to its `audio` and `sfx` modules after the tools
 * those already have (apps/desktop agent-audio.ts `withAudioTools`): `audio.listen`, `audio.compare` and
 * `audio.critique` (agent-listen-qa.ts), `audio.findMoment` (agent-listen-search.ts), `audio.cloudCritique`
 * (agent-listen-cloud.ts), and `sfx.searchSounds` after `sfx.synthesizeProcedural`. Tool search ranks over the whole
 * catalogue, so the demo offers them too (src/catalogue.ts checks both sides). The demo never runs them: the jobs
 * process that listens isn't here, and every service behind them answers core.not_implemented.
 */
import { join } from 'node:path';
import {
  critiqueTool,
  listenSearchTools,
  listenTools,
  searchSoundsTool,
  type ListenQaToolDeps,
} from '@taalcut/audio';
import { err, NotImplementedError, type AnyTool, type JobRunner } from '@taalcut/core';
import { createCloudCritiqueTool } from '@taalcut/models';

const notServed = (feature: string) => async () => err(NotImplementedError({ feature }));

/** `audio`'s listening tools, in the desktop's order. */
export function listenAudioTools(deps: {
  readonly jobs: Pick<JobRunner, 'run'>;
  /** The demo's own data folder: the listening's scratch copies would be under it. */
  readonly appData: string;
}): AnyTool[] {
  const listen: ListenQaToolDeps = {
    jobs: deps.jobs,
    assets: { original: notServed('listen.assets') },
    scratch: join(deps.appData, 'scratch', 'listen'),
    templateListening: notServed('listen.templateListening'),
    templateReel: notServed('listen.templateReel'),
  };
  return [
    ...listenTools(listen),
    critiqueTool(listen),
    ...listenSearchTools(listen),
    createCloudCritiqueTool({
      models: {
        stream: () => {
          throw new Error('the gate demo serves no cloud critique');
        },
        complete: notServed('audio.cloudCritique'),
      },
      chain: () => [],
      runtime: { findModel: () => undefined },
      // The demo is local: a call would be refused before anything is prepared.
      localOnly: () => true,
      consent: { check: notServed('audio.cloudCritique.consent') },
      audio: { prepare: notServed('audio.cloudCritique.audio') },
    }),
  ];
}

/** `sfx.searchSounds`, over no bank, pack or library. */
export function listenSfxTools(): AnyTool[] {
  return [searchSoundsTool({ searcher: { search: notServed('sfx.searchSounds') }, bankDir: () => null })];
}
