// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-G1: `sfx.addHits` fromTemplate in the agent process. A video names the template version it was made from;
 * that version's listening (EAR1-C1) keeps the effects the reel put on its cuts, and templates' reelSfxPayload puts
 * each on the same cut of the video as a take of the installed `sfx-bank` component (found as the bank sounds path
 * finds it), the take added to the library through the generated-file sink. When none can go on, the error says why.
 */
import {
  err,
  GeneratedAssetSinkToken,
  ok,
  TemplateStoreToken,
  type Container,
  type GeneratedAssetSink,
  type TemplateStore,
} from '@taalcut/core';
import { ReelSfxUnavailable, sfxBankSource, type SfxBankSource, type SfxToolDeps } from '@taalcut/audio';
import { reelHitRequests, reelSfxPayload } from '@taalcut/templates';
import { storeTemplateReader } from '@taalcut/timeline';
import type { UtilityConfig } from '../../shared/rpc-ipc';
import { installedComponentFile } from './audio-library';
import { SFX_BANK_COMPONENT } from './agent-audio-services';

type TemplateHits = NonNullable<SfxToolDeps['templateHits']>;

export interface ReelHitsDeps {
  readonly templates: Pick<TemplateStore, 'get'>;
  readonly bank: SfxBankSource;
  readonly sink: GeneratedAssetSink;
}

const unavailable = (reason: string, detail: string) => err(ReelSfxUnavailable({ reason }, { detail }));

/** The reel's effects on the timeline's cuts, from the template version the timeline follows. */
export function reelTemplateHits(deps: ReelHitsDeps): TemplateHits {
  const reader = storeTemplateReader(deps.templates);
  return async (timeline, signal) => {
    if (!timeline.template) return unavailable('no_template', 'the video was not made from a template');
    const template = await reader.read(timeline.template);
    if (!template.ok) return template;
    const listening = template.value.audio.listening;
    if (!listening?.sfxAtCuts.length)
      return unavailable(
        'no_effects',
        listening ? 'the reel had no effects on its cuts' : 'the template’s reel was not heard',
      );
    // Before the bank is read: a video whose shots were added or taken out has none of the reel's cuts.
    if (!reelHitRequests(template.value, timeline)?.length)
      return unavailable('cuts_changed', 'the video’s cuts are not the template’s');
    const bank = await deps.bank.load();
    if (!bank.ok) return bank;
    const payload = await reelSfxPayload(
      template.value,
      timeline,
      { bank: bank.value, sink: deps.sink },
      signal,
    );
    if (!payload.ok) return payload;
    // An empty payload would take the effects already there off: say so instead.
    if (!payload.value?.hits.length)
      return unavailable('other', 'the bank has no sound for the reel’s effects');
    return ok(payload.value);
  };
}

/** `templateHits` for `sfx.addHits`, over this process's template store, the installed bank and the library. */
export function templateHitsOf(
  container: Container,
  config: Pick<UtilityConfig, 'userData'>,
): Pick<SfxToolDeps, 'templateHits'> {
  const bank = sfxBankSource(() => installedComponentFile(config.userData, SFX_BANK_COMPONENT));
  return {
    // Resolved at each call: the template store may be registered after the audio tools are built.
    templateHits: (timeline, signal) => {
      if (!container.has(TemplateStoreToken) || !container.has(GeneratedAssetSinkToken))
        return Promise.resolve(unavailable('other', 'no template store or library in this process'));
      return reelTemplateHits({
        templates: container.resolve(TemplateStoreToken),
        bank,
        sink: container.resolve(GeneratedAssetSinkToken),
      })(timeline, signal);
    },
  };
}
