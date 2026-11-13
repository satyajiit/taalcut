// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The vendored earshot data is upstream's, byte for byte (EAR1-F1): every file's sha256 matches the list in
 * package.json, the README pins the same commit, and the shapes @taalcut/audio's port relies on hold (322
 * vocabulary terms, a 512-long reference mean, 512-wide realness head, kit schema 1).
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..');
const read = (path) => readFileSync(join(ROOT, path));
const json = (path) => JSON.parse(read(path).toString('utf8'));
const pkg = json('package.json');
const COMMIT = 'ff41f0788ae56896fd59879ab03858d223c06a53';

describe('vendored earshot data', () => {
  it('matches the sha256 of every upstream file', () => {
    const files = Object.entries(pkg.upstream.files);
    expect(files.length).toBe(10);
    for (const [path, note] of files) {
      const pinned = /sha256 ([0-9a-f]{64})/.exec(note)?.[1];
      expect(pinned, path).toBeDefined();
      expect(createHash('sha256').update(read(path)).digest('hex'), path).toBe(pinned);
    }
  });

  it('pins one upstream commit in package.json, README and NOTICE', () => {
    expect(pkg.upstream.commit).toBe(COMMIT);
    expect(read('README.md').toString()).toContain(`\`${COMMIT}\``);
    expect(read('NOTICE').toString()).toContain(COMMIT);
  });

  it('names the model and label licences in NOTICE', () => {
    const notice = read('NOTICE').toString();
    for (const needle of ['Apache License 2.0', 'BSD 3-Clause', 'CC BY 4.0', 'MIT licence'])
      expect(notice).toContain(needle);
  });

  it('exports files that exist', () => {
    for (const target of Object.values(pkg.exports)) expect(existsSync(join(ROOT, target)), target).toBe(true);
  });

  it('has 322 vocabulary terms in 16 categories under 5 templates', () => {
    const vocab = json('data/vocab.json');
    const terms = Object.values(vocab.categories).flat();
    expect(terms).toHaveLength(322);
    expect(new Set(terms).size).toBe(322);
    expect(Object.keys(vocab.categories)).toHaveLength(16);
    expect(vocab.templates).toEqual(['{}', 'the sound of {}', 'a recording of {}', '{} sound effect', 'an audio clip of {}']);
    for (const cat of ['music_genre', 'music_mood', 'instruments', 'voice'])
      expect(vocab.categories[cat]?.length, cat).toBeGreaterThan(0);
  });

  it('has a 512-long reference mean and the CLAP model it was measured with', () => {
    const stats = json('data/vocab_stats.json');
    const vocab = json('data/vocab.json');
    expect(stats.mean).toHaveLength(512);
    expect(stats.mean.every(Number.isFinite)).toBe(true);
    expect(stats.model).toBe('laion/larger_clap_general');
    expect(stats.pad).toBe('repeatpad');
    expect(stats.templates).toEqual(vocab.templates);
    expect(stats.logit_scale).toBeGreaterThan(1);
    expect(Object.keys(stats.term_cos)).toHaveLength(322);
  });

  it('has the realness heads and thresholds', () => {
    const model = json('data/realness_model.json');
    for (const key of ['mean', 'scale', 'coef']) expect(model.heads.clap[key]).toHaveLength(512);
    expect(model.fusion.heads).toEqual(['clap', 'signal']);
    expect(model.fusion.coef[1]).toBe(0);
    expect(model.prompts.real).toHaveLength(6);
    expect(model.prompts.synth).toHaveLength(6);
    expect(model.thresholds.lo).toBeLessThan(model.thresholds.hi);
  });

  it('has the launch profile and four kit presets', () => {
    expect(json('data/launch_profile.json').n).toBe(7);
    for (const name of ['calm', 'crisp', 'minimal', 'launch']) {
      const kit = json(`kits/${name}.json`);
      expect(kit.kit).toBe(1);
      expect(kit.name).toBe(name);
      expect(Object.keys(kit.roles).length).toBeGreaterThan(0);
    }
  });
});
