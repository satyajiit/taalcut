// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { readFile, rm } from 'node:fs/promises';
import {
  callRpc,
  defineSetting,
  err,
  GeneratedAssetSinkToken,
  idSchema,
  NotImplementedError,
  ok,
  RationalTime,
  SettingsStoreToken,
  toTaalcutError,
  ValidationError,
  type Container,
} from '@taalcut/core';
import { assetDuration, createAssetRepository } from '@taalcut/library';
import type { TimelineCommandDeps } from '@taalcut/timeline';
import { AgentMainServicesToken, LibraryDatabaseToken } from '../../shared/tokens';

/** Capture keys remain mapped to their saved asset across undo, redo and restarts. Paths never reach the renderer. */
export function narrationAssets(container: Container): NonNullable<TimelineCommandDeps['narration']> {
  return async (input, projectId) => {
    try {
      const db = container.resolve(LibraryDatabaseToken);
      let assetId = input.assetId;
      if (input.captureKey) {
        const settings = container.resolve(SettingsStoreToken);
        const setting = defineSetting(
          `narration.${projectId}.${input.captureKey}`,
          idSchema<'Asset'>().nullable(),
          null,
        );
        const known = await settings.get(setting);
        if (!known.ok) return known;
        if (known.value) assetId = known.value;
        else {
          const sink = container.resolve(GeneratedAssetSinkToken);
          if (!sink.putRecording) return err(NotImplementedError({ feature: 'recordings.save' }));
          const main = container.resolve(AgentMainServicesToken);
          const capture = await callRpc(
            main().voiceCaptureFiles.claim({ captureKey: input.captureKey, projectId }),
          );
          if (!capture.ok) return capture;
          const bytes = await readFile(capture.value.path);
          // Main writes a fixed PCM WAV header: 48 kHz, mono, 16-bit. Refuse malformed or empty files.
          if (
            bytes.length <= 44 ||
            bytes.toString('ascii', 0, 4) !== 'RIFF' ||
            bytes.readUInt32LE(24) !== 48_000 ||
            bytes.readUInt16LE(22) !== 1 ||
            bytes.readUInt16LE(34) !== 16
          )
            return err(ValidationError({ field: 'recording' }));
          const saved = await sink.putRecording({
            bytes,
            mediaType: 'audio/wav',
            fileName: `narration-${input.captureKey}.wav`,
            projectId,
            provenance: { kind: 'captured' },
            duration: RationalTime.of(Math.floor((bytes.length - 44) / 2), { num: 48_000, den: 1 }),
          });
          if (!saved.ok) return saved;
          const remembered = await settings.set(setting, saved.value.assetId);
          if (!remembered.ok) return remembered;
          assetId = saved.value.assetId;
          await rm(capture.value.path, { force: true });
        }
      }
      if (!assetId) return err(ValidationError({ field: 'assetId' }));
      const asset = createAssetRepository(db).get(assetId);
      if (!asset.ok) return asset;
      const duration = assetDuration(asset.value);
      if (asset.value.kind !== 'audio' || !duration || duration.value <= 0)
        return err(
          ValidationError({ field: 'assetId' }, { detail: 'Choose a saved audio take with known duration' }),
        );
      return ok({ assetId, duration });
    } catch (cause) {
      return err(toTaalcutError(cause));
    }
  };
}
