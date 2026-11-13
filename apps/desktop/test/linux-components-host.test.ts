// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * LNX1-CMP's check on a Linux NVIDIA host (the RTX 4090 one), against a components release built there
 * (`hosting/build.mjs --pending --platform linux-x64`, its folder in TAALCUT_LINUX_RELEASE): the download of
 * everything this machine needs, driven by this host's own description, picks the CUDA builds and the CUDA runtime
 * and installs them checksummed from a loopback server; a process started with acceleratorEnv() then runs ONNX
 * Runtime on CUDA with CPU fallback refused, and nvidia-smi sees it on the GPU. The same process without it can't
 * load CUDA's provider. Skipped where there is no such release or no NVIDIA GPU (every other machine and CI).
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { componentTermsFeatureId, ok } from '@taalcut/core';
import {
  createComponentManager,
  createDownloadSet,
  parseManifest,
  type ComponentManifest,
  type MachineDescription,
  type TermsBook,
} from '@taalcut/jobs';
import { afterAll, describe, expect, it } from 'vitest';
import { acceleratorEnv } from '../src/utility/accelerator-env';
import { describeMachine } from '../src/utility/roots/component-fit';
import { pointedAt, serveDirectory } from './helpers/loopback-components';

const RELEASE = process.env.TAALCUT_LINUX_RELEASE;
const REPO = join(import.meta.dirname, '..', '..', '..');
const nvidia = (() => {
  try {
    return execFileSync(
      'nvidia-smi',
      ['--query-gpu=driver_version,compute_cap,memory.total', '--format=csv,noheader,nounits'],
      {
        encoding: 'utf8',
      },
    );
  } catch {
    return undefined;
  }
})();
const runnable = process.platform === 'linux' && RELEASE !== undefined && nvidia !== undefined;

/** This host as the Linux probe will describe it (LNX1-HW): nvidia-smi's GPUs, os-release, the process's glibc. */
function thisHost(): MachineDescription {
  const os = /^VERSION_ID="?([^"\n]+)"?$/m.exec(readFileSync('/etc/os-release', 'utf8'))?.[1] ?? '';
  const vulkan = existsSync('/usr/share/vulkan/icd.d/nvidia_icd.json');
  const gpus = (nvidia ?? '')
    .trim()
    .split('\n')
    .map((line) => line.split(',').map((part) => part.trim()))
    .map(([driverVersion, computeCapability, mib]) => ({
      vendor: 'nvidia',
      apis: vulkan ? ['cuda', 'vulkan'] : ['cuda'],
      driverVersion: driverVersion!,
      computeCapability: computeCapability!,
      vramBytes: Number(mib) * 1024 * 1024,
    }));
  return describeMachine({ platform: 'linux', arch: 'x64', osVersion: os, gpus });
}

/** The shipped manifest with the pending linux-x64 builds, cut to what the release holds, served from `base`. */
async function releaseManifest(base: string): Promise<ComponentManifest> {
  const { compose } = (await import(join(REPO, 'tools', 'components', 'compose-provisional.mjs'))) as {
    compose(
      read?: undefined,
      options?: { pending?: boolean },
    ): { components: { id: string; variants?: string[] }[] };
  };
  const release = JSON.parse(readFileSync(join(RELEASE!, 'release.json'), 'utf8')) as {
    components: { id: string }[];
  };
  const ids = new Set(release.components.map((c) => c.id));
  const union = compose(undefined, { pending: true });
  const parsed = parseManifest(
    pointedAt(
      {
        ...union,
        components: union.components
          .filter((c) => ids.has(c.id))
          .map((c) => (c.variants ? { ...c, variants: c.variants.filter((id) => ids.has(id)) } : c)),
      },
      base,
    ),
  );
  if (!parsed.ok) throw new Error(parsed.error.detail ?? parsed.error.code);
  return parsed.value;
}

function smoke(componentsRoot: string, env: NodeJS.ProcessEnv) {
  const child = spawnSync(
    process.execPath,
    ['--import', 'tsx', join(import.meta.dirname, 'helpers', 'cuda-smoke-child.ts'), componentsRoot],
    { cwd: REPO, env, encoding: 'utf8', timeout: 120_000 },
  );
  const line = child.stdout.trim().split('\n').at(-1) ?? '';
  try {
    return JSON.parse(line) as {
      binding: string[];
      ok: boolean;
      error?: string;
      output?: number[];
      onGpu?: boolean;
    };
  } catch {
    throw new Error(`the smoke process said: ${child.stdout}\n${child.stderr}`);
  }
}

/** The person accepted every owner's terms the manifest states (LNX1-TRM: NVIDIA's for the CUDA runtime). */
function acceptedAll(manifest: ComponentManifest): TermsBook {
  return {
    has: async (featureId, termsVersion) =>
      ok(
        manifest.components.some(
          (c) =>
            componentTermsFeatureId(c.id) === featureId &&
            c.licence.acceptance?.termsVersion === termsVersion,
        ),
      ),
  };
}

/** The evidence the run prints (warn: the console methods the lint allows). */
const say = (message: string) => console.warn(`[LNX1-CMP] ${message}`);

const roots: string[] = [];
afterAll(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true });
});

describe.skipIf(!runnable)('linux-x64 components on this NVIDIA host (LNX1-CMP)', () => {
  it(
    'installs the CUDA builds and runs ONNX Runtime on CUDA in a process started with acceleratorEnv',
    { timeout: 900_000 },
    async () => {
      const server = await serveDirectory(join(RELEASE!, 'objects'));
      try {
        const manifest = await releaseManifest(server.base);
        const root = await mkdtemp(join(tmpdir(), 'taalcut-lnx1-components-'));
        roots.push(root);
        const host = thisHost();
        const log: string[] = [];
        const manager = createComponentManager({
          root,
          manifest,
          fetch: globalThis.fetch,
          log: (m) => log.push(m),
          terms: acceptedAll(manifest),
        });
        const machines = { host, hidden: { ...host, gpus: [] } };
        const picked: Record<string, string[]> = {};
        for (const [name, machine] of Object.entries(machines)) {
          const set = createDownloadSet({
            manager,
            manifest,
            root,
            machine: async () => ok({ tier: 'high', machine }),
            log: (m) => log.push(m),
            terms: acceptedAll(manifest),
          });
          picked[name] = (await set.status()).entries.map((entry) => entry.status.id).sort();
          await set.stop();
        }
        say(`this host: ${JSON.stringify(host)}`);
        say(`picked here: ${picked.host!.join(', ')}`);
        say(`picked with the GPU hidden: ${picked.hidden!.join(', ')}`);
        expect(picked.host).toEqual(
          expect.arrayContaining(['cuda-runtime-13', 'onnxruntime', 'onnxruntime-cuda']),
        );
        expect(picked.hidden!.filter((id) => /cuda|vulkan/.test(id))).toEqual([]);

        const set = createDownloadSet({
          manager,
          manifest,
          root,
          machine: async () => ok({ tier: 'high', machine: host }),
          log: (m) => log.push(m),
          terms: acceptedAll(manifest),
        });
        expect((await set.start()).ok).toBe(true);
        let status = await set.status();
        while (status.state !== 'ready' && status.state !== 'failed') {
          await new Promise((resolve) => setTimeout(resolve, 1000));
          status = await set.status();
          if (status.entries.some((entry) => entry.state === 'failed')) break;
        }
        say(`${log.filter((m) => m.startsWith('[components]')).join('\n')}`);
        expect(
          status.entries.filter((entry) => entry.state !== 'installed').map((e) => [e.status.id, e.error]),
        ).toEqual([]);
        for (const id of ['cuda-runtime-13', 'onnxruntime-cuda']) {
          const installed = await manager.get(id);
          const artifact = manifest.components
            .find((c) => c.id === id)!
            .artifacts.find((a) => a.platform === 'linux-x64')!;
          expect(installed?.sha256).toBe(artifact.sha256);
        }
        await set.stop();
        await manager.close();

        const accelerated = acceleratorEnv({ componentsRoot: root, env: {} });
        say(`acceleratorEnv: ${JSON.stringify(accelerated)}`);
        const { LD_LIBRARY_PATH: _held, ...bare } = process.env;
        const onCuda = smoke(root, { ...bare, ...accelerated });
        say(`with acceleratorEnv: ${JSON.stringify(onCuda)}`);
        expect(onCuda).toMatchObject({ ok: true, onGpu: true, output: [128, 128, 128, 128] });
        expect(onCuda.binding.join()).toContain('onnxruntime-cuda');
        const without = smoke(root, bare);
        say(`without it: ${JSON.stringify(without)}`);
        expect(without.ok).toBe(false);
      } finally {
        await server.close();
      }
    },
  );
});
