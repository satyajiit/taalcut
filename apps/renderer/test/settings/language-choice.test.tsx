// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// Settings › General › Language (UX4 set; was About): the row you choose stays checked until the saved preference is it. The command's
// answer and `locale.changed` (the saved preference) come separately; when the answer comes first, the row used to
// go back to the old language until the stream caught up (UX2 e2e: "Clicking the checkbox did not change its state").
// Here the stream is held while the command answers, so the answer always comes first.
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { renderWatched, type Watch } from './spied-backend';

/** `locale.changed`, with what it sends held back while `held.on`. */
function heldLocaleStream() {
  const held = { on: false, delivered: 0, waiting: [] as (() => void)[] };
  const release = () => {
    held.on = false;
    for (const go of held.waiting.splice(0)) go();
  };
  async function* hold(stream: AsyncIterable<unknown>) {
    for await (const value of stream) {
      while (held.on) await new Promise<void>((go) => held.waiting.push(go));
      held.delivered += 1;
      yield value;
    }
  }
  const watch: Watch = {
    namespace: 'locale',
    procedure: 'changed',
    answer: async (_input, fake) => {
      const stream: unknown = await fake();
      if (typeof stream !== 'object' || stream === null || !(Symbol.asyncIterator in stream))
        throw new Error('locale.changed is not a stream');
      return hold(stream as AsyncIterable<unknown>);
    },
  };
  return { held, release, watch };
}

/** The row's radio, in the Language group (found by its id: its name follows the app's language). */
const radio = (value: string) => {
  const group = document.querySelector('#language [role=radiogroup]');
  const button = group?.querySelector<HTMLElement>(`[role=radio][value="${value}"]`);
  if (!button) throw new Error(`no ${value} row`);
  return button;
};
/** The kit's Radix radio says its state in aria-checked. */
const checked = (value: string) => radio(value).getAttribute('aria-checked') === 'true';

describe('Settings › General › Language', () => {
  it('shows automatic English on a Hindi Mac and keeps draft choices explicit and labelled', async () => {
    const { client } = await renderWatched('/settings/general', [], {
      phase3: { locale: { system: ['hi-IN'] } },
    });
    await screen.findByRole('radiogroup', { name: 'Language' });
    await waitFor(() => expect(checked('system')).toBe(true));
    expect(document.documentElement.lang).toBe('en');
    expect(screen.getByRole('radio', { name: 'Automatic · English' })).toBe(radio('system'));
    expect(radio('system').closest('li')?.textContent).toContain('English');
    expect(radio('system').closest('li')?.textContent).not.toContain('Draft translation');
    expect(screen.getByText(/English is supported in this beta/)).toBeTruthy();
    for (const draft of ['hi', 'es', 'pt-BR']) {
      expect(radio(draft).closest('li')?.textContent).toContain('Draft translation');
    }
    await act(async () => {
      fireEvent.click(radio('hi'));
    });
    await waitFor(() => expect(document.documentElement.lang).toBe('hi'));
    expect((await client.locale.state()).preference).toBe('hi');
    await act(async () => {
      fireEvent.click(radio('system'));
    });
    await waitFor(() => expect(document.documentElement.lang).toBe('en'));
    expect((await client.locale.state()).resolved).toBe('en');
  });

  it('the chosen row stays checked when the command answers before locale.changed', async () => {
    const { held, release, watch } = heldLocaleStream();
    const { controls } = await renderWatched('/settings/general', watch);
    await screen.findByRole('radiogroup', { name: 'Language' });
    await waitFor(() => expect(checked('system')).toBe(true));

    held.on = true;
    const before = held.delivered;
    await act(async () => {
      fireEvent.click(radio('hi'));
    });
    expect(checked('hi')).toBe(true);
    // The command has answered (the list is no longer busy), and nothing new came on the stream meanwhile.
    await waitFor(() =>
      expect(controls.dispatched.some((change) => change.name === 'settings.setLocale')).toBe(true),
    );
    const group = screen.getByRole('radiogroup', { name: 'Language' });
    await waitFor(() => expect(group.getAttribute('aria-busy')).toBeNull());
    expect(held.delivered).toBe(before);
    expect(checked('hi')).toBe(true);
    expect(checked('system')).toBe(false);

    // The saved preference arrives: still Hindi, and the app is in Hindi.
    await act(async () => {
      release();
    });
    await waitFor(() => expect(held.delivered).toBeGreaterThan(before));
    await waitFor(() => expect(document.documentElement.lang).toBe('hi'));
    expect(checked('hi')).toBe(true);
    expect(
      within(group)
        .getAllByRole('radio')
        .filter((button) => button.getAttribute('aria-checked') === 'true'),
    ).toHaveLength(1);
  });

  it('a later saved preference (an undo) takes over from the choice', async () => {
    const { held, release, watch } = heldLocaleStream();
    const { controls } = await renderWatched('/settings/general', watch);
    await screen.findByRole('radiogroup', { name: 'Language' });
    await waitFor(() => expect(checked('system')).toBe(true));

    held.on = true;
    await act(async () => {
      fireEvent.click(radio('es'));
    });
    const group = screen.getByRole('radiogroup', { name: 'Language' });
    await waitFor(() => expect(group.getAttribute('aria-busy')).toBeNull());
    // ⌘Z before the stream caught up: the newest saved preference is Automatic again.
    await act(async () => {
      const undone = await controls.bus.undo(null, { source: 'ui', actor: 'user' });
      expect(undone.ok).toBe(true);
    });
    await act(async () => {
      release();
    });
    await waitFor(() => expect(checked('system')).toBe(true));
    expect(checked('es')).toBe(false);
  });
});
