// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// P3-B10: the Local-only labels read the models package's own label keys (QUALITY_LABEL_KEYS: the reason, never
// the job), so with the real backend each label still says which job it is about.
import type { ModuleQuality } from '@taalcut/core';
import { beforeAll, describe, expect, it } from 'vitest';
import { qualityLabel } from '../../src/features/settings/privacy/quality-labels';
import { activateLocale, i18n } from '../../src/i18n/i18n';

const label = (quality: Omit<ModuleQuality, 'labelKey'>, labelKey: string) =>
  qualityLabel(i18n, { ...quality, labelKey });

describe('Local-only labels from the models package', () => {
  beforeAll(() => activateLocale('en'));

  it('say the job and what Local only does to it', () => {
    expect(label({ module: 'agent', quality: 'lowerQuality' }, 'models.quality.lowerQuality')).toBe(
      'The agent is simpler on this Mac',
    );
    expect(label({ module: 'voice', quality: 'unavailable' }, 'models.quality.needsInternet')).toBe(
      'Voice is off with Local only',
    );
    expect(label({ module: 'agent', quality: 'unavailable' }, 'models.quality.needsInternet')).toBe(
      'The agent is off with Local only',
    );
  });

  it('tell a job with no model set up apart from one Local only turned off', () => {
    const none = label({ module: 'images', quality: 'unavailable' }, 'models.quality.notConfigured');
    expect(none).toMatch(/no model set up yet$/);
    expect(none).not.toBe(
      label({ module: 'images', quality: 'unavailable' }, 'models.quality.needsInternet'),
    );
  });

  it('name the job for one without its own sentence', () => {
    expect(label({ module: 'router', quality: 'lowerQuality' }, 'models.quality.lowerQuality')).toMatch(
      /: simpler on this Mac$/,
    );
  });
});
