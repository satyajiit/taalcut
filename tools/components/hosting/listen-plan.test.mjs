// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-F3: the listening models' release plan (plan/listen.mjs) and their packer's helpers
 * (../listen/pack-listen-models.mjs). The packs themselves are checked by `pack-listen-models.mjs --twice`, which
 * needs the 860 MB of pinned graphs; this checks what each archive holds and where every byte comes from.
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { chosenIds, differences, LISTEN_IDS, locations, summarise } from '../listen/pack-listen-models.mjs';
import { LISTEN, LISTEN_TEXTS } from './plan/listen.mjs';
import { PENDING_PLAN } from './plan.mjs';
import { TEXTS } from './texts.mjs';

const manifest = JSON.parse(
  readFileSync(new URL('../manifest.listen.provisional.json', import.meta.url), 'utf8'),
);
const XENOVA = {
  clap: 'https://huggingface.co/Xenova/larger_clap_general/resolve/d78c3994912c441f0151a5cc44d86f6b7bf4c861/',
  ast: 'https://huggingface.co/Xenova/ast-finetuned-audioset-10-10-0.4593/resolve/249a1fbf0286b40e7f1ed687a8ae396997bf7dc6/',
};
/** What each archive holds, at its root (tools/components/listen/README.md, "Archive layout"). */
const LAYOUT = {
  'clap-general-audio': [
    'config.json',
    'listen-text-fp16.f16',
    'listen-text-fp16.json',
    'listen-text-int8.f16',
    'listen-text-int8.json',
    'model.onnx',
    'preprocessor_config.json',
  ],
  'clap-general-text': [
    'config.json',
    'merges.txt',
    'model.onnx',
    'special_tokens_map.json',
    'tokenizer.json',
    'tokenizer_config.json',
    'vocab.json',
  ],
  'ast-audioset': ['config.json', 'model.onnx', 'preprocessor_config.json'],
};
const GRAPHS = {
  'clap-general-audio': 'onnx/audio_model_quantized.onnx',
  'clap-general-audio-fp16': 'onnx/audio_model_fp16.onnx',
  'clap-general-text': 'onnx/text_model_quantized.onnx',
  'clap-general-text-fp16': 'onnx/text_model_fp16.onnx',
  'ast-audioset': 'onnx/model_quantized.onnx',
  'ast-audioset-fp16': 'onnx/model_fp16.onnx',
};
const baseOf = (id) => id.replace(/-fp16$/, '');

describe('the listening models’ release plan', () => {
  it('plans every listening model in the manifest, and is in the pending plan', () => {
    assert.deepEqual(
      manifest.components.map((c) => c.id),
      Object.keys(LISTEN),
    );
    for (const id of Object.keys(LISTEN)) assert.equal(PENDING_PLAN[id], LISTEN[id], id);
  });

  it('packs the pinned upstream files, unsigned, as one flat tar.zst with the graph as model.onnx', () => {
    for (const [id, plan] of Object.entries(LISTEN)) {
      assert.equal(plan.signature, 'none', id);
      assert.deepEqual(
        { kind: plan.recipe.kind, layout: plan.recipe.layout },
        { kind: 'pack', layout: 'file' },
      );
      assert.match(plan.file, new RegExp(`^${baseOf(id)}-(int8|fp16)-[0-9a-f]{8}\\.tar\\.zst$`));
      assert.equal(plan.file.includes('-fp16-'), id.endsWith('-fp16'), id);
      const paths = plan.recipe.files.map((f) => f.path).sort();
      assert.deepEqual(paths, LAYOUT[baseOf(id)], id);
      const repo = id.startsWith('clap-') ? XENOVA.clap : XENOVA.ast;
      for (const { path, pin, repo: made } of plan.recipe.files) {
        // EAR1-F5: the text-embedding banks are made in the repository, pinned to the committed bytes.
        if (made) {
          const bytes = readFileSync(new URL(`../../../${made}`, import.meta.url));
          assert.equal(createHash('sha256').update(bytes).digest('hex'), pin.sha256, made);
          assert.equal(bytes.length, pin.size, made);
          assert.ok(pin.url.startsWith('https://components.taalcut.app/listen-text/'), pin.url);
          continue;
        }
        assert.ok(pin.url.startsWith(repo), `${id} ${path}: ${pin.url}`);
        assert.match(pin.sha256, /^[0-9a-f]{64}$/);
        assert.ok(Number.isInteger(pin.size) && pin.size > 0);
        const from = pin.url.slice(repo.length);
        assert.equal(from, path === 'model.onnx' ? GRAPHS[id] : path, `${id} ${path}`);
      }
    }
  });

  it('gives a base and its fp16 variant the same configs: only the graph differs', () => {
    for (const base of Object.keys(LAYOUT)) {
      const configs = (id) => LISTEN[id].recipe.files.filter((f) => f.path !== 'model.onnx');
      assert.deepEqual(configs(base), configs(`${base}-fp16`));
      const graph = (id) => LISTEN[id].recipe.files.find((f) => f.path === 'model.onnx').pin.sha256;
      assert.notEqual(graph(base), graph(`${base}-fp16`));
    }
  });

  it('quotes Apache-2.0 for CLAP, and BSD-3-Clause and CC BY 4.0 for AST, each pinned', () => {
    for (const [id, plan] of Object.entries(LISTEN)) {
      const texts = id.startsWith('clap-general-audio')
        ? [TEXTS.apache2, LISTEN_TEXTS.earshotMit]
        : id.startsWith('clap-')
          ? [TEXTS.apache2]
          : [LISTEN_TEXTS.astBsd3, LISTEN_TEXTS.ccBy4];
      assert.deepEqual(plan.notice.texts, texts, id);
      assert.match(plan.notice.changes.join(' '), /stored as model\.onnx/);
      assert.match(plan.notice.extra.join(' '), id.startsWith('clap-') ? /16c8cc31/ : /f826b80d.*AudioSet/s);
    }
    for (const text of Object.values(LISTEN_TEXTS)) {
      assert.match(text.url, /^https:\/\//);
      assert.match(text.sha256, /^[0-9a-f]{64}$/);
    }
  });
});

describe('pack-listen-models.mjs', () => {
  it('builds every listening model, or the ones --only names', () => {
    assert.deepEqual(LISTEN_IDS, Object.keys(LISTEN));
    assert.deepEqual(chosenIds(undefined), LISTEN_IDS);
    assert.deepEqual(chosenIds('ast-audioset, clap-general-text-fp16'), [
      'ast-audioset',
      'clap-general-text-fp16',
    ]);
    assert.throws(() => chosenIds('beat-this'), /not a listening model: beat-this/);
  });

  it('works under ~/.cache/taalcut-ear1 (or TAALCUT_EAR1_HOME), never in the repository', () => {
    const where = locations({}, { TAALCUT_EAR1_HOME: '/scratch/ear1' });
    assert.deepEqual(where, {
      home: '/scratch/ear1',
      cache: '/scratch/ear1/components-cache',
      out: '/scratch/ear1/release',
      models: '/scratch/ear1/models',
    });
    assert.equal(locations({ out: '/r', home: '/h' }, {}).out, '/r');
    assert.match(locations({}, {}).home, /\.cache[/\\]taalcut-ear1$/);
  });

  it('reads release.json into one row per build, and names the builds two packs disagree on', () => {
    const record = (id, sha256) => ({
      id,
      version: 'v',
      url: `https://components.taalcut.app/${id}/v/${id}.tar.zst`,
      size: 3,
      sha256,
      install: { type: 'archive', format: 'tar.zst', stripComponents: 0, extractedSize: 4 },
      notice: { url: `https://components.taalcut.app/${id}/v/NOTICE-0123456789abcdef.txt` },
    });
    const one = summarise({ components: [record('a', 'x'), record('b', 'y')] }, ['a', 'b']);
    assert.deepEqual(one[0], {
      id: 'a',
      version: 'v',
      file: 'a.tar.zst',
      size: 3,
      sha256: 'x',
      extractedSize: 4,
      notice: 'NOTICE-0123456789abcdef.txt',
    });
    assert.throws(() => summarise({ components: [] }, ['a']), /a: not in release\.json/);
    const two = summarise({ components: [record('a', 'x'), record('b', 'z')] }, ['a', 'b']);
    assert.deepEqual(differences(one, one), []);
    assert.deepEqual(differences(one, two), ['b: y then z']);
  });
});
