// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Content Credentials (C2PA, P3-V7): reading what a file says about how it was made, and the export option to
 * add Taalcut's own (off by default: Taalcut adds nothing unless the person turns it on). The reader runs the
 * bundled C2PA component (render, models); a file without a manifest is 'absent', never an error.
 */
import '../basics/zod-config';
import { z } from 'zod';
import type { AsyncResult } from '../basics/result';
import { createToken } from '../di/token';
import type { GeneratedMediaType } from '../library/generated-media-types';
import { PLATFORMS } from './presets';

export const C2PA_PRESENCES = ['present', 'absent', 'unknown'] as const;
export type C2paPresence = (typeof C2PA_PRESENCES)[number];

export const CREDENTIAL_STATES = ['valid', 'trusted', 'invalid'] as const;

export const credentialsSummarySchema = z.object({
  /** Signature state as the SDK reports it (a test certificate is 'valid', never 'trusted'). */
  state: z.enum(CREDENTIAL_STATES),
  /** Claim generator and issuer as written in the manifest: untrusted text. */
  generator: z.string().max(120).nullable(),
  issuer: z.string().max(120).nullable(),
  /** IPTC digital source types asserted in the active manifest. */
  digitalSourceTypes: z.array(z.string().max(200)).max(8),
  ingredients: z.int().nonnegative(),
});
export type CredentialsSummary = z.output<typeof credentialsSummarySchema>;

/** What a manifest read finds. */
export interface CredentialsReading {
  readonly presence: C2paPresence;
  readonly summary: CredentialsSummary | null;
}

export interface ContentCredentials {
  /** 'absent' for an unsigned file; 'unknown' when the component isn't installed. */
  read(path: string, signal?: AbortSignal): AsyncResult<CredentialsReading>;
  /**
   * Round P3-3 (P3-B7): the same read over bytes in memory, for a generated still before the library stores
   * it. Optional until render implements it; without it the caller reports 'unknown'.
   */
  readBytes?(
    bytes: Uint8Array,
    mediaType: GeneratedMediaType,
    signal?: AbortSignal,
  ): AsyncResult<CredentialsReading>;
}
export const ContentCredentialsToken = createToken<ContentCredentials>('core.contentCredentials');

/** The export option. Default off. */
export const contentCredentialsOptionSchema = z.object({ add: z.boolean() });
export type ContentCredentialsOption = z.output<typeof contentCredentialsOptionSchema>;

/** What a finished render carries: whether credentials were added, and the signature's state when they were. */
export const renderCredentialsSchema = z.object({
  added: z.boolean(),
  state: z.enum(['valid', 'invalid']).nullable(),
});
export type RenderCredentials = z.output<typeof renderCredentialsSchema>;

/** The export dialog's note: the option, how many sources already carry credentials, platforms that ask for disclosure. */
export const exportCredentialsSchema = z.object({
  add: z.boolean(),
  sourcesWithCredentials: z.int().nonnegative(),
  disclosures: z.array(z.enum(PLATFORMS)).max(PLATFORMS.length),
});
export type ExportCredentials = z.output<typeof exportCredentialsSchema>;
