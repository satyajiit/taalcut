// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { classify, GSAP_EXCEPTION, rowsFromReport, shouldSkipPackage } from './licence-scan.mjs';

describe('classify', () => {
  test('MIT passes', () => {
    assert.equal(classify('MIT', 'left-pad').ok, true);
  });

  test('ISC passes', () => {
    assert.equal(classify('ISC', 'fastq').ok, true);
  });

  test('(MIT OR CC0-1.0) passes', () => {
    assert.equal(classify('(MIT OR CC0-1.0)', 'type-fest').ok, true);
  });

  test('MIT OR Apache passes', () => {
    assert.equal(classify('MIT OR Apache', 'sqlite-vec').ok, true);
  });

  test('GPL-3.0 fails', () => {
    assert.equal(classify('GPL-3.0', 'some-gpl').ok, false);
  });

  test('LGPL-2.1-or-later fails', () => {
    assert.equal(classify('LGPL-2.1-or-later', 'some-lgpl').ok, false);
  });

  test('empty licence fails', () => {
    assert.equal(classify('', 'mystery').ok, false);
    assert.equal(classify('   ', 'mystery').ok, false);
    assert.equal(classify(undefined, 'mystery').ok, false);
  });

  test("the workspace shell's toolchain licences pass: PSF-2.0, Unicode-3.0, Zlib (AGT2 sbx)", () => {
    assert.equal(classify('PSF-2.0', 'cpython').ok, true);
    assert.equal(classify('Unicode-3.0', 'icu').ok, true);
    assert.equal(classify('Zlib', 'zlib').ok, true);
    assert.equal(classify('MIT AND Unicode-3.0 AND Zlib', 'node').ok, true);
  });

  test('AGPL-3.0-or-later passes', () => {
    assert.equal(classify('AGPL-3.0-or-later', 'taalcut').ok, true);
  });

  test('the bundled npm CLI uses Artistic 2.0, without accepting the incompatible 1.0 licence', () => {
    assert.equal(classify('Artistic-2.0', 'npm').ok, true);
    assert.equal(classify('Artistic-1.0', 'old-package').ok, false);
  });

  test('react-bits with Commons Clause passes and is noted', () => {
    const decision = classify('MIT + Commons Clause License Condition v1.0', 'react-bits');
    assert.equal(decision.ok, true);
    assert.equal(typeof decision.note, 'string');
    assert.match(decision.note, /Commons Clause/);
  });

  test('react-bits with MIT passes and is noted', () => {
    const decision = classify('MIT', '@davidhdev/react-bits');
    assert.equal(decision.ok, true);
    assert.ok(decision.note);
  });

  test('gsap with its Standard no-charge licence passes and is noted', () => {
    const decision = classify("Standard 'no charge' license: https://gsap.com/standard-license.", 'gsap');
    assert.equal(decision.ok, true);
    assert.equal(decision.note, GSAP_EXCEPTION.note);
    assert.match(decision.note, /PO decision 2026-10-25/);
  });

  test('the gsap exception is by name and exact licence only', () => {
    assert.equal(classify(GSAP_EXCEPTION.license, 'gsap-plugins').ok, false);
    assert.equal(classify(GSAP_EXCEPTION.license, '@gsap/react').ok, false);
    assert.equal(classify('Standard no charge license, changed', 'gsap').ok, false);
    assert.equal(classify('MIT', 'gsap').ok, true);
  });

  test('another package with Commons Clause fails', () => {
    assert.equal(classify('MIT + Commons Clause', 'some-other-pkg').ok, false);
  });

  test('MIT AND GPL-3.0 fails', () => {
    assert.equal(classify('MIT AND GPL-3.0', 'mixed').ok, false);
  });

  test('MIT AND Apache-2.0 passes', () => {
    assert.equal(classify('MIT AND Apache-2.0', 'both').ok, true);
  });

  test('Apache, BlueOak, and CC0 aliases pass; bare BSD fails', () => {
    assert.equal(classify('Apache', 'aliased').ok, true);
    assert.equal(classify('BlueOak', 'aliased').ok, true);
    assert.equal(classify('CC0', 'aliased').ok, true);
    assert.equal(classify('BSD', 'vague').ok, false);
  });
});

describe('workspace packages', () => {
  test('@taalcut/core is skipped', () => {
    assert.equal(shouldSkipPackage('@taalcut/core'), true);
    assert.equal(shouldSkipPackage('@taalcut'), false);
    assert.equal(shouldSkipPackage('taalcut'), false);
    const { rows, failures } = rowsFromReport({
      'AGPL-3.0-or-later': [{ name: '@taalcut/core', versions: ['0.0.0'], license: 'AGPL-3.0-or-later' }],
      MIT: [{ name: 'left-pad', versions: ['1.0.0'], license: 'MIT', homepage: 'https://example.com' }],
    });
    assert.deepEqual(
      rows.map((row) => row.name),
      ['left-pad'],
    );
    assert.deepEqual(failures, []);
  });

  test('rows sort by name then version and keep one row per version', () => {
    const { rows } = rowsFromReport({
      MIT: [
        { name: 'b', versions: ['2.0.0', '1.0.0', '10.0.0'], license: 'MIT' },
        { name: 'a', versions: ['1.0.0'], license: 'MIT' },
      ],
    });
    assert.deepEqual(
      rows.map((row) => `${row.name}@${row.version}`),
      ['a@1.0.0', 'b@1.0.0', 'b@2.0.0', 'b@10.0.0'],
    );
    assert.equal(rows[0].homepage, '(no homepage)');
  });

  test('a package Taalcut ships modified carries its modified-file note, on that version only', () => {
    const { rows } = rowsFromReport({
      'Apache-2.0': [
        { name: '@hyperframes/engine', versions: ['0.8.209', '0.8.210'], license: 'Apache-2.0' },
      ],
    });
    assert.match(rows[0].note, /^Modified by Taalcut \(patches\/@hyperframes__engine@0\.8\.209\.patch\)/);
    assert.equal(rows[1].note, '');
  });

  test('a rejected package is still listed', () => {
    const { rows, failures } = rowsFromReport({
      'GPL-3.0': [
        { name: 'bad', versions: ['1.2.3'], license: 'GPL-3.0', homepage: 'https://example.test/bad' },
      ],
    });
    assert.equal(rows.length, 1);
    assert.equal(failures.length, 1);
    assert.equal(failures[0].homepage, 'https://example.test/bad');
  });
});
