// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// LNX1-AV1: the export's video formats on the fake machines (FAKE_VIDEO_CODECS). The AV1 presets are offered on the
// RTX 4090 host and dimmed with why on a Mac and a CPU-only machine; Shorts, Reels and TikTok offer HEVC beside
// H.264 (the default) where the machine encodes it; the pick is saved with the preset and sent with the export.
import { I18nProvider } from '@lingui/react';
import { callRpc, ok } from '@taalcut/core';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createFakeBackend } from '../src/backend/fake/fake-backend';
import type { FakeSystem } from '../src/backend/fake/fake-system';
import { GOLDEN_PROJECT, GOLDEN_TIMELINES } from '../src/backend/fake/make/ids';
import { whereSection } from '../src/features/renders/sections/where';
import { codecChoices, keptCodec } from '../src/features/renders/sections/codec-choices';
import { activateLocale, i18n } from '../src/i18n/i18n';
import { renderApp } from './render-app';

const projectId = GOLDEN_PROJECT;
const timelineId = GOLDEN_TIMELINES[0]!;
const EDITOR = `/projects/${projectId}/timeline?timeline=${timelineId}`;
const AV1_REASON = 'Needs a GPU that encodes AV1 (NVIDIA RTX 40 series or newer)';

function on(system: FakeSystem) {
  const { client } = createFakeBackend({
    phase2: { library: { tickMs: 0 } },
    make: { renderTickMs: 0 },
    phase3: { hardware: { system } },
  });
  const entry = async (id: string) => {
    const options = await client.renders.exportOptions({ projectId, timelineId });
    return options.presets.find((each) => each.preset.id === id)!;
  };
  const dispatch = (name: string, payload: unknown) =>
    callRpc(client.commands.dispatch({ name, payload, source: 'ui' }));
  return { client, entry, dispatch };
}

describe('the fake export options on each machine', () => {
  it('the RTX 4090 host offers the AV1 presets and HEVC on the platform presets', async () => {
    const { entry } = on('linux-nvidia');
    for (const id of ['youtubeAv1', 'deviceAv1', 'reels', 'deviceHevc']) {
      expect((await entry(id)).available).toBe(true);
      expect((await entry(id)).codecs).toBeUndefined();
    }
    expect(codecChoices(await entry('reels'))).toEqual([
      { codec: 'h264', available: true },
      { codec: 'hevc', available: true },
    ]);
  });

  it('a Mac dims the AV1 presets with why, and keeps HEVC', async () => {
    const { entry } = on('mac');
    expect(await entry('youtubeAv1')).toMatchObject({
      available: false,
      reasonKey: 'render.unavailable.noAv1Encoder',
      codecs: [{ codec: 'av1', available: false, reasonKey: 'render.unavailable.noAv1Encoder' }],
    });
    expect((await entry('reels')).codecs).toBeUndefined();
  });

  it('a CPU-only machine has H.264 alone: HEVC on Reels dimmed, the HEVC and AV1 presets too', async () => {
    const { entry } = on('linux-cpu');
    const reels = await entry('reels');
    expect(reels.available).toBe(true);
    expect(codecChoices(reels)).toEqual([
      { codec: 'h264', available: true },
      { codec: 'hevc', available: false, reasonKey: 'render.unavailable.noHevcEncoder' },
    ]);
    expect(keptCodec(reels, 'hevc')).toBeUndefined();
    expect(await entry('deviceHevc')).toMatchObject({ available: false });
    expect(await entry('deviceAv1')).toMatchObject({ reasonKey: 'render.unavailable.noAv1Encoder' });
  });

  it('render.export refuses a codec the preset doesn’t offer or the machine can’t make', async () => {
    const request = { projectId, timelineId, captions: { burnIn: false, sidecars: [] } };
    const mac = on('mac');
    const av1 = await mac.dispatch('render.export', { ...request, presetId: 'youtubeAv1' });
    expect(av1.ok ? null : av1.error.code).toBe('render.codec_unavailable');
    const offered = await mac.dispatch('render.export', { ...request, presetId: 'device', codec: 'hevc' });
    expect(offered.ok ? null : offered.error.code).toBe('render.codec_unavailable');
    expect((await mac.dispatch('render.export', { ...request, presetId: 'reels', codec: 'hevc' })).ok).toBe(
      true,
    );
    const nvidia = on('linux-nvidia');
    expect((await nvidia.dispatch('render.export', { ...request, presetId: 'youtubeAv1' })).ok).toBe(true);
    const saved = await nvidia.dispatch('render.setExportPreset', {
      projectId,
      presetId: 'device',
      codec: 'av1',
    });
    expect(saved.ok ? null : saved.error.code).toBe('render.codec_unavailable');
  });
});

describe('the export dialog’s video format', () => {
  async function openDialog(system: FakeSystem) {
    const app = await renderApp(
      EDITOR,
      { make: { renderTickMs: 0 }, phase3: { hardware: { system } } },
      'en',
      system === 'mac' ? 'mac' : 'linux',
    );
    await screen.findByRole('button', { name: /^Export/ });
    await act(async () => {
      await app.router.navigate({
        to: '/projects/$projectId/timeline',
        params: { projectId },
        search: { timeline: timelineId, export: true },
      });
    });
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(dialog.querySelector('[data-slot=preset-picker]')).not.toBeNull(), {
      timeout: 4000,
    });
    const picker = dialog.querySelector('[data-slot=preset-picker]') as HTMLElement;
    const row = (id: string) => picker.querySelector(`[data-preset=${id}]`) as HTMLElement;
    return { ...app, dialog, row };
  }

  it('on a Mac: the AV1 presets dimmed with the reason; Reels offers H.264 (checked) and HEVC', async () => {
    const { dialog, row } = await openDialog('mac');
    for (const id of ['youtubeAv1', 'deviceAv1']) {
      expect(row(id).getAttribute('aria-disabled')).toBe('true');
      expect(within(row(id)).getByText(AV1_REASON)).toBeTruthy();
    }
    const format = within(dialog).getByRole('radiogroup', { name: 'Video format' });
    expect(
      within(format).getByRole('radio', { name: 'H.264, plays everywhere' }).getAttribute('aria-checked'),
    ).toBe('true');
    expect(
      within(format).getByRole('radio', { name: 'HEVC, smaller file' }).getAttribute('aria-disabled'),
    ).toBeNull();
  });

  it('picking HEVC saves it with the preset, and the export asks for it', async () => {
    const { dialog, controls } = await openDialog('linux-nvidia');
    // The fake's commands run on its bus: what the dialog asked for, payload and all.
    const sent = vi.spyOn(controls.bus, 'dispatch');
    const format = within(dialog).getByRole('radiogroup', { name: 'Video format' });
    await act(async () => fireEvent.click(within(format).getByRole('radio', { name: 'HEVC, smaller file' })));
    await waitFor(() =>
      expect(sent).toHaveBeenCalledWith(
        'render.setExportPreset',
        expect.objectContaining({ presetId: 'reels', codec: 'hevc' }),
        expect.anything(),
        expect.anything(),
      ),
    );
    // The summary step holds Export (UX4's steps).
    const stepper = within(dialog).getByRole('navigation', { name: 'Export steps' });
    await act(async () => fireEvent.click(within(stepper).getByRole('button', { name: 'Summary' })));
    await act(async () =>
      fireEvent.click(await within(dialog).findByRole('button', { name: /^Export for/ })),
    );
    await waitFor(() =>
      expect(sent).toHaveBeenCalledWith(
        'render.export',
        expect.objectContaining({ presetId: 'reels', codec: 'hevc' }),
        expect.anything(),
        expect.anything(),
      ),
    );
  });

  it('on the RTX 4090 host the AV1 presets can be picked; one format, so no format choice', async () => {
    const { dialog, row, controls } = await openDialog('linux-nvidia');
    const sent = vi.spyOn(controls.bus, 'dispatch');
    expect(row('youtubeAv1').getAttribute('aria-disabled')).toBeNull();
    await act(async () => fireEvent.click(row('youtubeAv1')));
    await waitFor(() => expect(row('youtubeAv1').getAttribute('aria-checked')).toBe('true'));
    // The codec the dialog shows is the one saved: a pick of HEVC made earlier is never kept out of sight.
    await waitFor(() =>
      expect(sent).toHaveBeenCalledWith(
        'render.setExportPreset',
        expect.objectContaining({ presetId: 'youtubeAv1', codec: 'av1' }),
        expect.anything(),
        expect.anything(),
      ),
    );
    expect(within(dialog).queryByRole('radiogroup', { name: 'Video format' })).toBeNull();
  });

  it('on a CPU-only machine HEVC is dimmed with why', async () => {
    const { dialog } = await openDialog('linux-cpu');
    const format = within(dialog).getByRole('radiogroup', { name: 'Video format' });
    expect(
      within(format).getByRole('radio', { name: 'HEVC, smaller file' }).getAttribute('aria-disabled'),
    ).toBe('true');
    // Under the format, and on the HEVC preset's row.
    expect(within(dialog).getAllByText('Needs a GPU that encodes HEVC')).toHaveLength(2);
  });
});

describe('“Where it’s going” in the pseudo-locale', () => {
  it('every word went through the catalogue, the AV1 rows and the format’s reason included', async () => {
    const { client } = on('linux-cpu');
    const [options, timeline, credits] = await Promise.all([
      client.renders.exportOptions({ projectId, timelineId }),
      client.timelines.get({ timelineId }),
      client.library.credits({ assetIds: [] }),
    ]);
    await activateLocale('en-XA');
    try {
      const noop = () => undefined;
      const { container } = render(
        <I18nProvider i18n={i18n}>
          <whereSection.Component
            context={{
              projectId,
              timelineId,
              options,
              timeline,
              style: null,
              credits: { status: 'ready', credits },
            }}
            choices={{ presetId: 'reels', burnIn: false, srt: false, includeBumpers: true }}
            choose={noop}
            dispatch={() => Promise.resolve(ok(null))}
            reload={noop}
            ask={noop}
            review={noop}
            disabled={false}
          />
        </I18nProvider>,
      );
      expect(container.querySelector('[data-preset=youtubeAv1][aria-disabled=true]')).not.toBeNull();
      expect(container.querySelectorAll('[role=radio][aria-disabled=true]').length).toBeGreaterThan(2);
      const words: string[] = [];
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const text = walker.currentNode.textContent?.trim();
        // The figures (length and size) are Intl's, which has no pseudo-locale data.
        if (text && !walker.currentNode.parentElement?.closest('.tabular-nums')) words.push(text);
      }
      for (const node of container.querySelectorAll('[aria-label], [title]'))
        words.push(node.getAttribute('aria-label') ?? '', node.getAttribute('title') ?? '');
      expect(words.length).toBeGreaterThan(10);
      // Lingui's pseudo-locale accents every letter but v and x: three plain letters in a row skipped the catalogue.
      expect(words.filter((text) => /[A-Za-z]{3,}/.test(text))).toEqual([]);
    } finally {
      await activateLocale('en');
    }
  });
});
