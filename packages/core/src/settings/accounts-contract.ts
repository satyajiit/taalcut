// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * appContract.accounts, served by main, which owns the AuthBroker and the
 * keychain vault (models SPEC, "Auth token flow").
 *
 * These are deliberately not bus commands: a command's payload is stored in
 * the audit log, and an API key must never reach the database or a log. A key
 * travels renderer → main once, inside setApiKey, and is never sent back:
 * nothing here returns a key, a token or part of one.
 */
import '../basics/zod-config';
import { z } from 'zod';
import { eventIterator, ipc } from '../ipc/contract';
import { externalLinkSchema } from '../ipc/external-links';
import { STOCK_PROVIDERS } from '../library/stock';

/** Stock media providers whose keys Accounts keeps (P3-V18). */
export const STOCK_KEY_PROVIDERS = STOCK_PROVIDERS;

/** pi-ai's provider id for the ChatGPT / Codex plan (Continue with ChatGPT, P1-F3). */
export const CHATGPT_PROVIDER = 'openai-codex';
/** A separate Codex image connection; never aliases or overwrites the ChatGPT chat credential. */
export const CHATGPT_IMAGE_PROVIDER = 'openai-codex-images';

/** Subscription logins that need the warning card first (PRD 8.3, 10.1; P1-F6). */
export const WARNED_LOGINS = ['anthropic', 'github-copilot', 'xai'] as const;
export type WarnedLogin = (typeof WARNED_LOGINS)[number];

export const LOCAL_SERVER_KINDS = ['ollama', 'lm-studio'] as const;
export type LocalServerKind = (typeof LOCAL_SERVER_KINDS)[number];

/**
 * The warning card in front of a subscription login (models' SignInOption.warning).
 * `feature` and `termsVersion` key the acknowledgement; the keys are the card's words.
 */
export const signInWarningSchema = z.object({
  feature: z.string().min(1),
  /** Bumped when the facts change; earlier acknowledgements then stop counting. */
  termsVersion: z.string().min(1),
  titleKey: z.string(),
  bodyKey: z.string(),
  riskKey: z.string(),
});
export type SignInWarning = z.infer<typeof signInWarningSchema>;

export const accountCheckSchema = z.object({
  /** Epoch ms. */
  at: z.int().nonnegative(),
  ok: z.boolean(),
  /** TaalcutError code when it failed, e.g. 'models.auth_invalid'. */
  errorCode: z.string().optional(),
});
export type AccountCheck = z.infer<typeof accountCheckSchema>;

export const localServerCheckSchema = accountCheckSchema.extend({ models: z.int().nonnegative().optional() });
export type LocalServerCheck = z.infer<typeof localServerCheckSchema>;

export const accountsStateSchema = z.object({
  chatgpt: z.object({
    signedIn: z.boolean(),
    /** Kept separately because the chat token-sharing route does not support image generation. */
    imagesSignedIn: z.boolean().optional(),
    /** OpenAI's usage page for the plan; the "Manage usage" link. */
    manageUsageUrl: z.url(),
  }),
  subscriptions: z.array(
    z.object({
      provider: z.enum(WARNED_LOGINS),
      signedIn: z.boolean(),
      warning: signInWarningSchema,
      /** When the user acknowledged the warning card, if they have (epoch ms). */
      acknowledgedAt: z.int().nonnegative().optional(),
      /**
       * Round P3-3: the service's own page for the plan's usage, when it has one (Settings › Usage ›
       * Subscriptions). Main fills it from a fixed table; a page Taalcut opens (`files.openExternal`).
       */
      usageUrl: externalLinkSchema.optional(),
    }),
  ),
  /** One row per provider that takes an API key. `configured` only: the key itself never comes back. */
  apiKeys: z.array(
    z.object({ provider: z.string(), configured: z.boolean(), lastCheck: accountCheckSchema.optional() }),
  ),
  /**
   * Optional bring-your-own servers (Advanced). Taalcut's own runtime needs no
   * server; these are never a default or a dependency (AGENTS.md).
   */
  localServers: z.array(
    z.object({
      kind: z.enum(LOCAL_SERVER_KINDS),
      /** Absent: not used. */
      baseUrl: z.url().optional(),
      lastCheck: localServerCheckSchema.optional(),
    }),
  ),
  /**
   * P3-V18: stock media keys, apart from model keys so model pickers never list them. setApiKey, testApiKey
   * and removeApiKey take these provider ids too.
   */
  stockKeys: z
    .array(
      z.object({
        provider: z.enum(STOCK_KEY_PROVIDERS),
        configured: z.boolean(),
        /** Off in this build: shown, not settable. */
        available: z.boolean(),
        lastCheck: accountCheckSchema.optional(),
      }),
    )
    .max(STOCK_KEY_PROVIDERS.length)
    .default([]),
  /** Saved on Instagram: optional personal browser login for reading saved collections and Reels. */
  instagram: z
    .object({
      signedIn: z.boolean(),
      username: z.string().min(1).max(120).optional(),
      warning: signInWarningSchema,
      acknowledgedAt: z.int().nonnegative().optional(),
    })
    .optional(),
});
export type AccountsState = z.infer<typeof accountsStateSchema>;

/** Progress of a running sign-in (models' SignInEvent). Device codes are meant to be shown; they aren't secrets. */
export const signInEventSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('browser_opened'), provider: z.string() }),
  z.object({
    type: z.literal('device_code'),
    provider: z.string(),
    userCode: z.string(),
    verificationUri: z.url(),
    expiresInSeconds: z.int().positive().optional(),
  }),
  z.object({ type: z.literal('progress'), provider: z.string(), messageKey: z.string() }),
]);
export type SignInEvent = z.infer<typeof signInEventSchema>;

const providerInput = z.object({ provider: z.string().min(1) });

export const accountsContract = {
  state: ipc.output(accountsStateSchema),
  /** Current state first, then every change (sign-in finishing in the browser, another window). */
  changed: ipc.output(eventIterator(accountsStateSchema)),
  /**
   * Starts a login in the system browser and resolves when it finishes.
   * Warned logins need `acknowledgedAt`, which main stores with the login (PRD 10.1).
   */
  signIn: ipc
    .input(
      z.object({
        // 'openai' is the provider ChatGPT signs in to; both mean Continue with ChatGPT.
        provider: z.enum([CHATGPT_PROVIDER, CHATGPT_IMAGE_PROVIDER, 'openai', ...WARNED_LOGINS, 'instagram']),
        acknowledgedAt: z.int().nonnegative().optional(),
      }),
    )
    .output(accountsStateSchema),
  /** Device codes and progress of sign-ins started from now on (Copilot and Grok show a code). */
  signInEvents: ipc.output(eventIterator(signInEventSchema)),
  signOut: ipc.input(providerInput).output(accountsStateSchema),
  /** Write-only. The key goes to the keychain; the reply says only that one is stored. */
  setApiKey: ipc
    .input(providerInput.extend({ key: z.string().trim().min(8).max(4096) }))
    .output(accountsStateSchema),
  /** A tiny real request with the stored key. */
  testApiKey: ipc.input(providerInput).output(accountCheckSchema),
  removeApiKey: ipc.input(providerInput).output(accountsStateSchema),
  /** baseUrl null: stop using the server. */
  setLocalServer: ipc
    .input(z.object({ kind: z.enum(LOCAL_SERVER_KINDS), baseUrl: z.url().nullable() }))
    .output(accountsStateSchema),
  /** GET <baseUrl>/v1/models; reports how many models answered. */
  testLocalServer: ipc.input(z.object({ kind: z.enum(LOCAL_SERVER_KINDS) })).output(localServerCheckSchema),
};
