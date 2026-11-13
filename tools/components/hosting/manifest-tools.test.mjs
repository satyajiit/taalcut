// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { artifactPlan, artifactPlanProblems, noticeParts } from './artifacts.mjs';
import { checkCoverage } from './build.mjs';
import { noticeFile, objectKey, publicUrl } from './objects.mjs';
import { compose } from '../compose-provisional.mjs';
import { PENDING_PLAN, PLAN, PUBLIC_BASE } from './plan.mjs';
import { applyExtensions, applyRelease, recordsById } from './write-manifest.mjs';

const composed = JSON.parse(readFileSync(new URL('../manifest.provisional.json', import.meta.url), 'utf8'));
const signed = JSON.parse(readFileSync(new URL('../manifest.signed.json', import.meta.url), 'utf8'));

describe('the shipped manifest and the release plan', () => {
  it('plan every component, and nothing else', () => {
    assert.doesNotThrow(() => checkCoverage(composed, PLAN));
    assert.throws(
      () => checkCoverage(composed, { ...PLAN, extra: PLAN.transnetv2 }),
      /not in the manifest: extra/,
    );
    const { onnxruntime: _, ...missing } = PLAN;
    assert.throws(() => checkCoverage(composed, missing), /no release plan for onnxruntime/);
  });

  it('plan what the next release adds too (compose-provisional.mjs PENDING)', () => {
    const pending = compose(undefined, { pending: true });
    assert.doesNotThrow(() => checkCoverage(pending, PENDING_PLAN));
    for (const component of pending.components.filter((c) => !PLAN[c.id]))
      for (const artifact of component.artifacts) {
        const file = artifactPlan(PENDING_PLAN[component.id], artifact.platform).file;
        const key = objectKey(component.id, component.version, file);
        assert.deepEqual(artifact.urls, [publicUrl(PUBLIC_BASE, key)], component.id);
      }
  });

  it('point every artifact and licence at its key on the public domain, with nothing left provisional', () => {
    for (const manifest of [composed, signed.manifest]) {
      for (const component of manifest.components) {
        for (const artifact of component.artifacts) {
          const file = artifactPlan(PLAN[component.id], artifact.platform).file;
          const key = objectKey(component.id, component.version, file);
          assert.deepEqual(artifact.urls, [publicUrl(PUBLIC_BASE, key)], component.id);
        }
        assert.match(component.licence.notice.sha256, /^[0-9a-f]{64}$/, component.id);
        // The notice's key is its content: the url names the sha256 the manifest pins.
        assert.equal(
          component.licence.notice.url,
          publicUrl(
            PUBLIC_BASE,
            objectKey(component.id, component.version, noticeFile(component.licence.notice.sha256)),
          ),
          component.id,
        );
        assert.ok(component.licence.notice.size > 0, component.id);
        assert.equal('url' in component.licence, false, component.id);
        assert.equal(component.provisional, undefined, component.id);
        assert.equal(component.note, undefined, component.id);
      }
    }
  });
});

describe('applyRelease', () => {
  const manifest = {
    schemaVersion: 1,
    components: [
      {
        id: 'whisper-cpp',
        version: '1.9.5',
        provisional: true,
        note: 'not hosted',
        licence: { spdx: 'MIT', url: 'https://github.com/x/LICENSE', attribution: 'whisper.cpp' },
        artifacts: [
          {
            platform: 'darwin-arm64',
            urls: ['https://github.com/x.tar.gz'],
            sha256: 'a'.repeat(64),
            size: 1,
            install: { type: 'file', fileName: 'whisper-cli', executable: true },
          },
          {
            platform: 'darwin-x64',
            urls: ['https://elsewhere/x'],
            sha256: 'b'.repeat(64),
            size: 2,
            install: { type: 'file', fileName: 'whisper-cli', executable: true },
          },
        ],
      },
      { id: 'untouched', version: '1', licence: { spdx: 'MIT' }, artifacts: [] },
    ],
  };
  const release = {
    id: 'whisper-cpp',
    version: '1.9.5',
    platform: 'darwin-arm64',
    url: 'https://components.taalcut.app/whisper-cpp/1.9.5/whisper-cli',
    sha256: 'c'.repeat(64),
    size: 3,
    install: { type: 'file', fileName: 'whisper-cli', executable: true },
    notice: {
      url: 'https://components.taalcut.app/whisper-cpp/1.9.5/NOTICE.txt',
      size: 4,
      sha256: 'd'.repeat(64),
    },
  };

  it('writes the hosted url, bytes and notice, and drops what described unhosted files', () => {
    const { manifest: out, changed } = applyRelease(manifest, new Map([['whisper-cpp', release]]));
    assert.deepEqual(changed, ['whisper-cpp']);
    const [whisper, untouched] = out.components;
    assert.deepEqual(whisper.artifacts[0], {
      platform: 'darwin-arm64',
      urls: [release.url],
      sha256: release.sha256,
      size: 3,
      install: release.install,
    });
    assert.deepEqual(whisper.artifacts[1], manifest.components[0].artifacts[1]);
    assert.deepEqual(whisper.licence, { spdx: 'MIT', notice: release.notice, attribution: 'whisper.cpp' });
    assert.deepEqual(Object.keys(whisper.licence), ['spdx', 'notice', 'attribution']);
    assert.equal('provisional' in whisper, false);
    assert.equal('note' in whisper, false);
    assert.equal(untouched, manifest.components[1]);
  });

  it('writes an archive spec in the manifest order and refuses another version', () => {
    const archive = {
      ...release,
      install: { type: 'archive', format: 'tar.zst', stripComponents: 1, extractedSize: 9 },
    };
    const { manifest: out } = applyRelease(manifest, new Map([['whisper-cpp', archive]]));
    assert.deepEqual(Object.keys(out.components[0].artifacts[0].install), [
      'type',
      'format',
      'stripComponents',
      'extractedSize',
    ]);
    assert.throws(
      () => applyRelease(manifest, new Map([['whisper-cpp', { ...release, version: '2' }]])),
      /version 2/,
    );
  });
  it("keeps the terms the person accepts in the app (LNX1-TRM: NVIDIA's for the CUDA runtime)", () => {
    const acceptance = {
      owner: 'NVIDIA Corporation',
      termsVersion: '2026-10-27',
      documents: [
        {
          title: 'CUDA Toolkit End User License Agreement',
          url: 'https://docs.nvidia.com/cuda/eula/index.html',
        },
      ],
    };
    const [whisper, untouched] = manifest.components;
    const terms = {
      ...manifest,
      components: [{ ...whisper, licence: { ...whisper.licence, acceptance } }, untouched],
    };
    const { manifest: out } = applyRelease(terms, new Map([['whisper-cpp', release]]));
    assert.deepEqual(out.components[0].licence.acceptance, acceptance);
    assert.deepEqual(Object.keys(out.components[0].licence), ['spdx', 'notice', 'attribution', 'acceptance']);
  });
});

describe('a component with an artifact per platform (LNX1-CMP)', () => {
  it('updates the shared notice but keeps artifacts when only another platform is released', () => {
    const file = {
      components: [],
      extend: { rt: { licence: { spdx: 'MIT' }, artifacts: [{ platform: 'linux-x64' }] } },
    };
    const notice = { url: 'https://example.test/NOTICE-new.txt', size: 10, sha256: 'a'.repeat(64) };
    const released = new Map([['rt', [{ version: '2', platform: 'darwin-arm64', notice }]]]);
    const result = applyExtensions(file, released);
    assert.deepEqual(result.changed, ['rt']);
    assert.deepEqual(result.file.extend.rt.licence, { spdx: 'MIT', notice });
    assert.deepEqual(result.file.extend.rt.artifacts, file.extend.rt.artifacts);
    assert.equal(result.file.extend.rt.artifacts[0], file.extend.rt.artifacts[0]);
  });

  const plan = {
    file: 'rt-darwin.tar.zst',
    signature: 'taalcut',
    recipe: { kind: 'script', command: ['true'] },
    notice: { changes: ['Signed.'], texts: [{ title: 'MIT' }] },
    platforms: {
      'linux-x64': {
        file: 'rt-linux.tar.zst',
        signature: 'none',
        recipe: { kind: 'script', command: ['sh', 'pack.sh'] },
        notice: { changes: ['linux-x64: unchanged.'], texts: [{ title: 'MIT' }, { title: 'NVIDIA' }] },
      },
    },
  };
  const component = (...platforms) => ({ id: 'rt', artifacts: platforms.map((platform) => ({ platform })) });

  it('plans each artifact from its platform entry over the component plan', () => {
    assert.equal(artifactPlan(plan, 'darwin-arm64'), plan);
    const linux = artifactPlan(plan, 'linux-x64');
    assert.equal(linux.file, 'rt-linux.tar.zst');
    assert.equal(linux.signature, 'none');
    assert.equal(linux.notice, plan.notice);
    assert.equal('platforms' in linux, false);
    assert.deepEqual(artifactPlanProblems(component('darwin-arm64', 'linux-x64'), plan), []);
    assert.match(artifactPlanProblems(component('darwin-arm64', 'win32-x64'), plan).join(), /share one plan/);
    assert.match(artifactPlanProblems(component('darwin-arm64'), plan).join(), /no linux-x64 artifact/);
  });

  it("gives the one notice every platform's changes, and each text once", () => {
    const parts = noticeParts(plan, ['darwin-arm64', 'linux-x64']);
    assert.deepEqual(parts.changes, ['Signed.', 'linux-x64: unchanged.']);
    assert.deepEqual(
      parts.texts.map((text) => text.title),
      ['MIT', 'NVIDIA'],
    );
    assert.deepEqual(noticeParts(plan, ['darwin-arm64']).changes, ['Signed.']);
  });

  it('writes each platform from its own record, with the notice they share', () => {
    const manifest = {
      schemaVersion: 1,
      components: [
        {
          id: 'rt',
          version: '1',
          licence: { spdx: 'MIT' },
          artifacts: ['darwin-arm64', 'linux-x64'].map((platform) => ({
            platform,
            urls: ['x'],
            sha256: 'a',
            size: 1,
          })),
        },
      ],
    };
    const notice = { url: 'n', size: 2, sha256: 'e'.repeat(64) };
    const record = (platform, sha256) => ({
      id: 'rt',
      version: '1',
      platform,
      url: `https://components.taalcut.app/rt/1/${platform}`,
      sha256,
      size: 5,
      install: { type: 'file', fileName: 'rt', executable: true },
      notice,
    });
    const released = recordsById({ components: [record('darwin-arm64', 'c'), record('linux-x64', 'd')] });
    const { manifest: out } = applyRelease(manifest, released);
    assert.deepEqual(
      out.components[0].artifacts.map((artifact) => artifact.sha256),
      ['c', 'd'],
    );
    assert.deepEqual(out.components[0].licence.notice, notice);
    const split = new Map([
      [
        'rt',
        [record('darwin-arm64', 'c'), { ...record('linux-x64', 'd'), notice: { ...notice, sha256: 'f' } }],
      ],
    ]);
    assert.throws(() => applyRelease(manifest, split), /different notices/);
  });
});
