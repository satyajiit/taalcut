// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// The export's music (REF1, the owner's decision of 2026-10-29): the reel's music is on by default, one line says
// platforms may mute music added outside their apps, and a switch turns it off, which shows the add-this-sound steps
// with the reel's link and sound. No warning stands before the reel's music any more.
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import type { MusicPath, PlatformSoundSteps } from '@taalcut/core';
import { fireEvent, render as renderBare, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { MusicPathPicker, type MusicPathPickerProps } from '../src/index';

const LINK = 'https://www.instagram.com/reel/EXAMPLE123/';
const STEPS: PlatformSoundSteps = {
  referenceUrl: LINK,
  soundLabel: 'Example Song · Example Artist',
  steps: (['reels', 'shorts', 'tiktok'] as const).map((platform) => ({
    platform,
    stepKeys: [1, 2, 3, 4].map((n) => `music.platformSound.steps.${platform}.${n}`),
  })),
};

const render = (node: ReactNode) => renderBare(<I18nProvider i18n={i18n}>{node}</I18nProvider>);

/** The picker with its value held as the caller holds it: a choice lands, then shows. */
function Picker({
  start,
  onChange,
  ...props
}: Partial<MusicPathPickerProps> & { start: MusicPath; onChange: (path: MusicPath) => void }) {
  const [value, setValue] = useState<MusicPath>(start);
  return (
    <MusicPathPicker
      value={value}
      onChange={(path) => {
        onChange(path);
        setValue(path);
      }}
      referenceAudio={{ available: true }}
      ownTrack={{ available: false }}
      platformSound={STEPS}
      platform="reels"
      {...props}
    />
  );
}

const music = () => screen.getByRole('switch', { name: 'Music in the video' });
const steps = () => screen.queryByRole('region', { name: 'Add the sound in the app' });
const shownSteps = () =>
  document.querySelector('[data-slot=platform-sound-steps]')!.closest('[data-slot=collapse]');

describe('the export’s music', () => {
  it('keeps original sound without suggesting a platform sound, including after toggling music', () => {
    const onChange = vi.fn();
    render(<Picker start="none" onChange={onChange} />);
    expect(music().getAttribute('aria-checked')).toBe('false');
    expect(steps()).toBeNull();
    expect(screen.getByText('Keep the source sound without adding music.')).toBeTruthy();
    fireEvent.click(music());
    expect(onChange).toHaveBeenLastCalledWith('referenceAudio');
    fireEvent.click(music());
    expect(onChange).toHaveBeenLastCalledWith('none');
    expect(steps()).toBeNull();
  });
  it('is the reel’s music by default, with its one line and no warning', () => {
    render(<Picker start="referenceAudio" onChange={vi.fn()} />);
    expect(music().getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText('Instagram and YouTube may mute music added outside their apps.')).toBeTruthy();
    const reel = screen.getByRole('radio', { name: /The reel’s music/ });
    expect(reel.getAttribute('aria-checked')).toBe('true');
    // The sound as the platform credited it, as written.
    expect(within(reel).getByText('Example Song · Example Artist').getAttribute('translate')).toBe('no');
    expect(screen.queryByRole('button', { name: 'I understand' })).toBeNull();
    expect(screen.queryByText(/Before you keep/)).toBeNull();
    // The steps wait, closed and inert, until the music goes off.
    expect(shownSteps()?.getAttribute('data-state')).toBe('closed');
  });

  it('turns off, showing the steps for the export’s app with the reel’s link; on again brings the music back', () => {
    const onChange = vi.fn();
    render(<Picker start="referenceAudio" onChange={onChange} />);
    fireEvent.click(music());
    expect(onChange).toHaveBeenLastCalledWith('platformSound');
    expect(music().getAttribute('aria-checked')).toBe('false');
    expect(shownSteps()?.getAttribute('data-state')).toBe('open');
    const region = steps()!;
    expect(within(region).getByText('instagram.com/reel/EXAMPLE123').getAttribute('title')).toBe(LINK);
    expect(within(region).getByText('In Instagram Reels')).toBeTruthy();
    expect(within(region).getAllByRole('listitem')).toHaveLength(4);
    expect(within(region).getByRole('button', { name: 'Copy link' })).toBeTruthy();

    fireEvent.click(music());
    expect(onChange).toHaveBeenLastCalledWith('referenceAudio');
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('copies the reel’s link, and says so', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.assign(navigator, { clipboard: { writeText } });
    render(<Picker start="platformSound" onChange={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy link' }));
    expect(await screen.findByRole('button', { name: 'Copied' })).toBeTruthy();
    expect(writeText).toHaveBeenCalledWith(LINK);
  });

  it('lets a file for this Mac pick the app whose steps to show', () => {
    render(<Picker start="platformSound" platform={null} onChange={vi.fn()} />);
    const apps = screen.getByRole('radiogroup', { name: 'Steps for' });
    expect(within(apps).getByRole('radio', { name: 'Instagram Reels' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    fireEvent.click(within(apps).getByRole('radio', { name: 'TikTok' }));
    expect(within(apps).getByRole('radio', { name: 'TikTok' }).getAttribute('aria-checked')).toBe('true');
  });

  it('a template without its reel kept: the reel’s music says why, and with nothing to play the switch stays off', () => {
    render(<Picker start="platformSound" referenceAudio={{ available: false }} onChange={vi.fn()} />);
    expect(music().getAttribute('aria-disabled')).toBe('true');
    expect(
      screen.getByText(
        'It isn’t kept with this template yet. Get the reel’s video and music on the template’s page.',
      ),
    ).toBeTruthy();
  });

  it('a video made without a reel offers no reel’s music', () => {
    render(
      <Picker
        start="ownTrack"
        referenceAudio={{ available: false }}
        ownTrack={{ available: true }}
        platformSound={null}
        onChange={vi.fn()}
      />,
    );
    expect(screen.queryByRole('radio', { name: /The reel’s music/ })).toBeNull();
    expect(screen.getByRole('radio', { name: /Your own track/ }).getAttribute('aria-checked')).toBe('true');
  });

  it('follows music that arrives with the video at once, and moves only when the person turns it', () => {
    const view = render(
      <MusicPathPicker
        value="platformSound"
        onChange={vi.fn()}
        referenceAudio={{ available: true }}
        ownTrack={{ available: false }}
        platformSound={STEPS}
        platform="reels"
      />,
    );
    // The live timeline arrives on the reel's music: the regions swap without moving.
    view.rerender(
      <I18nProvider i18n={i18n}>
        <MusicPathPicker
          value="referenceAudio"
          onChange={vi.fn()}
          referenceAudio={{ available: true }}
          ownTrack={{ available: false }}
          platformSound={STEPS}
          platform="reels"
        />
      </I18nProvider>,
    );
    const regions = () => [...document.querySelectorAll('[data-slot=music-picker] > [data-slot=collapse]')];
    expect(regions().map((region) => region.className.includes('transition-none'))).toEqual([true, true]);
    // The kit's class merge drops Collapse's own transition, so nothing animates.
    expect(regions().some((region) => region.className.includes('transition-['))).toBe(false);
    fireEvent.click(music());
    expect(regions().map((region) => region.className.includes('transition-none'))).toEqual([false, false]);
  });

  it('moves between the music it has with the arrows', () => {
    const onChange = vi.fn();
    render(<Picker start="referenceAudio" ownTrack={{ available: true }} onChange={onChange} />);
    const reel = screen.getByRole('radio', { name: /The reel’s music/ });
    reel.focus();
    fireEvent.keyDown(reel, { key: 'ArrowDown' });
    expect(onChange).toHaveBeenLastCalledWith('ownTrack');
    expect(document.activeElement).toBe(screen.getByRole('radio', { name: /Your own track/ }));
  });
});
