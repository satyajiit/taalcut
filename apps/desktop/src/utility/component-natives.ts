// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Native code from components, not from node_modules (AGENTS.md: nothing for
 * the user to install; the installer stays small). onnxruntime-node's
 * JavaScript ships with the app (a production dependency, so transformers.js
 * and vision's own sessions can load it), but its native binding and
 * libonnxruntime come from a component the component manager installs into
 * `<userData>/components`: `onnxruntime-cuda` where it is installed (Linux on
 * NVIDIA: the same binding with CUDA's provider beside it, tools/components/
 * linux/pack-onnxruntime.sh), else `onnxruntime` (CPU and WebGPU; on macOS
 * Developer ID-signed by tools/components/pack-onnxruntime.sh). The packaged
 * app carries no onnxruntime binaries at all (packaging/builder-config.ts
 * drops bin/).
 *
 * How: a synchronous module resolve hook (node:module registerHooks, Node 24)
 * catches onnxruntime-node's `require('../bin/napi-v6/<platform>/<arch>/
 * onnxruntime_binding.node')` and points it at the same file inside the
 * installed component; the binding finds libonnxruntime next to itself
 * (@loader_path, $ORIGIN), and libonnxruntime its providers. CUDA's provider
 * finds the CUDA libraries through LD_LIBRARY_PATH (accelerator-env.ts). The
 * builds hold the same binding, so the one a process loads first is the one it
 * keeps. Everything that loads ONNX Runtime does so lazily, after
 * its own component check, so the registry already names the folder.
 * Without the component, a packaged app fails that load with a clear error
 * (callers report their model as unavailable, and the stages wait for it). So
 * does a checkout that installs from a local release (TAALCUT_DEV_COMPONENTS,
 * roots/dev-components.ts): runtimes from components only, like a packaged
 * app. Any other checkout falls back to the binding pnpm installed, and says so
 * in its log once per process (UX3-IDX: the fallback is a development
 * convenience, never silent).
 */
import { registerHooks } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { installedComponentDirSync } from '@taalcut/jobs';

export const ONNXRUNTIME_COMPONENT = 'onnxruntime';
/** The builds the binding may come from, most capable first (ADR 0002, GPU first). */
export const ONNXRUNTIME_COMPONENTS = ['onnxruntime-cuda', ONNXRUNTIME_COMPONENT] as const;

/** onnxruntime-node's binding request, as dist/binding.js makes it. */
const BINDING = /(?:^|\/)bin\/napi-v6\/([a-z0-9]+)\/([a-z0-9]+)\/onnxruntime_binding\.node$/;
const FROM_ORT = /[/\\]onnxruntime-node[/\\]/;

export interface ComponentNativesOptions {
  /** `<userData>/components`, the jobs process's component manager's root. */
  readonly componentsRoot: string;
  /** A packaged app has no binding in node_modules: without the component the load fails. */
  readonly packaged: boolean;
  /**
   * Runtimes from components only, never node_modules: a packaged app, and a development run installing from a
   * local release (dev-components.ts managedNativesOnly). Default `packaged`.
   */
  readonly managedOnly?: boolean;
  readonly log?: (message: string) => void;
}

export type BindingRedirect =
  | { readonly kind: 'component'; readonly component: string; readonly url: string }
  | { readonly kind: 'default' }
  | { readonly kind: 'missing'; readonly message: string }
  | { readonly kind: 'not-ours' };

/** Where one module request goes: pure, so it is unit-tested without a loader. */
export function redirectBinding(
  specifier: string,
  parentURL: string | undefined,
  options: Pick<ComponentNativesOptions, 'componentsRoot' | 'packaged' | 'managedOnly'>,
  installedDir: (root: string, id: string) => string | undefined = installedComponentDirSync,
): BindingRedirect {
  const match = BINDING.exec(specifier.replaceAll('\\', '/'));
  if (!match || !parentURL || !FROM_ORT.test(decodeURIComponent(parentURL))) return { kind: 'not-ours' };
  const [, platform, arch] = match as unknown as [string, string, string];
  for (const component of ONNXRUNTIME_COMPONENTS) {
    const dir = installedDir(options.componentsRoot, component);
    if (dir)
      return {
        kind: 'component',
        component,
        url: pathToFileURL(join(dir, 'bin', 'napi-v6', platform, arch, 'onnxruntime_binding.node')).href,
      };
  }
  if (!(options.managedOnly ?? options.packaged)) return { kind: 'default' };
  return {
    kind: 'missing',
    message: `The ${ONNXRUNTIME_COMPONENT} component is not installed (${options.componentsRoot}).`,
  };
}

let installed = false;

/** Installs the resolve hook once per process. Call before anything loads onnxruntime-node. */
export function installComponentNatives(
  options: ComponentNativesOptions,
  register: typeof registerHooks | undefined = registerHooks,
): boolean {
  if (installed) return true;
  const log = options.log ?? ((message: string) => console.warn(message));
  if (typeof register !== 'function') {
    log('[components] module hooks are unavailable: native runtimes load from node_modules only');
    return false;
  }
  let announced = false;
  register({
    resolve(specifier, context, next) {
      const redirect = redirectBinding(specifier, context.parentURL, options);
      if (redirect.kind === 'component') {
        if (!announced) log(`[components] onnxruntime binding from ${redirect.component}: ${redirect.url}`);
        announced = true;
        return { url: redirect.url, shortCircuit: true };
      }
      if (redirect.kind === 'missing') throw new Error(redirect.message);
      if (redirect.kind === 'default' && !announced) {
        announced = true;
        log(
          `[components] onnxruntime binding from node_modules: no ${ONNXRUNTIME_COMPONENT} component in ` +
            `${options.componentsRoot} (a development run's fallback; TAALCUT_DEV_COMPONENTS=<release> installs it)`,
        );
      }
      return next(specifier, context);
    },
  });
  installed = true;
  return true;
}
