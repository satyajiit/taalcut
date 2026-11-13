// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// LIB1-OEM: the facts card's camera and time rows. A clip's local time is the time where it was shot: the owner's
// Galaxy clip (offset +0200 in its file) reads 11:30, and a camera app's clip (its zone borrowed from the Galaxy's)
// reads 9:15, probably at GMT+2 (synthetic values). A clip whose zone nothing names says it is shown in yours.
import { I18nProvider } from '@lingui/react';
import type { AssetDetail, MediaFacts } from '@taalcut/core';
import { render, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it } from 'vitest';
import { CLIP_FIXTURE } from '../src/features/library/clip/clip-fixture';
import {
  cameraDetail,
  cameraWords,
  captureDateTime,
  offsetZone,
  zoneName,
} from '../src/features/library/clip/inspector/capture-words';
import { ClipCamera, ClipWhen } from '../src/features/library/clip/inspector/clip-capture';
import { activateLocale, i18n } from '../src/i18n/i18n';

beforeAll(() => activateLocale('en'));

const GALAXY_AT = Date.UTC(2026, 2, 14, 9, 30, 0);
const APP_AT = Date.UTC(2026, 2, 14, 7, 15, 0);

function clip(asset: Partial<AssetDetail['asset']>, facts: Partial<MediaFacts> = {}): AssetDetail {
  return {
    ...CLIP_FIXTURE,
    asset: { ...CLIP_FIXTURE.asset, ...asset },
    facts: CLIP_FIXTURE.facts ? { ...CLIP_FIXTURE.facts, ...facts } : null,
  };
}

const inEnglish = (node: React.ReactNode) => render(<I18nProvider i18n={i18n}>{node}</I18nProvider>);

describe('capture words', () => {
  it('write an offset as Intl takes it', () => {
    expect([120, 330, -210, 0, 840, -720].map(offsetZone)).toEqual([
      '+02:00',
      '+05:30',
      '-03:30',
      '+00:00',
      '+14:00',
      '-12:00',
    ]);
  });

  it('give the time where it was shot, and name the zone', () => {
    expect(captureDateTime(i18n, GALAXY_AT, { minutes: 120, from: 'file' })).toBe('Mar 14, 2026, 11:30 AM');
    expect(captureDateTime(i18n, APP_AT, { minutes: 120, from: 'nearby' })).toBe('Mar 14, 2026, 9:15 AM');
    expect(zoneName(i18n, GALAXY_AT, 120)).toBe('GMT+2');
    expect(zoneName(i18n, GALAXY_AT, 330)).toBe('GMT+5:30');
  });

  it("put Samsung's model number, or Apple's lens without the phone's name, under the camera", () => {
    expect(cameraDetail({ make: 'Samsung', model: 'Galaxy Example', modelCode: 'SM-X000Z' })).toBe(
      'SM-X000Z',
    );
    expect(cameraDetail({ model: 'iPhone 14 Pro', lens: 'iPhone 14 Pro back camera 2.22mm f/2.2' })).toBe(
      'back camera 2.22mm f/2.2',
    );
    expect(cameraDetail({ lens: 'Wide 24mm' })).toBe('Wide 24mm');
    expect(cameraDetail({ make: 'Google', model: 'Pixel 9 Pro' })).toBeNull();
  });
});

describe('camera words', () => {
  it("leave out an app's unknown device code: the app stands alone", () => {
    const words = cameraWords({ app: 'Sample Cam', appDevice: 'ZQ7' });
    expect(words).toEqual({ camera: null, app: 'Sample Cam', detail: null });
    expect(JSON.stringify(words)).not.toContain('ZQ7');
  });

  it("leave it out beside a named camera too, and keep the camera's own detail", () => {
    const words = cameraWords({
      make: 'Samsung',
      model: 'Galaxy Example',
      modelCode: 'SM-X000Z',
      app: 'Sample Cam',
      appDevice: 'ZQ7',
    });
    expect(words).toEqual({ camera: 'Samsung Galaxy Example', app: 'Sample Cam', detail: 'SM-X000Z' });
    expect(JSON.stringify(words)).not.toContain('ZQ7');
  });

  it('name nothing when the file names neither a camera nor an app, a device code alone included', () => {
    expect(cameraWords(undefined)).toBeNull();
    expect(cameraWords({ appDevice: 'ZQ7' })).toBeNull();
    expect(cameraWords({ app: '  ', appDevice: 'ZQ7' })).toBeNull();
  });
});

describe('the camera row', () => {
  it('names a Galaxy with its model number', () => {
    inEnglish(
      <ClipCamera
        detail={clip({}, { device: { make: 'Samsung', model: 'Galaxy Example', modelCode: 'SM-X000Z' } })}
      />,
    );
    expect(screen.getByText('Samsung Galaxy Example')).toBeTruthy();
    expect(screen.getByText('SM-X000Z')).toBeTruthy();
  });

  it('says a file an app wrote came from that app, on its own: no device code, no maker', () => {
    const { container } = inEnglish(
      <ClipCamera detail={clip({}, { device: { app: 'Sample Cam', appDevice: 'XC01' } })} />,
    );
    expect(container.textContent).toBe('From the Sample Cam app');
    expect(container.textContent).not.toContain('XC01');
    expect(container.textContent).not.toMatch(/Samsung|glasses/);
  });

  it("marks the phone's own name for its capture mode", () => {
    const { container } = inEnglish(
      <ClipCamera
        detail={clip({}, { device: { make: 'Apple', model: 'iPhone 16 Pro' }, captureMode: 'Time-lapse' })}
      />,
    );
    expect(container.textContent).toContain('Time-lapse');
  });

  it('is left out when the file names no camera and no app', () => {
    const { container } = inEnglish(<ClipCamera detail={clip({}, { device: undefined })} />);
    expect(container.textContent).toBe('');
  });
});

describe('the time row', () => {
  it('a Galaxy clip: 11:30, GMT+2, from its own file', () => {
    const { container } = inEnglish(
      <ClipWhen detail={clip({ capturedAt: GALAXY_AT, captureOffset: { minutes: 120, from: 'file' } })} />,
    );
    expect(container.textContent).toContain('Mar 14, 2026, 11:30 AM');
    expect(container.textContent).toContain('Filmed at GMT+2');
    expect(container.textContent).not.toContain('probably');
  });

  it('a camera app’s clip: 9:15, probably GMT+2, like the clips around it', () => {
    const { container } = inEnglish(
      <ClipWhen detail={clip({ capturedAt: APP_AT, captureOffset: { minutes: 120, from: 'nearby' } })} />,
    );
    expect(container.textContent).toContain('Mar 14, 2026, 9:15 AM');
    expect(container.textContent).toContain('Filmed probably at GMT+2, like the clips around it');
  });

  it('says a time no zone names is in your time zone, and a clip with no time when it was added', () => {
    const known = inEnglish(<ClipWhen detail={clip({ capturedAt: APP_AT, captureOffset: null })} />);
    expect(known.container.textContent).toContain('Filmed, shown in your time zone');
    known.unmount();
    const added = inEnglish(<ClipWhen detail={clip({ capturedAt: null })} />);
    expect(added.container.textContent).toContain('Added to Taalcut');
  });

  it('says Taken for a photo', () => {
    const { container } = inEnglish(
      <ClipWhen
        detail={clip({
          kind: 'image',
          capturedAt: GALAXY_AT,
          captureOffset: { minutes: 330, from: 'file' },
        })}
      />,
    );
    expect(container.textContent).toContain('Taken at GMT+5:30');
  });
});
