// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The component manifest for the embedded runtime
 * (tools/components/manifest.local-llm.provisional.json) must name exactly
 * the components the runtime spec installs on each tier, with the hosted files
 * (spike 08's weights; llama.cpp re-signed with the Developer ID by the hosting
 * lane, so its archive differs from upstream's).
 * packages/jobs validates manifests against its schema; this checks they
 * agree with the models side.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  componentsFor,
  createFakeLocalRuntimeDriver,
  createLocalRuntime,
  createMemoryComponentInstaller,
  HARDWARE_TIERS,
  llamaCppRuntimeSpec,
  localRuntimeSpec,
  MLX_RUNTIME_COMPONENT,
} from '@taalcut/models';

interface ManifestComponent {
  readonly id: string;
  readonly tiers: readonly string[];
  readonly provisional?: boolean;
  readonly artifacts: readonly {
    readonly platform: string;
    readonly urls: readonly string[];
    readonly sha256: string;
    readonly size: number;
    readonly install: { readonly type: string; readonly fileName?: string };
  }[];
}

const readManifest = (name: string) =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL(`../../../tools/components/${name}`, import.meta.url)), 'utf8'),
  ) as { readonly components: readonly (ManifestComponent & { readonly dependencies: readonly string[] })[] };
const manifest = readManifest('manifest.local-llm.provisional.json');

const runtime = createLocalRuntime({
  spec: llamaCppRuntimeSpec('recommended'),
  installer: createMemoryComponentInstaller(),
  driver: createFakeLocalRuntimeDriver(() => ({
    kind: 'openai-compatible',
    baseUrl: 'http://127.0.0.1:9/v1',
  })),
  backends: [],
});

describe('local LLM component manifest (spike 08)', () => {
  it('lists what each tier installs, with the tiers that install it, every file hosted', () => {
    const ids = new Set([...runtime.componentsFor('recommended'), ...runtime.componentsFor('minimum')]);
    expect(manifest.components.map((c) => c.id)).toEqual([...ids]);
    for (const component of manifest.components) {
      expect(component.provisional, component.id).toBeUndefined();
      for (const artifact of component.artifacts)
        expect(artifact.urls, component.id).toEqual([
          expect.stringMatching(new RegExp(`^https://components\\.taalcut\\.app/${component.id}/`)),
        ]);
      expect(component.tiers, component.id).toEqual(
        HARDWARE_TIERS.filter((tier) => runtime.componentsFor(tier).includes(component.id)),
      );
    }
    // The 8 GB tier gets the 0.8B and never downloads the 4B.
    expect(runtime.componentsFor('minimum')).toEqual(['local-llm-runtime', 'local-llm-qwen3-5-0-8b']);
  });

  it('recommends what the runtime installs: one rule for the supervisor and components.installRecommended', () => {
    for (const tier of HARDWARE_TIERS) {
      expect(componentsFor(llamaCppRuntimeSpec('recommended'), tier), tier).toEqual(
        runtime.componentsFor(tier),
      );
    }
    expect(componentsFor({ ...llamaCppRuntimeSpec('recommended'), models: [] }, 'high')).toEqual([]);
  });

  it('pins the hosted files', () => {
    const files = Object.fromEntries(
      manifest.components.map((c) => [c.id, c.artifacts.map((a) => [a.platform, a.sha256, a.size])]),
    );
    expect(files).toEqual({
      'local-llm-runtime': [
        ['darwin-arm64', '3d54d5b3d387e2dbe2d1dbf66bdb1e7ba2cefd9db77bb80fe5388202ff2a7c59', 8_734_674],
      ],
      'local-llm-qwen3-5-4b': [
        ['any', 'a9d0a3e1d8c91732a3812becd31f8d4a8ff57414903f226306069f0437e2ac50', 2_648_593_216],
      ],
      'local-llm-qwen3-5-4b-mmproj': [
        ['any', 'e56a899b1540860385465756dd308c84417410b94dbc1c380adffd20a921ca60', 675_569_120],
      ],
      // unsloth/Qwen3.5-0.8B-GGUF at 6ab46149, the size J8b measured (section 9).
      'local-llm-qwen3-5-0-8b': [
        ['any', 'bd258782e35f7f458f8aced1adc053e6e92e89bc735ba3be89d38a06121dc517', 532_517_120],
      ],
    });
    // Weights install as single files: the driver passes ComponentManager's `file` to --model and --mmproj.
    expect(manifest.components.slice(1).map((c) => c.artifacts[0]?.install.type)).toEqual([
      'file',
      'file',
      'file',
    ]);
  });
});

describe('the MLX components manifest (MLX1, pending)', () => {
  const mlx = readManifest('manifest.local-llm-mlx.provisional.json');
  const llama = new Set(manifest.components.map((c) => c.id));
  const mac = (tier: (typeof HARDWARE_TIERS)[number]) =>
    componentsFor(localRuntimeSpec('high', 'darwin-arm64'), tier).filter((id) => !llama.has(id));

  it('lists what an Apple silicon Mac adds on each tier, for that Mac only, the weights after their server', () => {
    expect(mlx.components.map((c) => c.id)).toEqual(mac('high'));
    expect(mac('recommended')).toEqual([]);
    for (const component of mlx.components) {
      expect(component.tiers, component.id).toEqual(
        HARDWARE_TIERS.filter((t) => mac(t).includes(component.id)),
      );
      expect(
        component.artifacts.map((a) => a.platform),
        component.id,
      ).toEqual(['darwin-arm64']);
      for (const artifact of component.artifacts)
        expect(artifact.urls, component.id).toEqual([
          expect.stringMatching(new RegExp(`^https://components\\.taalcut\\.app/${component.id}/`)),
        ]);
    }
    const weights = mlx.components.find((c) => c.id !== MLX_RUNTIME_COMPONENT);
    expect(weights?.dependencies).toEqual([MLX_RUNTIME_COMPONENT]);
  });
});
