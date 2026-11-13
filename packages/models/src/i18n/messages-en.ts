// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * English source text for the keys this package hands to the UI: accounts and
 * sign-in, warning cards, and error messages. The renderer's Lingui catalogue
 * imports these; the loopback callback page uses them directly because it is
 * served to the system browser, outside the renderer. Brand names stay as is.
 */
import { ELEVENLABS_MESSAGES_EN } from '../elevenlabs/messages-en';
import { TRANSLATE_MESSAGES_EN } from '../translate/messages-en';

export const MODELS_MESSAGES_EN: Readonly<Record<string, string>> = {
  // ElevenLabs and caption translation (P3-B6, P3-V6, P3-V20).
  ...ELEVENLABS_MESSAGES_EN,
  ...TRANSLATE_MESSAGES_EN,
  // Accounts (P1-F3, P1-F4).
  'models.signin.chatgpt.continue': 'Continue with ChatGPT',
  'models.signin.chatgptImages.continue': 'Connect ChatGPT images',
  'models.signin.claude.continue': 'Continue with Claude Pro or Max',
  'models.signin.copilot.continue': 'Continue with GitHub Copilot',
  'models.signin.grok.continue': 'Sign in with SuperGrok or X Premium',
  'models.account.chatgpt.usingPlan': 'Using ChatGPT plan',
  'models.account.chatgptImages.usingPlan': 'Using ChatGPT plan for images',
  'models.account.claude.usingPlan': 'Using Claude plan',
  'models.account.copilot.usingPlan': 'Using GitHub Copilot plan',
  'models.account.grok.usingPlan': 'Using SuperGrok or X Premium',
  'models.account.manageUsage': 'Manage usage',
  'models.account.usingApiKey': 'Using API key',
  'models.account.signedIn': 'Signed in',
  'models.account.notConnected': 'Not connected',
  'models.account.signOut': 'Sign out',
  'models.signin.waitingForBrowser': 'Finish signing in in your browser.',
  'models.signin.deviceCode': 'Enter code {userCode} at {verificationUri}',
  'models.signin.exchanging': 'Finishing sign-in…',
  // The page the browser shows when a sign-in comes back (signin/callback-page.ts, UX3-AGT).
  'models.signin.callback.title': 'Taalcut',
  'models.signin.callback.close': 'This page comes from Taalcut on this computer, not from a website.',
  'models.signin.callback.status.done': 'Signed in with ChatGPT',
  'models.signin.callback.status.failed': 'Not signed in',
  'models.signin.callback.signed_in.title': 'You’re signed in',
  'models.signin.callback.signed_in.body':
    'Taalcut now uses your ChatGPT plan. You can close this tab and return to Taalcut.',
  'models.signin.callback.denied.title': 'Sign-in was declined',
  'models.signin.callback.denied.body':
    'ChatGPT didn’t give Taalcut access, so nothing was kept. To try again, go back to Taalcut and choose Continue with ChatGPT.',
  'models.signin.callback.state_mismatch.title': 'This sign-in link is out of date',
  'models.signin.callback.state_mismatch.body':
    'It doesn’t belong to the sign-in Taalcut is waiting for, so Taalcut ignored it. Finish in the tab Taalcut opened last, or start again from Taalcut.',
  'models.signin.callback.timeout.title': 'This sign-in timed out',
  'models.signin.callback.timeout.body':
    'Taalcut stopped waiting before the browser came back, so nothing was kept. Go back to Taalcut and choose Continue with ChatGPT to start again.',
  'models.signin.callback.exchange_failed.title': 'Sign-in didn’t finish',
  'models.signin.callback.exchange_failed.body':
    'ChatGPT said yes, but Taalcut couldn’t get access from OpenAI, so nothing was kept. Go back to Taalcut, which says what went wrong, and try again.',
  'models.signin.callback.failed.title': 'Sign-in didn’t finish',
  'models.signin.callback.failed.body':
    'Something went wrong between ChatGPT and Taalcut, so nothing was kept. Close this tab and try again from Taalcut.',
  'models.apiKey.testing': 'Checking the key with a small test request…',

  // Warning cards for subscription sign-ins whose terms may not cover Taalcut (P1-F6).
  'models.warning.claude.title': 'Using your Claude plan in Taalcut',
  'models.warning.claude.body':
    'Anthropic sells Claude Pro and Max for its own apps. To use your plan here, Taalcut signs in the way Claude Code does and then presents itself to Anthropic as Claude Code: every request says it comes from Claude Code (its name, version and app headers), starts with Claude Code’s opening system line, and renames Taalcut’s tools that share a name with Claude Code’s tools to Claude Code’s spelling.',
  'models.warning.claude.risk':
    'Anthropic’s terms may not allow this. Anthropic could block these requests or limit your account. An Anthropic API key, a ChatGPT plan or a local model avoids this.',
  'models.warning.copilot.title': 'Using your GitHub Copilot plan in Taalcut',
  'models.warning.copilot.body':
    'GitHub Copilot sign-in uses the sign-in GitHub built for Copilot Chat in VS Code. Taalcut then presents itself to GitHub as VS Code’s Copilot Chat extension: its app id and its VS Code and extension version headers.',
  'models.warning.copilot.risk':
    'GitHub’s terms may not allow this. GitHub could block these requests or limit your Copilot access. A GitHub Models or OpenAI API key avoids this.',
  'models.warning.grok.title': 'Using SuperGrok or X Premium in Taalcut',
  'models.warning.grok.body':
    'Taalcut uses the xAI subscription sign-in provided by pi-ai. xAI supports subscription access in external agents, including image generation. Requests use the allowance available to your account.',
  'models.warning.grok.risk':
    'Image generation consumes plan usage. Available models, account access and remaining limits are controlled by xAI. Taalcut will show an access or quota error instead of silently switching to paid API calls.',
  'models.warning.accept': 'I understand, continue',
  'models.warning.cancel': 'Not now',

  // Where a local model runs (ADR 0002) and what the hardware allows (P1-E4).
  'models.compute.metal': 'GPU (Metal)',
  'models.compute.mlx': 'GPU (MLX)',
  'models.compute.coreml': 'Core ML',
  'models.compute.ane': 'Neural Engine',
  'models.compute.webgpu': 'GPU (WebGPU)',
  'models.compute.cuda': 'GPU (CUDA)',
  'models.compute.rocm': 'GPU (ROCm)',
  'models.compute.directml': 'GPU (DirectML)',
  'models.compute.vulkan': 'GPU (Vulkan)',
  'models.compute.cpu': 'CPU, slower',
  'models.compute.cpuReason.no_accelerated_backend': 'This model has no GPU version.',
  'models.compute.cpuReason.hardware_lacks_backend': 'This computer has no GPU this model can use.',
  'models.compute.cpuReason.gpu_failed_at_runtime':
    'The GPU didn’t work for this model, so it runs on the CPU.',
  'models.compute.cpuReason.disabled': 'The GPU is turned off (TAALCUT_FORCE_CPU), so it runs on the CPU.',
  'models.localRuntime.name': 'On-device',
  'models.localRuntime.ownServer': 'Your own server (Advanced)',
  'models.note.pending_runtime': 'Arrives with the built-in local runtime.',
  'models.tier.minimum.label': 'Minimum',
  'models.tier.recommended.label': 'Recommended',
  'models.tier.high.label': 'High',
  'models.hardware.not_apple_silicon': 'Taalcut needs a Mac with Apple silicon.',
  'models.hardware.macos_too_old': 'Taalcut needs macOS 14 or later.',
  'models.hardware.os_too_old': 'Taalcut needs Ubuntu 22.04 or later.',
  'models.hardware.memory_low': 'Taalcut needs at least 8 GB of memory.',
  'models.hardware.disk_low': 'Taalcut needs at least 20 GB of free disk space.',
  'models.hardware.no_gpu_for_local_models':
    'Local models would run on the CPU here, so cloud models come first.',
  'models.hardware.gpu_driver_old':
    'The NVIDIA driver is older than version 580, so local models can’t use CUDA. Update the driver to run them on the GPU.',

  // Fix buttons.
  'fix.openAccounts': 'Open accounts',
  'fix.openModels': 'Open model settings',
  'fix.reviewSignInWarning': 'Read the warning',

  // Errors.
  'errors.models.not_configured': 'Set up {provider} in Accounts first.',
  'errors.models.auth_invalid': '{provider} didn’t accept the key or sign-in.',
  'errors.models.auth_expired': 'The {provider} sign-in expired. Taalcut will renew it on the next try.',
  'errors.models.rate_limited': '{provider} is getting too many requests. Try again shortly.',
  'errors.models.quota_exceeded': 'Your {provider} plan or credit is used up.',
  'errors.models.provider_unavailable': '{provider} isn’t answering right now.',
  'errors.models.context_too_long': 'This is too long for {model}.',
  'errors.models.content_filtered': '{provider}’s safety filter stopped the answer.',
  'errors.models.bad_request': '{provider} refused the request.',
  'errors.models.provider_error': 'Something went wrong at {provider}.',
  'errors.models.unknown_model':
    '{provider} didn’t accept the model {model}. Pick another in Settings › Models.',
  'errors.models.model_unsuitable': '{model} can’t do what {module} needs.',
  'errors.models.no_model_for_module': 'No model is set up for {module}.',
  'errors.models.unsupported_module': '{module} doesn’t use a chat model.',
  'errors.models.model_retired': '{model} was retired on {retiredOn}.',
  'errors.models.profile_invalid': 'This model profile isn’t valid.',
  'errors.models.profile_not_found': 'There’s no model profile called {profile}.',
  'errors.models.profile_store_failed': 'Couldn’t save model settings.',
  'errors.models.hardware_probe_failed': 'Couldn’t read this computer’s hardware.',
  'errors.models.sign_in_failed': 'Signing in to {provider} didn’t work. Try again.',
  'errors.models.sign_in_timeout': 'Sign-in timed out after {seconds} seconds.',
  'errors.models.sign_in_denied': 'Access to {provider} was declined.',
  'errors.models.sign_in_port_busy': 'Another app is using port {port}, which {provider} sign-in needs.',
  'errors.models.sign_in_required': 'Sign in to {provider} again.',
  'errors.models.sign_in_unsupported': '{provider} doesn’t offer sign-in. Add an API key instead.',
  'errors.models.acknowledgement_required': 'Read the warning about {provider} sign-in first.',
  'errors.models.api_key_invalid': '{provider} didn’t accept this API key.',
  'errors.models.secret_store_failed': 'Couldn’t reach the keychain or keyring that keeps your keys.',
  'errors.models.local_server_unreachable': 'Couldn’t reach the local model server at {endpoint}.',
  'errors.models.local_runtime_unavailable': 'On-device models aren’t ready yet ({state}).',
  'errors.models.local_runtime_failed': 'On-device models couldn’t start ({step}).',
  'errors.models.endpoint_invalid': 'Check the local server settings ({field}).',
  'errors.models.endpoint_has_credentials':
    'Leave the user name and password out of the server address. Taalcut doesn’t keep passwords for local servers.',
  'errors.models.image_no_provider':
    'No connected image provider is available. Connect ChatGPT images or Grok, or add an image-provider API key in Settings › Accounts.',
  'errors.models.image_access_denied':
    '{provider} denied image access for this account. Check the plan and image access in Settings › Accounts.',
  'errors.models.image_output_invalid': '{provider} sent back an image Taalcut couldn’t use. Try again.',

  // Quality labels per module (P3-B10).
  'models.quality.full': 'Full quality',
  'models.quality.lowerQuality': 'Lower quality on this computer',
  'models.quality.needsInternet': 'Needs internet',
  'models.quality.notConfigured': 'No model set up',
};
