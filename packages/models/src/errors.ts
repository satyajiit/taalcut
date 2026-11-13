// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Every error the models package can return. Each is declared once here so the
 * i18n catalogue check (definedErrorCodes) sees them all. `detail` never holds
 * a secret: provider bodies pass through scrubSecrets before they land here.
 */
import { defineError, SETTINGS_COMMANDS, type FixAction } from '@taalcut/core';

export const openAccounts: FixAction = {
  command: SETTINGS_COMMANDS.openAccounts,
  labelKey: 'fix.openAccounts',
};
const openModels: FixAction = { command: SETTINGS_COMMANDS.openModels, labelKey: 'fix.openModels' };

type ProviderParams = { provider: string; model?: string };

/** No credential (API key, sign-in or local server) is set up for this provider. */
export const ModelNotConfigured = defineError<ProviderParams>('models.not_configured', { fix: openAccounts });
/** The provider rejected the key or token outright (wrong key, revoked access). */
export const ModelAuthInvalid = defineError<ProviderParams>('models.auth_invalid', { fix: openAccounts });
/** A short-lived sign-in token expired mid-flight. The next call fetches a fresh one. */
export const ModelAuthExpired = defineError<ProviderParams>('models.auth_expired', { retryable: true });
/**
 * Too many requests: try again later or switch to the next model in the chain. `resetsAt` (epoch ms): when the
 * provider said the limit lifts (Retry-After or its reset headers), for G8's pause.
 */
export const ModelRateLimited = defineError<ProviderParams & { retryAfterMs?: number; resetsAt?: number }>(
  'models.rate_limited',
  {
    retryable: true,
  },
);
/** The subscription or billing quota is used up. Waiting seconds won't help. `billingUrl`: the provider's page. */
export const ModelQuotaExceeded = defineError<ProviderParams & { resetsAt?: number; billingUrl?: string }>(
  'models.quota_exceeded',
  { fix: openAccounts },
);
/** The provider is down, overloaded or unreachable. */
export const ModelProviderUnavailable = defineError<ProviderParams>('models.provider_unavailable', {
  retryable: true,
});
/** The prompt doesn't fit in the model's context window. */
export const ModelContextTooLong = defineError<ProviderParams>('models.context_too_long');
/** The provider's safety filter stopped the answer. */
export const ModelContentFiltered = defineError<ProviderParams>('models.content_filtered');
/** The provider refused the request as malformed (a bug on our side or an unsupported option). */
export const ModelBadRequest = defineError<ProviderParams>('models.bad_request');
/** Any other provider failure. */
export const ModelProviderError = defineError<ProviderParams>('models.provider_error');
/**
 * The provider/model pair isn't in the registry or pi-ai's catalogue, or the provider turned the model down.
 * `via: 'chatgpt'`: the ChatGPT plan's sign-in did, for a model the API itself has (UX3-AGT).
 */
export const UnknownModel = defineError<ProviderParams & { via?: 'chatgpt' }>('models.unknown_model', {
  fix: openModels,
});
/** The model exists but can't do what the module needs (e.g. no image input for vision). */
export const ModelUnsuitable = defineError<ProviderParams & { module: string; need: string }>(
  'models.model_unsuitable',
  { fix: openModels },
);
/** No usable model is left for a module after skipping retired and out-of-tier choices. */
export const NoModelForModule = defineError<{ module: string }>('models.no_model_for_module', {
  fix: openModels,
});
/** The module isn't a chat module, so ModelClient can't serve it (speech, voice, ...). */
export const UnsupportedModule = defineError<{ module: string }>('models.unsupported_module');
/** The model's retirement date has passed. */
export const ModelRetired = defineError<ProviderParams & { retiredOn: string }>('models.model_retired', {
  fix: openModels,
});
/** A stored or submitted profile didn't validate. */
export const ProfileInvalid = defineError<{ field?: string } | undefined>('models.profile_invalid');
/** No profile with this id. */
export const ProfileNotFound = defineError<{ profile: string }>('models.profile_not_found');
/** Saving or loading model profiles failed. */
export const ProfileStoreFailed = defineError('models.profile_store_failed', { retryable: true });
/** Reading the hardware (sysctl, system_profiler, sw_vers, statfs) failed. */
export const HardwareProbeFailed = defineError<{ step: string }>('models.hardware_probe_failed', {
  retryable: true,
});

/* Sign-in, API keys and local servers (P1-F3, P1-F4, P1-F6). */

/** The browser sign-in failed: the token exchange was refused or the provider sent something unusable. */
export const SignInFailed = defineError<{ provider: string }>('models.sign_in_failed', {
  retryable: true,
  fix: openAccounts,
});
/** Nobody finished the sign-in in the browser in time; nothing was stored. */
export const SignInTimeout = defineError<{ provider: string; seconds: number }>('models.sign_in_timeout', {
  retryable: true,
});
/** The user (or their organisation) declined on the provider's consent page. */
export const SignInDenied = defineError<{ provider: string }>('models.sign_in_denied', { fix: openAccounts });
/** Another app holds the fixed loopback port the provider's sign-in redirects to. */
export const SignInPortBusy = defineError<{ provider: string; port: number }>('models.sign_in_port_busy', {
  retryable: true,
});
/** The stored sign-in can no longer be refreshed (revoked, or the plan ended). Signing in again fixes it. */
export const SignInRequired = defineError<ProviderParams>('models.sign_in_required', { fix: openAccounts });
/** This provider has no sign-in flow (it takes an API key, or nothing). */
export const SignInUnsupported = defineError<{ provider: string }>('models.sign_in_unsupported');
/**
 * A subscription sign-in whose terms may not allow third-party apps needs its
 * warning card read first. Raised through acknowledgementRequired(), whose fix
 * opens that card.
 */
export const AcknowledgementRequired = defineError<{
  provider: string;
  feature: string;
  termsVersion: string;
}>('models.acknowledgement_required');
/** The provider rejected the API key during the test call. Nothing was stored. */
export const ApiKeyInvalid = defineError<{ provider: string }>('models.api_key_invalid', {
  fix: openAccounts,
});
/** The OS keychain (safeStorage) refused to read or write a secret. */
export const SecretStoreFailed = defineError<{ operation: string }>('models.secret_store_failed', {
  retryable: true,
});
/** A local model server (Ollama, LM Studio) didn't answer, or answered with something unexpected. */
export const LocalServerUnreachable = defineError<{ endpoint: string }>('models.local_server_unreachable', {
  retryable: true,
  fix: openModels,
});
/** A local endpoint's settings didn't validate (bad URL, or an id that clashes with a cloud provider). */
export const EndpointInvalid = defineError<{ field: string }>('models.endpoint_invalid');
/** A local server address with a user name or password in it: Taalcut keeps no passwords in settings. */
export const EndpointHasCredentials = defineError<{ field: string }>('models.endpoint_has_credentials');

/** The embedded local runtime isn't installed or running, so its models can't answer now (D16). */
export const LocalRuntimeUnavailable = defineError<{ state: string }>('models.local_runtime_unavailable', {
  retryable: true,
  fix: openModels,
});
/** Installing or starting the embedded local runtime failed, or it kept crashing. */
export const LocalRuntimeFailed = defineError<{ step: string }>('models.local_runtime_failed', {
  retryable: true,
  fix: openModels,
});

/* Image generation (P3-B7). */

/** No configured image route can serve the request, including separate subscription connections. */
export const ImageNoProvider = defineError('models.image_no_provider', { fix: openAccounts });
/** The provider accepted a connection but denied image access for this account. */
export const ImageAccessDenied = defineError<ProviderParams>('models.image_access_denied', {
  fix: openAccounts,
});
/** The provider answered without a usable still: no image, a type we can't read, or the wrong size. */
export const ImageOutputInvalid = defineError<ProviderParams>('models.image_output_invalid', {
  retryable: true,
});

/** The command the UI registers to show a sign-in's warning card (P1-F6). */
export const OPEN_WARNING_CARD_COMMAND = SETTINGS_COMMANDS.openSignInWarning;

export function acknowledgementRequired(provider: string, feature: string, termsVersion: string) {
  return AcknowledgementRequired(
    { provider, feature, termsVersion },
    {
      fix: {
        command: OPEN_WARNING_CARD_COMMAND,
        labelKey: 'fix.reviewSignInWarning',
        payload: { feature, termsVersion },
      },
    },
  );
}
