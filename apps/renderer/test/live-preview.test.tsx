// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { newId, TimeoutError, type PreviewSession } from '@taalcut/core';
import type * as UI from '@taalcut/ui';
import type { PreviewPlayer } from '@taalcut/ui';
import { fireEvent, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { LivePreview } from '../src/features/timeline/preview/live-preview';
import type { PreviewRefreshState } from '../src/features/timeline/preview/preview-refresh';
import { editorFixture, mountEditorControl } from './simple-editor-support';

const mocked = vi.hoisted(() => ({ refresh: vi.fn(), player: vi.fn(), sound: vi.fn() }));
vi.mock('../src/features/timeline/preview/use-preview-refresh', () => ({
  usePreviewRefresh: mocked.refresh,
}));
vi.mock('../src/features/sounds/sound-activity-context', () => ({
  usePlaybackActivity: () => mocked.sound,
}));
vi.mock('@taalcut/ui', async (importOriginal) => ({
  ...(await importOriginal<typeof UI>()),
  PreviewPlayer: (props: ComponentProps<typeof PreviewPlayer>) => {
    mocked.player(props);
    return (
      <div data-testid="preview-player">
        {props.failure ? (
          <div role="alert">
            {props.failure}
            <button onClick={props.onRetry}>Retry player</button>
          </div>
        ) : null}
      </div>
    );
  },
}));

beforeEach(() => vi.clearAllMocks());

function setup() {
  const { timeline } = editorFixture();
  const session: PreviewSession = {
    sessionId: newId<'PreviewSession'>(),
    timelineRevision: timeline.revision,
    revision: 1,
    url: 'app://preview/token/index.html?rev=1',
    width: timeline.canvas.width,
    height: timeline.canvas.height,
    rate: timeline.canvas.rate,
    durationFrames: 450,
    compositionHash: 'a'.repeat(64),
  };
  const state: PreviewRefreshState = {
    session,
    requested: timeline.revision,
    compiled: timeline.revision,
    displayed: timeline.revision,
    failure: null,
  };
  const refresh = { state, retry: vi.fn(), painted: vi.fn() };
  mocked.refresh.mockImplementation(() => refresh);
  const view = (revision = timeline.revision) => (
    <LivePreview projectId={timeline.projectId} timeline={{ ...timeline, revision }} label="Video preview" />
  );
  const mounted = mountEditorControl(view());
  const props = () => mocked.player.mock.lastCall![0] as ComponentProps<typeof PreviewPlayer>;
  return { ...mounted, refresh, session, timeline, view, props };
}

describe('live preview feedback', () => {
  it('leaves a current preview free of status labels and footers', () => {
    const { props } = setup();
    expect(props()).toMatchObject({ pending: false, failure: null });
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(/latest preview/i)).toBeNull();
    const frame = screen.getByTestId('preview-player').parentElement!;
    expect(frame.getAttribute('aria-busy')).toBe('false');
    expect(frame.children).toHaveLength(1);
  });

  it('keeps the playing source mounted while a compact accessible update indicator is shown', () => {
    const { refresh, rerender, view, session, timeline, props } = setup();
    const player = screen.getByTestId('preview-player');
    refresh.state = { ...refresh.state, requested: timeline.revision + 1 };
    rerender(view(timeline.revision + 1));
    expect(screen.getByTestId('preview-player')).toBe(player);
    expect(props()).toMatchObject({ src: session.url, pending: false, failure: null });
    const status = screen.getByRole('status');
    expect(status.textContent).toBe('Updating preview…');
    expect(status.querySelector('span')?.classList.contains('sr-only')).toBe(true);
    expect(status.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(player.parentElement?.getAttribute('aria-busy')).toBe('true');

    refresh.state = { ...refresh.state, displayed: timeline.revision + 1 };
    rerender(view(timeline.revision + 1));
    expect(screen.queryByRole('status')).toBeNull();
    expect(player.parentElement?.getAttribute('aria-busy')).toBe('false');
  });

  it('retains the previous preview after a failed refresh and offers one retry', () => {
    const { refresh, rerender, view, session, props } = setup();
    refresh.state = { ...refresh.state, failure: TimeoutError({ ms: 500 }) };
    rerender(view());
    expect(props()).toMatchObject({ src: session.url, pending: false, failure: null });
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.queryByRole('status')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(refresh.retry).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('preview-player').parentElement?.getAttribute('aria-busy')).toBe('false');
  });

  it('lets the player present an initial failure without a duplicate overlay or retry', () => {
    const { refresh, rerender, view, props } = setup();
    refresh.state = { ...refresh.state, session: null, displayed: null, failure: TimeoutError({ ms: 500 }) };
    rerender(view());
    expect(props()).toMatchObject({ src: null, pending: false });
    expect(props().failure).toBeTruthy();
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry player' }));
    expect(refresh.retry).toHaveBeenCalledTimes(1);
    expect(mocked.sound).toHaveBeenLastCalledWith(false);
  });
});
