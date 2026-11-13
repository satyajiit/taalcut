// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// UX3-IDX: the component manager sends one key everywhere; a download's error line says it in this system's words.
// A component the hosted list has no build for "isn't available for Linux yet" on Linux, never "for this Mac"; the
// disk-space errors name this computer; on a Mac every line reads as before.
import { I18nProvider } from '@lingui/react';
import { type TaalcutError } from '@taalcut/core';
import { HostPlatformProvider, type HostPlatform } from '@taalcut/ui';
import { render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';
import { DownloadErrorLine } from '../../src/features/downloads/download-error-line';
import { downloadErrorOn } from '../../src/features/downloads/download-messages';
import { activateLocale, i18n } from '../../src/i18n/i18n';

const failure = (code: string, params: Record<string, unknown> = {}): TaalcutError =>
  ({ code, messageKey: `errors.${code}`, retryable: false, params }) as TaalcutError;

function lineOn(platform: HostPlatform, error: TaalcutError): string {
  const { unmount } = render(
    <I18nProvider i18n={i18n}>
      <HostPlatformProvider platform={platform}>
        <DownloadErrorLine error={error} />
      </HostPlatformProvider>
    </I18nProvider>,
  );
  const said = screen.getByRole('alert').textContent ?? '';
  unmount();
  return said;
}

beforeAll(() => activateLocale('en'));

describe('a download’s error line on each system', () => {
  const unsupported = failure('jobs.platform_unsupported', { component: 'ONNX Runtime' });

  it('a component with no build for this system says which system, and that it isn’t there yet', () => {
    expect(lineOn('linux', unsupported)).toContain('ONNX Runtime isn’t available for Linux yet.');
    expect(lineOn('windows', unsupported)).toContain('ONNX Runtime isn’t available for Windows yet.');
    expect(lineOn('mac', unsupported)).toContain('ONNX Runtime isn’t available for this Mac.');
  });

  it('the disk-space errors name this computer off a Mac', () => {
    const disk = failure('jobs.disk_space_low', { component: 'Whisper tiny' });
    expect(lineOn('linux', disk)).toContain('Free up space on this computer and try again.');
    expect(lineOn('mac', disk)).toContain('Free up space on this Mac and try again.');
    const all = failure('jobs.downloads_space_low');
    expect(lineOn('windows', all)).toContain('The models this computer needs don’t fit on its disk.');
  });

  it('every other error keeps its key; the Mac’s keys are unchanged', () => {
    const checksum = failure('jobs.checksum_mismatch', { component: 'Whisper tiny' });
    expect(downloadErrorOn(checksum, 'linux')).toBe(checksum);
    expect(downloadErrorOn(unsupported, 'mac')).toBe(unsupported);
    expect(downloadErrorOn(unsupported, 'linux')).toEqual({
      ...unsupported,
      messageKey: 'errors.jobs.platform_unsupported.linux',
    });
  });
});
