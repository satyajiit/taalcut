// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * On-screen-text recall on footage with known burnt-in lines. A study tool since IX3 (IX3-B2): round IX's gate
 * (IX-O2..O4), it scores what `ocr-profile.ts` read, and that script reads frames on its own path, not the frames the
 * app's shots pass keeps for `vision.ocr`, so its words are not the shipped pipeline's and nothing gates on it. The
 * gate is tools/evals `eval:text-recall` (IX3-B1), which scores what the app stored in a bench library.
 *
 *   pnpm --filter @taalcut/vision exec tsx scripts/ocr-recall.ts --manifest <footage manifest.json>
 *     --run <ocr-profile output dir> [--baseline <ocr-profile output dir>] [--slack 0.5]
 *
 * For every line the bench footage manifest says is on screen (`clips[].onScreen[]`: line, from, to in
 * seconds), the words of the line found among the stored texts whose range overlaps the line's time
 * (± slack), case-insensitive. Also counts the texts that overlap no known line (what OCR read out of
 * textures and clocks). With `--baseline`, the gate: every word the baseline found is still found, a clip
 * missing from the run counting as lost (ocr-recall-gate.ts). Exits 1 when the gate fails.
 */
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { z } from 'zod';
import { lostWords, type LineResult } from './ocr-recall-gate';

const { values } = parseArgs({
  options: {
    manifest: { type: 'string' },
    run: { type: 'string' },
    baseline: { type: 'string' },
    slack: { type: 'string', default: '0.5' },
  },
});

const manifestSchema = z.object({
  clips: z.array(
    z.object({
      file: z.string(),
      onScreen: z.array(z.object({ line: z.string(), from: z.number(), to: z.number() })),
    }),
  ),
});

const profileSchema = z.object({
  rate: z.object({ num: z.number().positive(), den: z.number().positive() }),
  shots: z.array(
    z.object({
      texts: z.array(z.object({ text: z.string(), start: z.number(), frames: z.number() })),
    }),
  ),
});

interface Text {
  readonly text: string;
  readonly from: number;
  readonly to: number;
}

const words = (text: string) =>
  text
    .toUpperCase()
    .split(/[^\p{L}\p{N}%]+/u)
    .filter(Boolean);

async function textsOf(dir: string, file: string): Promise<Text[] | undefined> {
  let raw: string;
  try {
    raw = await readFile(join(dir, `${file}.json`), 'utf8');
  } catch {
    return undefined;
  }
  const profile = profileSchema.parse(JSON.parse(raw));
  const fps = profile.rate.num / profile.rate.den;
  return profile.shots.flatMap((shot) =>
    shot.texts.map((t) => ({ text: t.text, from: t.start / fps, to: (t.start + t.frames) / fps })),
  );
}

async function recall(
  dir: string,
  manifest: z.infer<typeof manifestSchema>,
  slack: number,
): Promise<{ lines: LineResult[]; other: number; clips: number }> {
  const lines: LineResult[] = [];
  let other = 0;
  let clips = 0;
  for (const clip of manifest.clips) {
    const texts = await textsOf(dir, clip.file);
    if (!texts) continue;
    clips++;
    const overlaps = (t: Text, from: number, to: number) => t.from < to + slack && t.to > from - slack;
    other += texts.filter((t) => !clip.onScreen.some((l) => overlaps(t, l.from, l.to))).length;
    for (const known of clip.onScreen) {
      const near = texts.filter((t) => overlaps(t, known.from, known.to));
      const seen = new Set(near.flatMap((t) => words(t.text)));
      const want = words(known.line);
      lines.push({
        file: clip.file,
        line: known.line,
        words: want,
        found: want.filter((w) => seen.has(w)),
        read: near.map((t) => t.text),
      });
    }
  }
  return { lines, other, clips };
}

async function main(): Promise<number> {
  if (!values.manifest || !values.run) {
    console.error(
      'usage: ocr-recall --manifest <manifest.json> --run <dir> [--baseline <dir>] [--slack 0.5]',
    );
    return 2;
  }
  const manifest = manifestSchema.parse(JSON.parse(await readFile(values.manifest, 'utf8')));
  const slack = Number(values.slack);
  const run = await recall(values.run, manifest, slack);
  const base = values.baseline ? await recall(values.baseline, manifest, slack) : undefined;
  process.stdout.write('| File | Line | Words found | Read near it |\n| --- | --- | --- | --- |\n');
  let found = 0;
  let total = 0;
  for (const line of run.lines) {
    found += line.found.length;
    total += line.words.length;
    const read = line.read.map((t) => t.replaceAll('|', '/')).join(' · ');
    process.stdout.write(
      `| ${line.file} | ${line.line} | ${line.found.length}/${line.words.length} | ${read} |\n`,
    );
  }
  process.stdout.write(
    `\nword recall ${found}/${total} over ${run.lines.length} lines in ${run.clips} clips; ` +
      `texts overlapping no known line: ${run.other}${base ? ` (baseline ${base.other})` : ''}\n`,
  );
  if (!base) return 0;
  const lost = lostWords(run.lines, base.lines);
  if (lost.length === 0) {
    process.stdout.write('gate: pass (every word the baseline read is still read)\n');
    return 0;
  }
  process.stdout.write(`gate: FAIL, lost ${lost.length}: ${lost.join('; ')}\n`);
  return 1;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error(error);
    process.exit(1);
  },
);
