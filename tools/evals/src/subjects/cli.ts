// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * FRM1-SUB's subjects eval (README in labels.json's folder):
 * - `fixtures --out <dir>` rebuilds the frames;
 * - `predict --set <dir>` runs the mac helper on them and writes predictions.helper.json and predictions.faces.json;
 * - `eval --set <dir> --detector <helper|faces|onnx>` scores predictions.<detector>.json against labels.json.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSubjectSet } from './build';
import { predictWithHelper } from './helper';
import { scoreSubjects, type FramePrediction, type LabelledFrame } from './score';

const HERE = dirname(fileURLToPath(import.meta.url));

const arg = (name: string): string | undefined => {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
};
const need = (name: string): string => {
  const value = arg(name);
  if (!value) throw new Error(`needs --${name}`);
  return value;
};

export function loadLabels(): Record<string, LabelledFrame> {
  return (JSON.parse(readFileSync(join(HERE, 'labels.json'), 'utf8')) as { frames: Record<string, LabelledFrame> })
    .frames;
}

const pct = (value: number) => `${(value * 100).toFixed(1)}%`;

function evaluate(set: string, detector: string): void {
  const predictions = JSON.parse(readFileSync(join(set, `predictions.${detector}.json`), 'utf8')) as Record<
    string,
    FramePrediction
  >;
  const score = scoreSubjects(loadLabels(), predictions);
  console.log(`${detector}: ${score.frames} frames`);
  console.log(`  head recall ${pct(score.heads.recall)} (${score.heads.found}/${score.heads.total}), mean IoU ${score.heads.meanIou.toFixed(2)}`);
  console.log(`  false heads per frame ${score.falseHeadsPerFrame.toFixed(2)}`);
  console.log(`  face recall ${pct(score.faces.recall)} (${score.faces.found}/${score.faces.total})`);
  for (const [kind, entry] of Object.entries(score.byKind).sort())
    console.log(`  ${kind}: ${entry.found}/${entry.total}`);
  for (const miss of score.headMisses)
    console.log(`  head miss ${miss.frame}#${miss.head} ${miss.face} ${miss.tags.join(',')}`);
  if (arg('faces')) for (const miss of score.faceMisses) console.log(`  face miss ${miss.frame}#${miss.head} ${miss.face}`);
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (command === 'fixtures') {
    const built = await buildSubjectSet(need('out'));
    console.log(`${built.length} frames`);
  } else if (command === 'predict') {
    const result = await predictWithHelper(need('set'));
    console.log(`helper: ${Object.keys(result.helper).length} frames in ${result.ms} ms`);
  } else if (command === 'eval') {
    evaluate(need('set'), arg('detector') ?? 'helper');
  } else throw new Error(`unknown command ${command ?? ''}`);
}

main().catch((cause: unknown) => {
  console.error(cause);
  process.exitCode = 1;
});
