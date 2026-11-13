// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Core's ContentCredentials over the `c2pa-sidecar` component (SPEC P3.3), plus what exports need: signing
 * and the full read QA checks. Reads never block anything: a missing component, a sidecar that won't start or
 * a file it can't read is presence `unknown`. Bytes in memory (a generated still before the library keeps it)
 * are read the same way through a staged file (staged-bytes.ts). Signing is different: a person asked for
 * credentials, so a missing component is `render.credentials_unavailable` and the export stops at `signing`
 * rather than deliver an unsigned file. Signing is CPU work (hashing and ES256) with no GPU API: reported once per instance as
 * `compute.fallback` (`render.sign`, `no_accelerator`).
 */
import {
  computeFallbackEvent,
  cpuFallback,
  err,
  ok,
  type AsyncResult,
  type ComputeFallbackEvent,
  type ContentCredentials,
  type CredentialsReading,
  type CredentialsSummary,
  type GeneratedMediaType,
} from '@taalcut/core';
import { platformGpu } from '../engine/video-route';
import { CredentialsUnavailable } from '../errors-phase3';
import type { C2paReadSummary, C2paSidecar, C2paSignRequest } from './sidecar';
import { withStagedBytes } from './staged-bytes';

/** What the test certificate may fail on: its issuer is on no trust list. Anything else is invalid. */
export const TOLERATED_FAILURES: ReadonlySet<string> = new Set(['signingCredential.untrusted']);

/** A signed export's credentials as the render row keeps them. */
export interface SignedExport {
  readonly state: 'valid' | 'invalid';
  /** Failure codes beyond the tolerated one (empty when valid). */
  readonly failures: readonly string[];
  readonly summary: C2paReadSummary;
}

export interface RenderContentCredentials extends ContentCredentials {
  /** The sidecar's full read of a file, for QA; null when the component isn't installed. */
  inspect(path: string, signal?: AbortSignal): AsyncResult<C2paReadSummary | null>;
  /** Signs an export (render process only). */
  sign(request: C2paSignRequest, signal?: AbortSignal): AsyncResult<SignedExport>;
}

export interface ContentCredentialsDeps {
  /** The sidecar client, or null when the component isn't installed. Called per use: an install is picked up. */
  readonly sidecar: () => Promise<C2paSidecar | null>;
  readonly onFallback?: (event: ComputeFallbackEvent) => void;
  /** The platform the GPU it was wanted on is named for (default: this process's). */
  readonly platform?: NodeJS.Platform;
  /**
   * A private folder among the sidecar's roots where `readBytes` stages bytes as a file for one read
   * (staged-bytes.ts). Without it there is no `readBytes`, and callers report presence 'unknown'.
   */
  readonly stagingDir?: string;
}

/** 'valid' when the store validates with nothing but the tolerated failures. */
export function signatureState(summary: C2paReadSummary): SignedExport['state'] {
  const signed = summary.state === 'valid' || summary.state === 'trusted';
  return signed && summary.failures.every((code) => TOLERATED_FAILURES.has(code)) ? 'valid' : 'invalid';
}

/** Core's summary shape: the read's state (never 'absent' here) and its untrusted strings, bounded. */
export function credentialsSummaryOf(summary: C2paReadSummary): CredentialsSummary | null {
  if (summary.state === 'absent') return null;
  return {
    state: summary.state,
    generator: summary.generator?.slice(0, 120) ?? null,
    issuer: summary.issuer?.slice(0, 120) ?? null,
    digitalSourceTypes: summary.digitalSourceTypes.slice(0, 8),
    ingredients: summary.ingredients,
  };
}

const UNKNOWN: CredentialsReading = { presence: 'unknown', summary: null };

export function createContentCredentials(deps: ContentCredentialsDeps): RenderContentCredentials {
  let reported = false;
  const reportSigning = () => {
    if (reported || !deps.onFallback) return;
    reported = true;
    const choice = cpuFallback(
      'no_accelerator',
      'C2PA signing hashes the file and signs with ES256 on the CPU',
    );
    if (choice.backend === 'cpu')
      deps.onFallback(computeFallbackEvent('render.sign', platformGpu(deps.platform), choice.fallback));
  };
  const sidecar = async () => deps.sidecar().catch(() => null);
  const read = async (path: string, signal?: AbortSignal): AsyncResult<CredentialsReading> => {
    const client = await sidecar();
    if (!client) return ok(UNKNOWN);
    const found = await client.read(path, signal);
    // A file the sidecar can't read says nothing about its credentials; generation goes on.
    if (!found.ok) return ok(UNKNOWN);
    const summary = credentialsSummaryOf(found.value);
    return ok(summary ? { presence: 'present', summary } : { presence: 'absent', summary: null });
  };
  const { stagingDir } = deps;
  return {
    read,
    ...(stagingDir
      ? {
          readBytes: async (bytes: Uint8Array, mediaType: GeneratedMediaType, signal?: AbortSignal) =>
            (await withStagedBytes(stagingDir, bytes, mediaType, (path) => read(path, signal))) ??
            ok(UNKNOWN),
        }
      : {}),
    async inspect(path, signal) {
      const client = await sidecar();
      if (!client) return ok(null);
      return client.read(path, signal);
    },
    async sign(request, signal) {
      const client = await sidecar();
      if (!client)
        return err(
          CredentialsUnavailable(undefined, { detail: 'The c2pa-sidecar component is not installed' }),
        );
      reportSigning();
      const signed = await client.sign(request, signal);
      if (!signed.ok)
        return err(
          CredentialsUnavailable(undefined, {
            detail: `${signed.error.code}: ${(signed.error.detail ?? '').slice(0, 300)}`,
          }),
        );
      const state = signatureState(signed.value);
      return ok({
        state,
        failures: signed.value.failures.filter((code) => !TOLERATED_FAILURES.has(code)),
        summary: signed.value,
      });
    },
  };
}
