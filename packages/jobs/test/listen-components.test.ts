// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-F3: the listening models (tools/components/manifest.listen.provisional.json, hosted since 2026-11-07 and so
 * in compose-provisional.mjs's SOURCES). CLAP's audio and text encoders and AST, each an int8 base (the CPU build)
 * with an fp16 variant for Metal; all on demand. What a machine gets of each group is `variantHere`, the build an
 * install asking for "the build that runs here" takes: fp16 on a Metal Mac, int8 under TAALCUT_FORCE_CPU (the probe
 * then reports no GPU API: models' applyAcceleratorEnv), on a PC and when the hardware is unknown.
 */
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  HARDWARE_TIERS,
  machineFit,
  neededComponents,
  parseManifest,
  tierPicks,
  variantHere,
  type ComponentEntry,
  type ComponentManifest,
  type MachineDescription,
} from '@taalcut/jobs';

const componentsDir = new URL('../../../tools/components/', import.meta.url);
const composer = new URL('compose-provisional.mjs', componentsDir);
const { compose, PENDING, SOURCES } = (await import(pathToFileURL(composer.pathname).href)) as {
  compose(read?: undefined, options?: { pending?: boolean }): unknown;
  PENDING: readonly string[];
  SOURCES: readonly string[];
};

const LISTEN_FILE = 'manifest.listen.provisional.json';
const BASES = ['clap-general-audio', 'clap-general-text', 'ast-audioset'] as const;
const IDS = BASES.flatMap((id) => [id, `${id}-fp16`]);
const METAL = { platform: 'darwin', gpuApi: 'metal' };

function pendingManifest(): ComponentManifest {
  const parsed = parseManifest(compose(undefined, { pending: true }));
  if (!parsed.ok) throw new Error(parsed.error.detail ?? parsed.error.code);
  return parsed.value;
}
const manifest = pendingManifest();
const listen = (id: string): ComponentEntry => {
  const found = manifest.components.find((c) => c.id === id);
  if (!found) throw new Error(`${id} is not in the pending manifest`);
  return found;
};

/** The bench M1 (8 GB) as the Mac probe describes it. */
const M1_MAC: MachineDescription = {
  platform: 'darwin',
  arch: 'arm64',
  osVersion: '15.1',
  gpus: [{ vendor: 'apple', apis: ['metal'] }],
};
/** TAALCUT_FORCE_CPU=1: the probe keeps the GPU and drops its every API (models' applyAcceleratorEnv). */
const forcedCpu = (machine: MachineDescription): MachineDescription => ({
  ...machine,
  gpus: machine.gpus.map((gpu) => ({ ...gpu, apis: [] })),
});
const RTX_4090_HOST: MachineDescription = {
  platform: 'linux',
  arch: 'x64',
  osVersion: '24.04',
  glibcVersion: '2.39',
  gpus: [
    {
      vendor: 'nvidia',
      apis: ['cuda', 'vulkan'],
      driverVersion: '615.71.09',
      computeCapability: '8.9',
      vramBytes: 24 * 1024 ** 3,
    },
  ],
};

/** The build of `id`'s group that an install asking for the one that runs here takes. */
function buildHere(id: string, machine: MachineDescription | undefined, platform = 'darwin-arm64'): string {
  const chosen = variantHere(
    { manifest, platform, fit: { tier: 'minimum', ...(machine ? { machine } : {}) }, unaccepted: new Set() },
    id,
  );
  if (!chosen.ok) throw new Error(chosen.error.code);
  return chosen.value.id;
}

describe('the listening models in the manifest', () => {
  it('are hosted, so the shipped manifest has them, signed', () => {
    expect(SOURCES).toContain(LISTEN_FILE);
    expect(PENDING).not.toContain(LISTEN_FILE);
    const file = JSON.parse(readFileSync(new URL(LISTEN_FILE, componentsDir), 'utf8')) as {
      components: { id: string }[];
    };
    expect(file.components.map((c) => c.id)).toEqual(IDS);
    for (const name of ['manifest.provisional.json', 'manifest.signed.json']) {
      const read = JSON.parse(readFileSync(new URL(name, componentsDir), 'utf8')) as {
        components?: { id: string }[];
        manifest?: { components: { id: string }[] };
      };
      const shipped = (read.manifest ?? read).components ?? [];
      expect(
        shipped.map((c) => c.id).filter((id) => IDS.includes(id)),
        name,
      ).toEqual(IDS);
    }
  });

  it('are an int8 base and its fp16 variant for Metal, each one archive for any platform on ONNX Runtime', () => {
    for (const id of BASES) {
      const base = listen(id);
      const fp16 = listen(`${id}-fp16`);
      expect(base.variants).toEqual([fp16.id]);
      expect(base.requires).toBeUndefined();
      expect(fp16.requires).toEqual(METAL);
      expect(fp16.variants).toBeUndefined();
      expect(base.version).toMatch(/-onnx-int8-/);
      expect(fp16.version).toBe(base.version.replace('-int8-', '-fp16-'));
      for (const build of [base, fp16]) {
        expect(build.kind).toBe('model');
        expect(build.tiers).toEqual([]);
        expect(build.dependencies).toEqual(['onnxruntime']);
        expect(build.artifacts).toHaveLength(1);
        const [artifact] = build.artifacts;
        expect(artifact).toMatchObject({
          platform: 'any',
          install: { type: 'archive', format: 'tar.zst', stripComponents: 0 },
        });
        expect(artifact!.urls).toEqual([
          expect.stringMatching(
            new RegExp(
              `^https://components\\.taalcut\\.app/${build.id}/${build.version}/[a-z0-9-]+\\.tar\\.zst$`,
            ),
          ),
        ]);
        // The model graph is the archive's bulk: what it unpacks to is at least the archive.
        if (artifact!.install.type === 'archive')
          expect(artifact!.install.extractedSize).toBeGreaterThanOrEqual(artifact!.size);
      }
    }
  });

  it('are never what a tier installs by default: listening fetches them on first use', () => {
    const fits = (c: ComponentEntry) => machineFit(c, M1_MAC).fits;
    for (const tier of HARDWARE_TIERS) {
      const picks = tierPicks(manifest, tier, 'darwin-arm64', fits).map((c) => c.id);
      expect(picks.filter((id) => IDS.includes(id))).toEqual([]);
    }
  });

  it('bring ONNX Runtime with them', () => {
    const order = neededComponents(manifest, ['clap-general-audio-fp16'], 'darwin-arm64');
    expect(order.ok && order.value.map((c) => c.id)).toEqual(['onnxruntime', 'clap-general-audio-fp16']);
  });
});

describe('which build of each listening model runs here', () => {
  it('fp16 on a Metal Mac', () => {
    for (const id of BASES) expect(buildHere(id, M1_MAC)).toBe(`${id}-fp16`);
  });

  it('int8 under TAALCUT_FORCE_CPU, on a PC, and when the hardware is unknown', () => {
    for (const id of BASES) {
      expect(buildHere(id, forcedCpu(M1_MAC))).toBe(id);
      expect(buildHere(id, forcedCpu(RTX_4090_HOST), 'linux-x64')).toBe(id);
      // fp16 is for Metal only: a CUDA PC runs the int8 build (ONNX Runtime's CUDA provider takes it).
      expect(buildHere(id, RTX_4090_HOST, 'linux-x64')).toBe(id);
      expect(buildHere(id, undefined)).toBe(id);
    }
  });

  it('says why the fp16 build is passed over, for the log', () => {
    const fp16 = listen('ast-audioset-fp16');
    expect(machineFit(fp16, forcedCpu(M1_MAC))).toEqual({ fits: false, reason: 'no GPU here offers metal' });
    expect(machineFit(fp16, RTX_4090_HOST)).toEqual({
      fits: false,
      reason: 'it runs on darwin; this is linux',
    });
  });

  it('fetch a Mac about 317 MB the first time it listens, and at most 252 MB more for free-text search', () => {
    const size = (id: string) => listen(id).artifacts[0]!.size;
    expect(size('clap-general-audio-fp16') + size('ast-audioset-fp16')).toBeLessThanOrEqual(317_200_000);
    expect(size('clap-general-text-fp16')).toBeLessThanOrEqual(252_000_000);
  });
});

describe('the listening models’ licences', () => {
  it('CLAP is Apache-2.0 (its audio builds add the MIT text banks), AST BSD-3-Clause with the AudioSet names under CC BY 4.0, each credited', () => {
    const spdx: Record<string, string> = {
      'clap-general-audio': 'Apache-2.0 AND MIT',
      'clap-general-text': 'Apache-2.0',
      'ast-audioset': 'BSD-3-Clause AND CC-BY-4.0',
    };
    for (const id of IDS) {
      const { licence } = listen(id);
      expect(licence.spdx).toBe(spdx[id.replace(/-fp16$/, '')]);
      expect(licence.attribution).toMatch(id.startsWith('clap-') ? /laion\/larger_clap_general/ : /AudioSet/);
      expect(licence.attribution).toMatch(/Xenova/);
      expect(licence.notice.url).toBe(
        `https://components.taalcut.app/${id}/${listen(id).version}/NOTICE-${licence.notice.sha256.slice(0, 16)}.txt`,
      );
    }
    expect(listen('ast-audioset').licence.attribution).toMatch(/CC BY 4\.0/);
  });
});
