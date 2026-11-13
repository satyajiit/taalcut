// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// UX3-MAC: a Mac sentence keeps its id and text, and off a Mac its id carries the computer's (or Windows') compiled
// words; what differs in kind (cable import, Local Network, System Settings) is decided per platform in one place.
import { describe, expect, it } from 'vitest';
import {
  fixOn,
  macKey,
  onPlatform,
  platformFeatures,
  platformWordsById,
  platformWordsOf,
  withPlatformWords,
  type PlatformWords,
} from '../src';

const reveal: PlatformWords = {
  mac: { id: 'reveal', message: 'Show in Finder' },
  computer: { id: 'reveal.computer', message: 'Show in Files' },
  windows: { id: 'reveal.windows', message: 'Show in File Explorer' },
};
const device: PlatformWords = { mac: macKey('device'), computer: { id: 'device.computer' } };
const MESSAGES = {
  reveal: 'Show in Finder',
  'reveal.computer': 'Show in Files',
  'reveal.windows': 'Show in File Explorer',
  device: 'This Mac (H.264)',
  'device.computer': 'This computer (H.264)',
  other: 'Untouched',
};

describe('platform words', () => {
  it('leaves a Mac’s catalogue as it is', () => {
    expect(withPlatformWords(MESSAGES, 'mac', [reveal, device])).toBe(MESSAGES);
    expect(platformWordsById([reveal], 'mac').size).toBe(0);
  });

  it('puts the computer’s words under the Mac’s id on Linux, and Windows’ own where it has them', () => {
    const linux = withPlatformWords(MESSAGES, 'linux', [reveal, device]);
    expect([linux.reveal, linux.device, linux.other]).toEqual([
      'Show in Files',
      'This computer (H.264)',
      'Untouched',
    ]);
    const windows = withPlatformWords(MESSAGES, 'windows', [reveal, device]);
    expect([windows.reveal, windows.device]).toEqual(['Show in File Explorer', 'This computer (H.264)']);
    expect(MESSAGES.reveal).toBe('Show in Finder');
  });

  it('keeps the Mac’s words where a catalogue lacks the computer’s', () => {
    expect(withPlatformWords({ device: 'This Mac (H.264)' }, 'linux', [device]).device).toBe(
      'This Mac (H.264)',
    );
  });

  it('chooses by platform, for a descriptor or anything else', () => {
    expect(platformWordsOf(reveal, 'windows')).toBe(reveal.windows);
    expect(platformWordsOf(device, 'windows')).toBe(device.computer);
    expect(platformWordsById([reveal], 'linux').get('reveal')).toBe(reveal.computer);
    expect(['mac', 'linux', 'windows'].map((p) => onPlatform(p as 'mac', { mac: 1, computer: 2 }))).toEqual([
      1, 2, 2,
    ]);
  });
});

describe('platform features', () => {
  it('keeps cable import, Local Network and System Settings to a Mac', () => {
    expect(platformFeatures('mac')).toEqual({
      cableImport: true,
      localNetworkPrivacy: true,
      systemSettingsPanes: true,
    });
    for (const platform of ['linux', 'windows'] as const) {
      expect(Object.values(platformFeatures(platform)).some(Boolean), platform).toBe(false);
    }
  });

  it('drops a fix that opens System Settings off a Mac, and keeps every other', () => {
    const storage = { command: 'system.openStorage', labelKey: 'fix.openStorageSettings' } as const;
    const retry = { command: 'library.recheckFolder', labelKey: 'fix.retry' } as const;
    expect(fixOn(storage, 'mac')).toBe(storage);
    expect(fixOn(storage, 'linux')).toBeUndefined();
    expect(fixOn(retry, 'linux')).toBe(retry);
    expect(fixOn(undefined, 'mac')).toBeUndefined();
  });
});
