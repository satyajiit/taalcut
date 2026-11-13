// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The signing stage (P3-V7, SPEC P3.3): with Content Credentials on, the finished file is signed by the c2pa
 * sidecar (the export's manifest: actions, the AI inventory's digital source types, and every source that
 * carried its own credentials as an ingredient) and replaced by the signed copy, so QA checks the delivered
 * bytes. Off, nothing runs and nothing is added. The component missing stops the export
 * (`render.credentials_unavailable`, retryable); a manifest that doesn't validate is QA's to report.
 */
import { rename, rm } from 'node:fs/promises';
import { err, ok, type AsyncResult, type RenderCredentials } from '@taalcut/core';
import {
  exportManifest,
  hasC2paManifestBox,
  inventoryOf,
  type AiInventory,
  type C2paReadSummary,
} from '../../credentials';
import { CredentialsUnavailable } from '../../errors-phase3';
import type { QaFacts } from '../../qa/modules';
import { storedRequest } from '../../store/stored-request';
import type { ExportInputs } from '../export-inputs';
import type { StageContext } from './context';

export interface Signing {
  readonly add: boolean;
  readonly inventory: AiInventory;
  /** Signs `file` in place (a no-op when credentials are off). */
  sign(file: string): AsyncResult<void>;
  readonly qa: NonNullable<QaFacts['credentials']>;
}

/** One clip shown as shot: nothing drawn over it, no music, no speed change, no Style. */
function singleClipNoEdits(stage: StageContext, inputs: ExportInputs): boolean {
  const { plan } = inputs;
  const visuals = plan.visuals.filter((visual) => visual.enabled);
  return (
    visuals.length === 1 &&
    visuals[0]?.speed === null &&
    plan.texts.length === 0 &&
    !(stage.record.captions.burnIn && (plan.captions?.cues.length ?? 0) > 0) &&
    inputs.timeline.music.path === 'platformSound' &&
    inputs.styled.style === null
  );
}

/** Parts whose original carries its own manifest (an MP4 with a C2PA box): they travel as ingredients. */
async function signedSources(inputs: ExportInputs, inventory: AiInventory): Promise<Map<string, string>> {
  const signed = new Map<string, string>();
  for (const part of inventory.parts) {
    const path =
      inputs.sources.get(part.id)?.path ?? (part.assetId ? inputs.audioFiles.get(part.assetId) : undefined);
    if (path && (await hasC2paManifestBox(path).catch(() => false))) signed.set(part.id, path);
  }
  return signed;
}

async function record(stage: StageContext, credentials: RenderCredentials) {
  const saved = await stage.deps.store.update(stage.record.id, { credentials });
  // The file carries them either way; a store that can't record them yet only loses the row's badge.
  if (!saved.ok) stage.deps.log?.(`[render] credentials not recorded on the render: ${saved.error.code}`);
}

export async function planSigning(stage: StageContext, inputs: ExportInputs): AsyncResult<Signing> {
  const request = storedRequest(stage.record);
  if (!request.ok) return request;
  const add = request.value.contentCredentials.add;
  const inventory = await inventoryOf(inputs.timeline, stage.deps.provenance);
  const credentials = stage.deps.credentials;
  const inspect = async (path: string): Promise<C2paReadSummary | null> => {
    const read = credentials ? await credentials.inspect(path, stage.signal) : ok(null);
    return read.ok ? read.value : null;
  };
  const qa = { add, inventory, inspect };
  if (!add) return ok({ add, inventory, qa, sign: async () => ok(undefined) });
  if (!credentials) return err(CredentialsUnavailable({}, { detail: 'the c2pa sidecar is not available' }));
  const manifest = exportManifest({
    title: stage.record.name,
    generatorVersion: stage.deps.appVersion ?? 'development',
    inventory,
    singleClipNoEdits: singleClipNoEdits(stage, inputs),
    signedSources: await signedSources(inputs, inventory),
  });
  const sign = async (file: string): AsyncResult<void> => {
    stage.tracker.stage('signing');
    const output = `${file}.signed.mp4`;
    const signed = await credentials.sign(
      { input: file, output, manifest: manifest.definition, ingredients: manifest.ingredients },
      stage.signal,
    );
    if (!signed.ok) {
      await rm(output, { force: true });
      return signed;
    }
    await rename(output, file);
    await record(stage, { added: true, state: signed.value.state });
    return ok(undefined);
  };
  return ok({ add, inventory, qa, sign });
}
