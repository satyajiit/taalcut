// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Holds the update library to the signed channel file (SB-19). The update library fetches the channel file itself,
 * so a feed could serve it different bytes from the ones manifest-check.ts verified a moment earlier. The gate
 * closes that gap three times: the library is asked only after the signed file verified; an offer is supported
 * only when its version and zip hash are the signed ones (`isUpdateSupported`, before anything is downloaded); and
 * a download is staged only when its bytes hash to the signed sha512. Every refusal is reported as `rejected` with
 * a typed error. The open gate (no signature checks) exists for unit tests of the rest of the pipeline only.
 */
import { err } from '@taalcut/core';
import type { ManifestCheck } from './manifest-check';
import { UpdateManifestMismatch } from './manifest-errors';
import type { SignedOffer } from './manifest-yml';
import type { UpdateEvent } from './update-event';
import type { DownloadVerifier } from './verify-download';

/** What the update library passes to isUpdateSupported (its UpdateInfo), as far as it is read here. */
export interface OfferInfo {
  readonly version: string;
  readonly files?: readonly { readonly sha512?: string }[];
  readonly sha512?: string;
}

export interface ManifestGate {
  /**
   * The pipeline's listener as the gate passes events on (call once, before anything runs). The signed gate
   * reports `checking` itself, before it verifies, and drops the "not available" that follows a refused offer:
   * the refusal already said why, and "not available" would read as "up to date".
   */
  reporting(onEvent: (event: UpdateEvent) => void): (event: UpdateEvent) => void;
  /** Runs the update library's check, only once the signed channel file verified. */
  check(feedUrl: string, channel: string | undefined, libraryCheck: () => Promise<unknown>): Promise<void>;
  /** The update library's offer is the signed one; otherwise reported and refused. */
  offerIsSigned(info: OfferInfo): boolean;
  /** A verified download must also be the signed zip (snapshot.ts's hex sha512 against the signed base64). */
  holdDownload(verify: DownloadVerifier): DownloadVerifier;
}

const quietly = (libraryCheck: () => Promise<unknown>) =>
  libraryCheck().then(
    () => undefined,
    // The update library reports its failures through its 'error' event as well; don't report them twice.
    () => undefined,
  );

/** No signature checks: unit tests of the rest of the pipeline only. start.ts always passes the signed gate. */
export function openGate(): ManifestGate {
  return {
    reporting: (onEvent) => onEvent,
    check: (_feedUrl, _channel, libraryCheck) => quietly(libraryCheck),
    offerIsSigned: () => true,
    holdDownload: (verify) => verify,
  };
}

export function createManifestGate(verifyFeed: ManifestCheck): ManifestGate {
  let report: (event: UpdateEvent) => void = () => undefined;
  let signed: SignedOffer | undefined;
  let offered: SignedOffer | undefined;
  let refused = false;
  const mismatch = (detail: string) => UpdateManifestMismatch({ channel: signed?.channel ?? '' }, { detail });

  async function verified(feedUrl: string, channel: string | undefined): Promise<boolean> {
    const verdict = await verifyFeed(feedUrl, channel);
    signed = verdict.ok ? verdict.value : undefined;
    if (verdict.ok) return true;
    const problem = verdict.error;
    report(
      problem.kind === 'refused'
        ? { type: 'rejected', error: problem.error }
        : { type: 'error', message: problem.message },
    );
    return false;
  }

  return {
    reporting(onEvent) {
      report = onEvent;
      return (event) => {
        const dropped = event.type === 'checking' || (event.type === 'not-available' && refused);
        refused = false;
        if (!dropped) onEvent(event);
      };
    },
    async check(feedUrl, channel, libraryCheck) {
      report({ type: 'checking', feedUrl });
      const go = await verified(feedUrl, channel).catch((cause: unknown) => {
        report({ type: 'error', message: cause instanceof Error ? cause.message : String(cause) });
        return false;
      });
      if (go) await quietly(libraryCheck);
    },
    offerIsSigned(info) {
      const hashes = new Set([...(info.files ?? []).map((file) => file.sha512), info.sha512]);
      hashes.delete(undefined);
      const fits = info.version === signed?.version && hashes.size === 1 && hashes.has(signed.sha512);
      offered = fits ? signed : undefined;
      refused = !fits;
      if (!fits)
        report({ type: 'rejected', error: mismatch(`offered ${info.version}, not the signed file's`) });
      return fits;
    },
    holdDownload(verify) {
      return async (zip) => {
        const verdict = await verify(zip);
        if (!verdict.ok) return verdict;
        const expected = offered && Buffer.from(offered.sha512, 'base64').toString('hex');
        if (expected === verdict.value.snapshot.sha512) return verdict;
        await verdict.value.snapshot.dispose().catch(() => undefined);
        return err(mismatch('the downloaded zip is not the signed one'));
      };
    },
  };
}

/** Wraps the updater's own check so only the signed offer is supported (after any earlier wrapper, blocked.ts). */
export function requireSignedOffer(
  updater: { isUpdateSupported(info: OfferInfo): boolean | Promise<boolean> },
  gate: Pick<ManifestGate, 'offerIsSigned'>,
): void {
  const base = updater.isUpdateSupported.bind(updater);
  updater.isUpdateSupported = async (info) => (gate.offerIsSigned(info) ? base(info) : false);
}
