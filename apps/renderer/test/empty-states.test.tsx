// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { COMPOSER_DRAFT_KEY, parseReelLink } from '../src/features/templates/templates-empty';
import { renderApp } from './render-app';

afterEach(() => sessionStorage.clear());

/** The formats are Start from…'s second view, a page of their own (UX4 tpl: /templates/start/formats). */
async function openBuiltInFormats(): Promise<HTMLElement> {
  return waitFor(() => {
    const formats = document.querySelector<HTMLElement>('[data-slot=built-in-formats]');
    if (!formats) throw new Error('Start from… › Formats shows no formats');
    return formats;
  });
}

describe('empty areas show the shape of what fills them', () => {
  it('Templates: a link pasted in place opens a chat with it, and a non-link says how to get one', async () => {
    const { router } = await renderApp('/templates', { phase2: { templates: { empty: true } } });
    expect(await screen.findByRole('heading', { name: 'No templates yet' })).toBeTruthy();
    const field = screen.getByRole('textbox', { name: 'Link to a reel' });

    fireEvent.change(field, { target: { value: 'my favourite reel' } });
    fireEvent.click(screen.getByRole('button', { name: 'Read this reel' }));
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(screen.getByRole('alert').textContent).toContain('Copy link');

    fireEvent.change(field, { target: { value: '  https://www.instagram.com/reel/C9xyz/ ' } });
    expect(field.getAttribute('aria-invalid')).toBeNull();
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Read this reel' }));
    });
    expect(router.state.location.pathname).toMatch(/^\/chat\/[0-9A-Z]{26}$/);
    // The new chat opens with the link in its composer, and the hand-over is cleared.
    const composer = await screen.findByRole('textbox', { name: 'Message Taalcut' });
    expect((composer as HTMLTextAreaElement).value).toBe('https://www.instagram.com/reel/C9xyz/');
    expect(sessionStorage.getItem(COMPOSER_DRAFT_KEY)).toBeNull();
  });

  it('Templates: Built-in formats lists all eight formats the templates service returns, each with its words (M4)', async () => {
    await renderApp('/templates/start/formats', { phase2: { templates: { empty: true } } });
    const section = await openBuiltInFormats();
    const names = within(section)
      .getAllByRole('listitem')
      .map((row) => row.querySelector('[data-slot=format-name]')?.textContent);
    expect(names).toEqual([
      'Vlog',
      'Day in the life',
      'Talking to camera',
      'Podcast clip',
      'Product ad',
      'Before and after',
      'How-to',
      'Highlight reel',
    ]);
  });

  it('Templates: a built-in format acts: it opens a new chat with its ask in the composer (UX1 M10)', async () => {
    const { router } = await renderApp('/templates/start/formats', {
      phase2: { templates: { empty: true } },
    });
    const section = await openBuiltInFormats();
    // Every Start from… card ends with Use for a video (UX4 tpl): a format's opens the chat with its ask.
    const podcast = section.querySelector<HTMLElement>('[data-format=podcastClip]');
    if (!podcast) throw new Error('No Podcast clip card');
    await act(async () => {
      fireEvent.click(within(podcast).getByRole('button', { name: 'Use for a video' }));
    });
    expect(router.state.location.pathname).toMatch(/^\/chat\/[0-9A-Z]{26}$/);
    const composer = await screen.findByRole('textbox', { name: 'Message Taalcut' });
    expect((composer as HTMLTextAreaElement).value).toBe('Make a podcast clip from my recording.');
  });

  it('Chat: the start surface shows the four ways in; one starts a flow in a new chat (P2-M13)', async () => {
    const { router } = await renderApp('/chat');
    expect(screen.getByRole('heading', { level: 2, name: 'Tell Taalcut what to make' })).toBeTruthy();
    const ways = screen.getByRole('list', { name: 'Ways to start' });
    expect(ways.querySelectorAll(':scope > li > button')).toHaveLength(4);
    // Use my library, with sources: the flow starts at once, with its sentence as your message.
    await act(async () => {
      fireEvent.click(await screen.findByRole('button', { name: /Use my library/ }));
    });
    expect(router.state.location.pathname).toMatch(/^\/chat\/[0-9A-Z]{26}$/);
    const sent = await screen.findByText('Make a video from my latest clips', {
      selector: '[data-role=user] *',
    });
    expect(sent).toBeTruthy();
    // The chat has a name for screen readers and the window, and the composer is still there.
    expect(screen.getByRole('heading', { level: 1 })).toBeTruthy();
    expect(screen.getByRole('textbox', { name: 'Message Taalcut' })).toBeTruthy();
  });

  it('accepts only web links', () => {
    expect(parseReelLink('https://youtube.com/shorts/abc')).toBe('https://youtube.com/shorts/abc');
    expect(parseReelLink('ftp://example.com/reel')).toBeNull();
    expect(parseReelLink('instagram.com/reel/abc')).toBeNull();
  });

  it('Library: imports are reviewed, and an unreadable drop gives a useful recovery', async () => {
    const { controls } = await renderApp('/library', { phase2: { library: { count: 0, tickMs: 0 } } });
    expect(await screen.findByRole('heading', { name: 'Bring your footage together' })).toBeTruthy();
    const zone = document.querySelector('[data-slot=library-drop]')!;
    fireEvent.dragOver(zone);
    const clip = new File(['x'], 'IMG_0418.mov', { type: 'video/quicktime' });
    fireEvent.drop(zone, { dataTransfer: { files: [clip] } });
    expect(await screen.findByText('Choose files with Import to let Taalcut read them.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Choose a source' }).getAttribute('href')).toBe(
      '/library/import',
    );
    expect(controls.dispatched.filter((entry) => entry.name === 'imports.start')).toHaveLength(0);
  });
  it('Library: a cancelled picker leaves no draft or import', async () => {
    const { router, client } = await renderApp('/library/import/folder', { phase2: { pickedFolder: null } });
    fireEvent.click(await screen.findByRole('button', { name: 'Choose folder…' }));
    await waitFor(async () => expect(await client.imports.drafts()).toEqual([]));
    expect(router.state.location.pathname).toBe('/library/import/folder');
  });

  it('Make: a ghost timeline above the one way to start a video', async () => {
    await renderApp('/projects', { make: { empty: true } });
    expect(await screen.findByRole('heading', { name: 'No projects yet' })).toBeTruthy();
    expect(document.querySelector('[data-slot=ghost-timeline]')?.getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByRole('link', { name: 'Make a video' }).getAttribute('href')).toBe('/chat');
  });

  it('Exports: the same, saying where finished videos land', async () => {
    await renderApp('/renders', { make: { empty: true } });
    expect(await screen.findByRole('heading', { name: 'Your exports show up here' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Make a video' }).getAttribute('href')).toBe('/chat');
  });

  it('no area uses the old boxed empty state with an icon tile', async () => {
    for (const path of ['/library', '/templates', '/renders', '/settings/sources', '/settings/memory']) {
      const { router } = await renderApp(path);
      const box = document.querySelector('[data-slot=empty-state]');
      expect(box?.className ?? '', router.state.location.pathname).not.toMatch(/border-dashed|rounded-xl/);
      document.body.innerHTML = '';
    }
  });
});
