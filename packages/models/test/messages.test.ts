// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Every key this package hands the UI has English source text. */
import { definedErrorCodes, HARDWARE_SHORTFALLS, type ErrorDefinition } from '@taalcut/core';
import { describe, expect, it } from 'vitest';
import { COMPUTE_BACKENDS, HARDWARE_TIERS, MODELS_MESSAGES_EN, SIGN_IN_OPTIONS } from '@taalcut/models';

describe('English catalogue', () => {
  it('covers every models error and its fix button', async () => {
    const errors = await import('@taalcut/models');
    const codes = definedErrorCodes().filter((code) => code.startsWith('models.'));
    expect(codes.length).toBeGreaterThan(25);
    for (const code of codes) expect(MODELS_MESSAGES_EN[`errors.${code}`], code).toBeTruthy();
    // Error definitions are the exports with a `code` and an `is` guard.
    const definitions = (Object.values(errors) as unknown[]).filter(
      (value): value is ErrorDefinition => typeof value === 'function' && 'code' in value && 'is' in value,
    );
    expect(definitions.length).toBe(codes.length);
    for (const define of definitions) {
      const fix = define().fix;
      if (fix) expect(MODELS_MESSAGES_EN[fix.labelKey], fix.labelKey).toBeTruthy();
    }
    expect(MODELS_MESSAGES_EN[errors.acknowledgementRequired('a', 'b', 'c').fix!.labelKey]).toBeTruthy();
  });

  it('covers every compute backend, CPU reason, tier and hardware shortfall', () => {
    const keys = [
      ...COMPUTE_BACKENDS.map((b) => `models.compute.${b}`),
      'models.compute.cpuReason.no_accelerated_backend',
      'models.compute.cpuReason.hardware_lacks_backend',
      ...HARDWARE_TIERS.map((t) => `models.tier.${t}.label`),
      // Core's list, so a shortfall added there (LNX1: os_too_old, gpu_driver_old) needs its text here.
      ...HARDWARE_SHORTFALLS.map((s) => `models.hardware.${s}`),
    ];
    for (const key of keys) expect(MODELS_MESSAGES_EN[key], key).toBeTruthy();
  });

  it('covers every sign-in option, with the exact ChatGPT button text', () => {
    for (const option of SIGN_IN_OPTIONS) {
      expect(MODELS_MESSAGES_EN[option.labelKey], option.labelKey).toBeTruthy();
      expect(MODELS_MESSAGES_EN[option.planLabelKey], option.planLabelKey).toBeTruthy();
    }
    expect(MODELS_MESSAGES_EN['models.signin.chatgpt.continue']).toBe('Continue with ChatGPT');
    expect(MODELS_MESSAGES_EN['models.account.chatgpt.usingPlan']).toBe('Using ChatGPT plan');
    expect(MODELS_MESSAGES_EN['models.account.manageUsage']).toBe('Manage usage');
  });
});
