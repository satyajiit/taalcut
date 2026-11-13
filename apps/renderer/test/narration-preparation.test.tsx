// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { I18nProvider } from '@lingui/react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { newId, ok, type Timeline } from '@taalcut/core';
import { useState } from 'react';
import { afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { seedProjects } from '../src/backend/fake/make/seed';
import { activateLocale, i18n } from '../src/i18n/i18n';
import { NarrationPanel } from '../src/features/timeline/narration-panel';
import {
  prepareNarrationNavigation,
  usePreparedNarration,
} from '../src/features/timeline/narration-preparation';
import { createPlayhead } from '../src/features/timeline/playhead';
import type { Edits } from '../src/features/timeline/use-edits';

const ports = vi.hoisted(() => ({
  permission: vi.fn(),
  start: vi.fn(),
  cancel: vi.fn(),
  microphone: vi.fn(),
}));
vi.mock('../src/backend/backend', () => {
  const backend = { voiceCapture: ports };
  return { useBackend: () => backend };
});
vi.mock('../src/features/voice/microphone', () => ({ openBrowserMicrophone: ports.microphone }));

beforeAll(() => activateLocale('en'));
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  ports.permission.mockResolvedValue('granted');
  ports.start.mockResolvedValue({ captureId: newId<'VoiceCapture'>() });
  ports.cancel.mockResolvedValue(undefined);
  ports.microphone.mockResolvedValue(ok({ close: async () => undefined }));
});
afterEach(() => vi.useRealTimers());

function setup() {
  const timeline = structuredClone(seedProjects().projects.flatMap((p) => p.timelines)[0]!) as Timeline;
  timeline.revision = 2;
  const playhead = createPlayhead();
  playhead.setFilm(300, 30);
  const navigate = vi.fn(async () => undefined);
  const request = {
    projectId: timeline.projectId,
    timelineId: timeline.id,
    revision: String(timeline.revision),
    frame: '17',
  };
  function Prepared() {
    const [open, setOpen] = useState(false);
    usePreparedNarration(timeline, playhead, () => setOpen(true));
    return (
      <div hidden={!open}>
        <NarrationPanel timeline={timeline} playhead={playhead} edits={{ pending: false } as Edits} />
      </div>
    );
  }
  render(
    <I18nProvider i18n={i18n}>
      <Prepared />
    </I18nProvider>,
  );
  return { timeline, playhead, navigate, request };
}

it('prepares Sound without acquiring the microphone until the person presses Record voice', async () => {
  const { timeline, playhead, navigate, request } = setup();
  act(() => {
    expect(prepareNarrationNavigation(navigate, request, timeline.projectId)).toBe(true);
  });
  const record = screen.getByRole('button', { name: 'Record voice' });
  expect(playhead.frame()).toBe(17);
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(ports.permission).not.toHaveBeenCalled();
  expect(ports.start).not.toHaveBeenCalled();
  expect(ports.microphone).not.toHaveBeenCalled();
  await act(async () => {
    fireEvent.click(record);
  });
  expect(ports.permission).toHaveBeenCalledTimes(1);
  expect(ports.start).not.toHaveBeenCalled();
  for (let n = 0; n < 3; n++)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
  expect(ports.start).toHaveBeenCalledTimes(1);
  expect(ports.microphone).toHaveBeenCalledTimes(1);
});

it('ignores another project’s broadcast and refuses a stale prepared frame', () => {
  const { timeline, navigate, request } = setup();
  expect(prepareNarrationNavigation(navigate, request, newId<'Project'>())).toBe(false);
  expect(navigate).not.toHaveBeenCalled();
  act(() => {
    prepareNarrationNavigation(navigate, { ...request, revision: '1' }, timeline.projectId);
  });
  expect(screen.queryByRole('button', { name: 'Record voice' })).toBeNull();
  expect(ports.permission).not.toHaveBeenCalled();
  expect(ports.microphone).not.toHaveBeenCalled();
});
