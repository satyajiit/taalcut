// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Before each update check (SB-19): fetch the channel file and its `.sig`, check the signature against the key
 * this build trusts (manifest-envelope.ts), refuse a replay of an older file (manifest-seen.ts), and read what the
 * signed file offers (manifest-yml.ts). The gate then holds the update library to that offer.
 *
 * A missing channel file or an unreachable feed is a failed check, reported like the update library's own errors;
 * everything about the signature is a refusal with a typed error.
 */
import type { KeyObject } from 'node:crypto';
import { err, ok, type Result, type TaalcutError } from '@taalcut/core';
import { updateFeedFileName } from './feed';
import {
  checkEnvelope,
  manifestChannel,
  MAX_SIGNATURE_BYTES,
  type ManifestChannel,
} from './manifest-envelope';
import { UpdateManifestMissing, UpdateManifestUnreadable } from './manifest-errors';
import { feedFileUrl, readFeedFile, type FeedFetch } from './manifest-fetch';
import type { SeenSignatures } from './manifest-seen';
import { MAX_CHANNEL_FILE_BYTES, signedOfferOf, type SignedOffer } from './manifest-yml';

/** Why there is no signed offer: the check failed (no file, no network), or the file was refused. */
export type ManifestProblem =
  | { readonly kind: 'failed'; readonly message: string }
  | { readonly kind: 'refused'; readonly error: TaalcutError };

export type ManifestCheck = (
  feedUrl: string,
  channel: string | undefined,
) => Promise<Result<SignedOffer, ManifestProblem>>;

export interface ManifestCheckDeps {
  readonly fetch: FeedFetch;
  readonly key: KeyObject;
  readonly seen: SeenSignatures;
  readonly now: () => number;
}

const refused = (error: TaalcutError) => err<ManifestProblem>({ kind: 'refused', error });
const failed = (message: string) => err<ManifestProblem>({ kind: 'failed', message });

export function createManifestCheck(deps: ManifestCheckDeps): ManifestCheck {
  return async (feedUrl, updaterChannel) => {
    const channel: ManifestChannel | undefined = manifestChannel(updaterChannel);
    if (!channel)
      return refused(
        UpdateManifestUnreadable({ channel: updaterChannel ?? '' }, { detail: 'no such channel' }),
      );
    const name = updateFeedFileName(channel === 'latest' ? undefined : channel);
    const ymlUrl = feedFileUrl(feedUrl, name);
    const loopbackHttp = ymlUrl.protocol === 'http:';
    const yml = await readFeedFile(deps.fetch, ymlUrl, { maxBytes: MAX_CHANNEL_FILE_BYTES, loopbackHttp });
    if (yml.kind === 'missing') return failed(`Cannot find channel "${name}" update info (404)`);
    if (yml.kind === 'failed') return failed(`Cannot read channel "${name}": ${yml.detail}`);
    const sig = await readFeedFile(deps.fetch, feedFileUrl(feedUrl, `${name}.sig`), {
      maxBytes: MAX_SIGNATURE_BYTES,
      loopbackHttp,
    });
    if (sig.kind === 'missing')
      return refused(UpdateManifestMissing({ channel }, { detail: `no ${name}.sig` }));
    if (sig.kind === 'failed') return refused(UpdateManifestUnreadable({ channel }, { detail: sig.detail }));
    const verdict = checkEnvelope({
      envelope: new TextDecoder().decode(sig.bytes),
      yml: yml.bytes,
      key: deps.key,
      channel,
      now: deps.now(),
      lastAccepted: deps.seen.last(channel),
    });
    if (!verdict.ok) return refused(verdict.error);
    const offer = signedOfferOf(new TextDecoder().decode(yml.bytes), channel);
    if (!offer.ok) return refused(offer.error);
    deps.seen.accept(channel, verdict.value.signedAt);
    return ok(offer.value);
  };
}
