// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Build time only (EAR1-D1 step 3): the SFX bank's CLAP audio embeddings, made by this package's own runner
 * (EAR1-F4's `createListenRuntime` / `embedPcm`), so the bank's vectors and a `sfx.searchSounds` query's come from
 * the same code and graph. tools/audio-packs/sfx-bank/embed-bank.mjs writes the job and runs this file with tsx;
 * nothing in the app imports it.
 *
 *   tsx bank-embed-cli.ts --job <job.json> --models <dir> --out <dir>
 *
 * The job lists the catalogue's items in order, each with its first take's raw PCM (render_bank.py's .s16 / .s24)
 * and format. Row i of `embeddings-<dtype>.f32` is item i's unit embedding as `vocab.embed_file` makes it (up to 6
 * evenly spaced 10 s windows, averaged); `embeddings.json` names the rows. Every dtype runs on ONNX Runtime's CPU
 * provider: deterministic, so two builds write the same bytes (a GPU's reduction order may change between runs).
 */
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { createListenRuntime, embedPcm } from '../listen/models/embed';
import { directoryListenFiles } from '../listen/models/files';
import {
  SFX_BANK_EMBEDDING_DIMS,
  SFX_BANK_EMBEDDING_DTYPES,
  type SfxBankEmbeddingDtype,
} from './bank-catalogue';

interface EmbedJob {
  readonly items: readonly {
    readonly id: string;
    readonly raw: string;
    readonly bits: 16 | 24;
    readonly channels: 1 | 2;
  }[];
}

/** Raw PCM as the models hear it: mono at ffmpeg `-ac 1`'s level, (L + R) / √2 for a stereo take. */
export function modelMono(bytes: Buffer, bits: 16 | 24, channels: 1 | 2): Float32Array {
  const width = bits / 8;
  const frames = bytes.length / width / channels;
  const full = 2 ** (bits - 1);
  const read = (i: number) => (bits === 16 ? bytes.readInt16LE(i * 2) : bytes.readIntLE(i * 3, 3)) / full;
  const out = new Float32Array(frames);
  for (let f = 0; f < frames; f++)
    out[f] = channels === 1 ? read(f) : (read(f * 2) + read(f * 2 + 1)) / Math.SQRT2;
  return out;
}

async function embedAll(
  job: EmbedJob,
  models: string,
  dtype: SfxBankEmbeddingDtype,
  log: (l: string) => void,
) {
  const runtime = createListenRuntime({
    files: directoryListenFiles(models, dtype),
    plan: async () => ({ devices: ['cpu'] }),
    onFallback: (event) => log(`compute.fallback ${event.operation}: ${event.reason} (deterministic build)`),
  });
  try {
    const rows = new Float32Array(job.items.length * SFX_BANK_EMBEDDING_DIMS);
    for (const [i, item] of job.items.entries()) {
      const made = await embedPcm(
        runtime.clap,
        modelMono(await readFile(item.raw), item.bits, item.channels),
        48_000,
      );
      if (!made.ok) throw new Error(`${item.id}: ${made.error.code} ${made.error.detail ?? ''}`);
      rows.set(made.value.pooled, i * SFX_BANK_EMBEDDING_DIMS);
    }
    return rows;
  } finally {
    await runtime.release();
  }
}

/** Returns the process exit code. */
export async function main(
  argv: readonly string[],
  log: (line: string) => void = console.warn,
): Promise<number> {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      job: { type: 'string' },
      models: { type: 'string' },
      out: { type: 'string' },
      dtype: { type: 'string', default: SFX_BANK_EMBEDDING_DTYPES.join(',') },
    },
  });
  if (!values.job || !values.models || !values.out) {
    log('usage: tsx bank-embed-cli.ts --job <job.json> --models <dir> --out <dir> [--dtype int8,fp16]');
    return 2;
  }
  const job = JSON.parse(await readFile(values.job, 'utf8')) as EmbedJob;
  const sets = [];
  for (const dtype of values.dtype.split(',') as SfxBankEmbeddingDtype[]) {
    if (!SFX_BANK_EMBEDDING_DTYPES.includes(dtype)) {
      log(`unknown dtype ${dtype}`);
      return 2;
    }
    const rows = await embedAll(job, values.models, dtype, log);
    const file = `embeddings-${dtype}.f32`;
    await writeFile(join(values.out, file), Buffer.from(rows.buffer, rows.byteOffset, rows.byteLength));
    sets.push({
      model: 'clap-general-audio',
      dtype,
      file,
      dims: SFX_BANK_EMBEDDING_DIMS,
      ids: job.items.map((item) => item.id),
    });
    log(`${file}: ${job.items.length} rows`);
  }
  await writeFile(join(values.out, 'embeddings.json'), `${JSON.stringify(sets, null, 1)}\n`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  process.exitCode = await main(process.argv.slice(2));
