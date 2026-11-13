// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * listen-pick's predictions: each golden query searched over the built SFX bank (its shipped CLAP embeddings and
 * titles) with the real text model, exactly as `sfx.searchSounds` ranks (calibrated audio z plus the name), and the
 * audio alone for comparison. Needs the unpacked listen models (`TAALCUT_EAR1_MODELS`) and a built bank
 * (`TAALCUT_SFX_BANK`, default packages/audio/.cache/packs/sfx-bank); dtype `TAALCUT_LISTEN_DTYPE` (default fp16).
 * No network: the models and the bank are local files.
 */
import { join } from 'node:path';
import {
  createListenModels,
  createListenSessions,
  createSoundIndex,
  directoryListenFiles,
  embedNames,
  loadSfxBank,
  searchSoundIndex,
} from '@taalcut/audio';
import type { PickLabel, Picked, PickPrediction } from './schema';

const home = (path: string) => path.replace(/^~(?=\/)/, process.env.HOME ?? '~');

export function pickEnvironment() {
  const models = process.env.TAALCUT_EAR1_MODELS;
  if (!models) throw new Error('listen-pick needs TAALCUT_EAR1_MODELS: the unpacked listen model builds');
  const bank =
    process.env.TAALCUT_SFX_BANK ??
    join(import.meta.dirname, '../../../../packages/audio/.cache/packs/sfx-bank');
  const dtype = process.env.TAALCUT_LISTEN_DTYPE === 'int8' ? 'int8' : 'fp16';
  return { models: home(models), bank: home(bank), dtype } as const;
}

export async function predictPick(labels: readonly PickLabel[]): Promise<PickPrediction[]> {
  const env = pickEnvironment();
  const bank = await loadSfxBank(env.bank);
  if (!bank.ok) throw new Error(`${bank.error.code}: ${bank.error.detail ?? env.bank}`);
  const rows = await bank.value.embeddings(env.dtype);
  if (!rows.ok) throw new Error(`${rows.error.code}: ${rows.error.detail ?? ''}`);
  const files = directoryListenFiles(env.models, env.dtype);
  const sessions = createListenSessions({ files });
  try {
    const models = createListenModels(sessions, files);
    const items = bank.value.items;
    const names = await embedNames(
      models,
      items.map((item) => item.title),
    );
    if (!names.ok) throw new Error(names.error.code);
    const audio = items.map((item, i) => ({
      id: item.id,
      embedding: rows.value.rows.subarray(i * rows.value.dims, (i + 1) * rows.value.dims),
    }));
    const audioIndex = createSoundIndex(audio);
    const namedIndex = createSoundIndex(
      audio.map((entry, i) => ({ ...entry, name: names.value[i] as Float32Array })),
    );
    const picked = (id: string): Picked => {
      const item = bank.value.item(id);
      return { soundId: id, category: item?.category ?? '', upstreamId: item?.upstreamId ?? id };
    };
    const out: PickPrediction[] = [];
    for (const label of labels) {
      const named = await searchSoundIndex(models, namedIndex, label.query, { top: 5 });
      const plain = await searchSoundIndex(models, audioIndex, label.query, { top: 5 });
      if (!named.ok) throw new Error(named.error.code);
      if (!plain.ok) throw new Error(plain.error.code);
      out.push({
        caseId: label.caseId,
        top: named.value.hits.map((h) => picked(h.id)),
        audioTop: plain.value.hits.map((h) => picked(h.id)),
        dtype: env.dtype,
      });
    }
    return out;
  } finally {
    await sessions.release();
  }
}
