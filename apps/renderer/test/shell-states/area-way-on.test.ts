// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

// UX4 (B23): a page that isn't there, or failed with nowhere to go back to, offers the way on to its own area.
import { describe, expect, it } from 'vitest';
import { areaOf } from '../../src/shell-states/area-way-on';

describe('a message page’s way on', () => {
  it.each([
    ['/library/not-an-id', 'library'],
    ['/library/', 'library'],
    ['/projects/01K7C5M6Q8R9S0T1V2W3X4Y5ZA/timeline', 'make'],
    ['/renders/nope', 'make'],
    ['/templates/not-a-template', 'templates'],
  ])('%s goes back to %s', (path, area) => {
    expect(areaOf(path)?.id).toBe(area);
  });

  it.each(['/chat/not-an-id', '/settings/nope', '/no-such-page', '/'])('%s goes to the chat', (path) => {
    expect(areaOf(path)).toBeNull();
  });
});
