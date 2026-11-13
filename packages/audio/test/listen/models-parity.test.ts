// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-F4 with the real models against upstream earshot (fp32 PyTorch) on every parity clip: CLAP window
 * embeddings (cosine ≥ 0.995 fp16, ≥ 0.98 int8), AST, the tokenizer (every string upstream tokenised) and the text
 * encoder. Runs with `TAALCUT_EAR1_MODELS=~/.cache/taalcut-ear1/models` (tools/components/listen/README.md);
 * skipped in CI, which has no models.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { blob, blobRows, intermediate, manifest } from '../../../../tools/earshot-parity/fixtures.mjs';
import { createAstTagger, sigmoid } from '../../src/listen/models/ast';
import { createClapAudio } from '../../src/listen/models/clap-audio';
import { createClapText } from '../../src/listen/models/clap-text';
import { directoryListenFiles } from '../../src/listen/models/files';
import { createListenSessions, type ListenSessions } from '../../src/listen/models/sessions';
import { cosine, modelMono, MODELS } from './models-helpers';

const WINDOW_COSINE = { fp16: 0.995, int8: 0.98 } as const;
/** Not a gate of the plan (D23 judges the text side by the end-to-end z): what each text dtype measured, with margin. */
const TEXT_COSINE = { fp16: 0.995, int8: 0.95 } as const;
/** AST is no gate either: int8 drifts more, and a near tie (rain's top labels) may swap. */
const AST_PROB = { fp16: 0.1, int8: 0.15 } as const;
const opened: ListenSessions[] = [];
afterAll(async () => {
  for (const sessions of opened) await sessions.release();
});

function sessionsFor(dtype: 'fp16' | 'int8'): ListenSessions {
  const sessions = createListenSessions({ files: directoryListenFiles(MODELS ?? '', dtype) });
  opened.push(sessions);
  return sessions;
}

describe.skipIf(!MODELS).each(['fp16', 'int8'] as const)('%s models against upstream', (dtype) => {
  it(`CLAP windows: cosine ≥ ${WINDOW_COSINE[dtype]} on every clip`, async () => {
    const clap = createClapAudio(sessionsFor(dtype));
    let worst = 1;
    let worstClip = '';
    let sum = 0;
    let count = 0;
    for (const clip of manifest().clips) {
      const embedded = await clap.embedSource(modelMono(clip.id));
      expect(embedded.ok, clip.id).toBe(true);
      if (!embedded.ok) continue;
      const theirs = blobRows(`clap-audio-windows/${clip.id}`);
      expect(embedded.value.windows.length, clip.id).toBe(theirs.length);
      embedded.value.windows.forEach((window, i) => {
        const c = cosine(window, theirs[i] ?? []);
        sum += c;
        count += 1;
        if (c < worst) [worst, worstClip] = [c, clip.id];
      });
      expect(cosine(embedded.value.pooled, blob(`clap-audio/${clip.id}`).data)).toBeGreaterThan(
        WINDOW_COSINE[dtype],
      );
    }
    console.warn(
      `CLAP ${dtype}: ${count} windows, min cosine ${worst.toFixed(5)} (${worstClip}), mean ${(sum / count).toFixed(5)}`,
    );
    expect(worst).toBeGreaterThanOrEqual(WINDOW_COSINE[dtype]);
  }, 600_000);

  it(`AST: the top label among upstream's top 3, probabilities within ${AST_PROB[dtype]}`, async () => {
    const ast = createAstTagger(sessionsFor(dtype));
    const fixture = intermediate<{ labels: string[]; clips: Record<string, unknown> }>('ast');
    const labels = await ast.labels();
    expect(labels.ok && labels.value).toEqual(fixture.labels);
    let worstProb = 0;
    let worstLogit = 0;
    for (const id of Object.keys(fixture.clips)) {
      const result = await ast.probs([modelMono(id)]);
      expect(result.ok, id).toBe(true);
      if (!result.ok) continue;
      const ours = result.value[0];
      const logits = blobRows(`ast-logits/${id}`);
      expect(ours?.logits.length, id).toBe(logits.length);
      ours?.logits.forEach((row, w) => {
        row.forEach(
          (v, c) => (worstLogit = Math.max(worstLogit, Math.abs(sigmoid(v) - sigmoid(logits[w]?.[c] ?? 0)))),
        );
      });
      const theirs = blob(`ast-probs/${id}`).data;
      const argmax = (p: ArrayLike<number>) =>
        Array.from(p).reduce((b, v, i, a) => (v > (a[b] ?? 0) ? i : b), 0);
      const top3 = Array.from(theirs.keys())
        .sort((x, y) => (theirs[y] ?? 0) - (theirs[x] ?? 0))
        .slice(0, 3);
      expect(top3, id).toContain(argmax(ours?.probs ?? []));
      ours?.probs.forEach((p, c) => (worstProb = Math.max(worstProb, Math.abs(p - (theirs[c] ?? 0)))));
    }
    console.warn(`AST ${dtype}: max |Δp| ${worstProb.toFixed(4)} (windows ${worstLogit.toFixed(4)})`);
    expect(worstProb).toBeLessThan(AST_PROB[dtype]);
  }, 300_000);

  it(`the text encoder: every vocabulary term through the templates, cosine ≥ ${TEXT_COSINE[dtype]}`, async () => {
    const text = createClapText(sessionsFor(dtype), 16);
    const fixture = intermediate<{ vocab: { terms: string[]; templates: string[] } }>('text');
    const embedded = await text.embedPhrases(fixture.vocab.terms, fixture.vocab.templates);
    expect(embedded.ok).toBe(true);
    if (!embedded.ok) return;
    const theirs = blobRows('clap-text/vocab');
    const worst = Math.min(...embedded.value.map((row, i) => cosine(row, theirs[i] ?? [])));
    console.warn(`CLAP text ${dtype}: 322 terms, min cosine ${worst.toFixed(5)}`);
    expect(worst).toBeGreaterThanOrEqual(TEXT_COSINE[dtype]);
  }, 300_000);
});

describe.skipIf(!MODELS)('the CLAP tokenizer', () => {
  it('gives the ids upstream gave for every string it tokenised', async () => {
    const text = createClapText(sessionsFor('int8'));
    const { ids } = intermediate<{ tokens: { ids: Record<string, number[]> } }>('text').tokens;
    let checked = 0;
    for (const [string, expected] of Object.entries(ids)) {
      const ours = await text.tokenize(string);
      expect(ours.ok && ours.value, string).toEqual(expected);
      checked += 1;
    }
    expect(checked).toBeGreaterThan(1600);
  });
});
