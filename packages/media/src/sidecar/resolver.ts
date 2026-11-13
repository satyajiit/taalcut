// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Finds the mac helper the way FFmpeg is found: a development override, the
 * signed sidecar directory, then the in-repo release build. No PATH search.
 * Swift doesn't compile the helper to the same bytes twice, so no pin is
 * committed: packaging takes the signature-free sha256 of the helper it ships
 * and bakes it into the app's bundles (apps/desktop/packaging/mac-helper.ts),
 * and the app passes it here. A helper found in the sidecar directory is run
 * only with a pin, and only if it matches; a checkout's helper is unpinned.
 */
import { constants } from 'node:fs';
import { access } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { err, ok, type AsyncResult } from '@taalcut/core';
import { signatureFreeSha256 } from '../binaries/macho-digest';
import { SidecarNotFound, SidecarPinMismatch } from './errors';

export const MAC_HELPER_ENV = 'TAALCUT_MAC_HELPER';

export type SidecarSource = 'env' | 'sidecar' | 'dev-build';

export interface ResolvedSidecar {
  readonly path: string;
  readonly source: SidecarSource;
}

export interface SidecarResolver {
  resolve(): AsyncResult<ResolvedSidecar>;
}

export interface SidecarResolverOptions {
  readonly name: string;
  /** Packaged app: Contents/Resources/bin. A missing file here is an error, never a fall-through. */
  readonly sidecarDir?: string;
  /**
   * Signature-free sha256 the helper must have. Required for a helper found in `sidecarDir` (a packaged app's pin,
   * baked in by its packaging step); empty skips the check for a development helper.
   */
  readonly pin?: string;
  /** Allow TAALCUT_MAC_HELPER and the repo's native/mac-helper/dist. Default false. */
  readonly development?: boolean;
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Override for native/mac-helper/dist. Default: resolved from this file. */
  readonly devDist?: string;
}

const DEFAULT_DEV_DIST = fileURLToPath(new URL('../../../../native/mac-helper/dist/', import.meta.url));

export function createSidecarResolver(options: SidecarResolverOptions): SidecarResolver {
  return {
    async resolve() {
      const pin = options.pin ?? '';
      const located = await locate(options);
      if (!located.ok) return located;
      if (pin === '') {
        if (located.value.source !== 'sidecar') return located;
        return err(
          SidecarPinMismatch(
            { binary: options.name },
            { detail: `${located.value.path}: no pin to check it against, so it is not run` },
          ),
        );
      }
      const digest = await signatureFreeSha256(located.value.path);
      if (digest !== pin) {
        return err(
          SidecarPinMismatch({ binary: options.name }, { detail: `${located.value.path}: ${digest}` }),
        );
      }
      return located;
    },
  };
}

async function locate(options: SidecarResolverOptions): AsyncResult<ResolvedSidecar> {
  const envPath = options.env?.[MAC_HELPER_ENV]?.trim();
  if (options.development && envPath) {
    if (!isAbsolute(envPath)) {
      return err(
        SidecarNotFound({ binary: options.name }, { detail: `${MAC_HELPER_ENV} must be an absolute path` }),
      );
    }
    return existing(envPath, options.name, 'env');
  }
  if (options.sidecarDir) {
    return existing(join(options.sidecarDir, options.name), options.name, 'sidecar');
  }
  if (!options.development) {
    return err(SidecarNotFound({ binary: options.name }, { detail: 'no sidecar directory' }));
  }
  const dist = options.devDist ?? DEFAULT_DEV_DIST;
  return existing(join(dist, options.name), options.name, 'dev-build');
}

async function existing(path: string, name: string, source: SidecarSource): AsyncResult<ResolvedSidecar> {
  try {
    await access(path, constants.X_OK);
  } catch (cause) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    return err(SidecarNotFound({ binary: name }, { detail: `${path}: ${detail}` }));
  }
  return ok({ path, source });
}
