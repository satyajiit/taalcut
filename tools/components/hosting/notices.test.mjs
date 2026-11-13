// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { cratesNotice, linkedPackages } from './cargo-notices.mjs';
import { noticeText } from './notice.mjs';

const component = {
  id: 'silero-vad',
  name: 'Silero VAD',
  version: '6.2.3',
  licence: { spdx: 'MIT', attribution: 'Silero VAD by the Silero Team, MIT licence.' },
};

describe('noticeText', () => {
  it('says what the component is, what changed and quotes every licence', () => {
    const text = noticeText({
      component,
      url: 'https://components.taalcut.app/silero-vad/6.2.3/silero_vad.onnx',
      changes: ['Taalcut hosts these bytes unchanged.'],
      extra: ['A further note.'],
      sections: [
        {
          title: 'Silero VAD LICENSE (MIT)',
          text: 'MIT License\r\n\r\nCopyright (c) 2020-present Silero Team\r\n\n\n',
        },
      ],
    });
    assert.match(
      text,
      /^Silero VAD 6\.2\.3 \(Taalcut component "silero-vad"\)\nHosted at https:\/\/components/,
    );
    assert.match(
      text,
      /Licence: MIT\nSilero VAD by the Silero Team, MIT licence\.\n\nTaalcut hosts these bytes unchanged\.\n\nA further note\./,
    );
    assert.match(
      text,
      /={78}\nSilero VAD LICENSE \(MIT\)\n={78}\n\nMIT License\n\nCopyright \(c\) 2020-present Silero Team\n$/,
    );
    assert.doesNotMatch(text, /\r/);
  });

  it('names every hosted file of a component with one per platform', () => {
    const text = noticeText({
      component,
      url: [
        'https://components.taalcut.app/x/1/a-darwin.tar.zst',
        'https://components.taalcut.app/x/1/a-linux.tar.zst',
      ],
      changes: ['Unchanged.'],
      sections: [{ title: 'MIT', text: 'MIT License' }],
    });
    assert.match(
      text,
      /\nHosted at:\n {2}https:\/\/components\.taalcut\.app\/x\/1\/a-darwin\.tar\.zst\n {2}https:.*a-linux/,
    );
  });

  it('lists the hosted corresponding sources with their sizes and sha256', () => {
    const text = noticeText({
      component,
      url: 'https://components.taalcut.app/silero-vad/6.2.3/silero_vad.onnx',
      changes: ['Unchanged.'],
      sources: [
        {
          url: 'https://components.taalcut.app/silero-vad/6.2.3/source/x-1.tar.gz',
          what: 'x 1 (MPL-2.0), the sdist.',
          size: 12,
          sha256: 'e'.repeat(64),
        },
      ],
      sections: [{ title: 'T', text: 'licence' }],
    });
    assert.ok(
      text.includes(
        `Unchanged.\n\nCorresponding source, hosted beside this file for as long as Taalcut hosts this component:\n\n  https://components.taalcut.app/silero-vad/6.2.3/source/x-1.tar.gz\n  x 1 (MPL-2.0), the sdist.\n  12 bytes, sha256 ${'e'.repeat(64)}\n\n====`,
      ),
    );
  });

  it('refuses a notice without a licence text', () => {
    assert.throws(
      () => noticeText({ component, url: 'u', changes: [], sections: [] }),
      /at least one licence text/,
    );
  });
});

const pkg = (name, kinds = ['lib']) => ({
  id: `${name} 1.0.0`,
  name,
  version: '1.0.0',
  license: 'MIT',
  targets: [{ kind: kinds }],
});
const dep = (name, kind = null) => ({ pkg: `${name} 1.0.0`, dep_kinds: [{ kind }] });

describe('linkedPackages', () => {
  const metadata = {
    packages: ['root', 'serde', 'serde_derive', 'cc', 'proptest', 'itoa', 'zeta'].map((name) =>
      pkg(name, name === 'serde_derive' ? ['proc-macro'] : ['lib']),
    ),
    resolve: {
      root: 'root 1.0.0',
      nodes: [
        { id: 'root 1.0.0', deps: [dep('serde'), dep('cc', 'build'), dep('proptest', 'dev'), dep('zeta')] },
        { id: 'serde 1.0.0', deps: [dep('serde_derive'), dep('itoa')] },
        { id: 'zeta 1.0.0', deps: [dep('itoa')] },
      ],
    },
  };

  it('follows normal dependencies only, without proc-macros or the root, sorted', () => {
    assert.deepEqual(
      linkedPackages(metadata).map((p) => p.name),
      ['itoa', 'serde', 'zeta'],
    );
  });

  it('lists every crate and quotes its licence files, and refuses a crate with none', () => {
    const packages = linkedPackages(metadata);
    const text = cratesNotice(packages, (p) => [{ name: 'LICENSE-MIT', text: `${p.name} licence\n` }]);
    assert.match(text, /^itoa 1\.0\.0 {2}MIT$/m);
    assert.match(text, /---- zeta 1\.0\.0: LICENSE-MIT ----\n\nzeta licence\n$/);
    assert.throws(() => cratesNotice(packages, () => []), /itoa 1\.0\.0: no licence file/);
  });
});
