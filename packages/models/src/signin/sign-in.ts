// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Runs one provider's sign-in through pi-ai's `Models.login`, in the main
 * process. pi-ai's flows talk to the user through an interaction object; this
 * file answers it: browser URLs go to the injected openExternal (Electron's
 * shell.openExternal), device codes and progress go to the UI as events, and
 * the prompts pi-ai's flows ask are answered with Taalcut's fixed choices.
 */
import type { AuthEvent, AuthInteraction, AuthPrompt, MutableModels } from '@earendil-works/pi-ai';
import { err, ok, type AsyncResult } from '@taalcut/core';
import { authFailure } from '../credentials/failures';
import { acknowledgementRequired, SignInUnsupported } from '../errors';
import { isLoopbackUrl } from '../runtime/endpoints';
import { SignInFlowError } from './oauth';
import { signInOption, type AcknowledgementStore } from './options';

/** Renderer-safe progress of a running sign-in. Device codes are meant to be shown; they are not secrets. */
export type SignInEvent =
  | { readonly type: 'browser_opened'; readonly provider: string }
  | {
      readonly type: 'device_code';
      readonly provider: string;
      readonly userCode: string;
      readonly verificationUri: string;
      readonly expiresInSeconds?: number;
    }
  | { readonly type: 'progress'; readonly provider: string; readonly messageKey: string };

export interface SignInRequest {
  readonly signal?: AbortSignal;
  /** GitHub Enterprise domain for Copilot; blank means github.com. */
  readonly enterpriseDomain?: string;
}

/** What a sign-in needs of pi-ai's model registry: its providers' auth, and the login itself. */
export interface SignInModels {
  getProvider(provider: string): { readonly auth: { readonly oauth?: unknown } } | undefined;
  login: MutableModels['login'];
}

export interface SignInDeps {
  readonly models: SignInModels;
  /** Opens a URL in the system browser. Only https URLs (and http on loopback, for tests) are passed. */
  readonly openExternal: (url: string) => void | Promise<void>;
  readonly acknowledgements?: AcknowledgementStore;
  readonly onEvent?: (event: SignInEvent) => void;
  readonly deviceId: () => AsyncResult<string>;
  readonly agentName: string;
  readonly timeoutMs: number;
  readonly secrets: () => readonly string[];
}

export async function runSignIn(
  deps: SignInDeps,
  provider: string,
  request: SignInRequest,
): AsyncResult<void> {
  const option = signInOption(provider);
  if (!option || !deps.models.getProvider(provider)?.auth.oauth) return err(SignInUnsupported({ provider }));
  if (option.warning) {
    const { feature, termsVersion } = option.warning;
    const acknowledged = deps.acknowledgements
      ? await deps.acknowledgements.has(feature, termsVersion)
      : ok(false);
    if (!acknowledged.ok) return acknowledged;
    if (!acknowledged.value) return err(acknowledgementRequired(provider, feature, termsVersion));
  }
  const deviceId = await deps.deviceId();
  if (!deviceId.ok) return deviceId;

  const controller = new AbortController();
  const cancel = () => controller.abort(new SignInFlowError('cancelled', 'Sign-in cancelled.'));
  request.signal?.addEventListener('abort', cancel, { once: true });
  if (request.signal?.aborted) cancel();
  // pi-ai's own flows can wait forever on a callback that never comes; this bounds all of them.
  const timer = setTimeout(
    () =>
      controller.abort(
        new SignInFlowError('timeout', 'The sign-in took too long.', {
          seconds: Math.round(deps.timeoutMs / 1000),
        }),
      ),
    deps.timeoutMs,
  );
  const emit = (event: SignInEvent) => deps.onEvent?.(event);
  const open = (url: string) => {
    if (!isSafeToOpen(url)) {
      controller.abort(new SignInFlowError('invalid_response', 'The sign-in URL is not https.'));
      return;
    }
    void Promise.resolve()
      .then(() => deps.openExternal(url))
      .catch(() => controller.abort(new SignInFlowError('network', 'Could not open the browser.')));
  };

  const interaction: AuthInteraction = {
    signal: controller.signal,
    notify(event: AuthEvent) {
      if (event.type === 'auth_url') {
        open(event.url);
        emit({ type: 'browser_opened', provider });
      } else if (event.type === 'device_code') {
        open(event.verificationUri);
        emit({
          type: 'device_code',
          provider,
          userCode: event.userCode,
          verificationUri: event.verificationUri,
          ...(event.expiresInSeconds !== undefined ? { expiresInSeconds: event.expiresInSeconds } : {}),
        });
      } else if (event.type === 'progress') {
        emit({ type: 'progress', provider, messageKey: 'models.signin.exchanging' });
      }
    },
    prompt: (prompt) => answer(prompt, request, controller.signal),
  };

  try {
    await deps.models.login(provider, 'oauth', interaction, {
      getDeviceId: () => deviceId.value,
      agentName: deps.agentName,
    });
    return ok(undefined);
  } catch (cause) {
    return err(authFailure(provider, cause, 'sign_in', deps.secrets()));
  } finally {
    clearTimeout(timer);
    request.signal?.removeEventListener('abort', cancel);
    // Stops a flow still running after the race above was lost (its callback server, its polling).
    if (!controller.signal.aborted) controller.abort(new SignInFlowError('cancelled', 'Sign-in finished.'));
  }
}

/** Taalcut's fixed answers to the questions pi-ai's sign-in flows ask. */
function answer(prompt: AuthPrompt, request: SignInRequest, signal: AbortSignal): Promise<string> {
  switch (prompt.type) {
    case 'select':
      // Claude asks browser vs copy-code; the browser login is listed first.
      return Promise.resolve(prompt.options[0]?.id ?? '');
    case 'text':
      // Copilot's only question: the GitHub Enterprise domain.
      return Promise.resolve(request.enterpriseDomain ?? '');
    case 'manual_code':
      // Raced against the loopback callback; we never show a paste box, so wait to be cancelled.
      return new Promise<string>((_, reject) => {
        const stop = () => reject(new SignInFlowError('cancelled', 'Manual code entry not offered.'));
        const signals = [signal, prompt.signal].filter((s): s is AbortSignal => s !== undefined);
        if (signals.some((s) => s.aborted)) return stop();
        for (const s of signals) s.addEventListener('abort', stop, { once: true });
      });
    case 'secret':
      return Promise.reject(new SignInFlowError('invalid_response', 'Sign-in asked for a secret.'));
  }
}

function isSafeToOpen(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === 'https:' || (protocol === 'http:' && isLoopbackUrl(url));
  } catch {
    return false;
  }
}
