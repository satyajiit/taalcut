// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * IX-R3: the import progress view's two finish lines. "N of M searchable" leads while clips are brought in, the
 * bar shows it under the done layer, the title says so once every clip is searchable and the line reads
 * "Analysing details"; a status from before the count, a finished import and a stopped one read as before.
 */
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import type { ImportStatus } from '@taalcut/core';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { CARD_FIXTURES, ImportProgressView } from '../src/index';

const statusOf = (key: string): ImportStatus => {
  const card = CARD_FIXTURES.importProgress[key];
  if (!card || card.type !== 'importProgress') throw new Error(`no importProgress fixture '${key}'`);
  return card.status;
};

function view(status: ImportStatus) {
  render(
    <I18nProvider i18n={i18n}>
      <ImportProgressView status={status} source="Goa" variant="strip" />
    </I18nProvider>,
  );
  const region = screen.getByRole('region', { name: 'Import progress' });
  const layer = region.querySelector<HTMLElement>('[data-slot=import-searchable-bar]');
  return { region, layer, bar: screen.getByRole('progressbar') };
}

describe('import progress: searchable and fully analysed', () => {
  it('leads with how many clips search finds, under the done layer of the bar', () => {
    const { region, layer, bar } = view(statusOf('indexing'));
    expect(region.textContent).toContain('Bringing in clips from Goa');
    expect(region.textContent).toContain('22 of 40 searchable');
    expect(region.textContent).toContain('12 fully analysed');
    expect(bar.getAttribute('aria-valuetext')).toBe('12 of 40, 22 searchable');
    expect(bar.getAttribute('aria-valuenow')).toBe('12');
    expect(layer?.style.transform).toBe('scaleX(0.55)');
  });

  it('says every clip is searchable, then "Analysing details" until the import is done', () => {
    const { region, layer } = view(statusOf('allSearchable'));
    expect(region.textContent).toContain('You can search every clip from Goa');
    expect(region.textContent).toContain('Analysing details');
    expect(region.textContent).toContain('Describing');
    expect(region.textContent).not.toContain('searchable,');
    expect(layer?.style.transform).toBe('scaleX(1)');
  });

  it('keeps the count while paused', () => {
    const { region } = view(statusOf('paused'));
    expect(region.textContent).toContain('Paused: clips from Goa');
    expect(region.textContent).toContain('22 of 40 searchable');
  });

  it('reads as before for a status without the count, a finished import and a stopped one', () => {
    const { searchable: _searchable, ...counts } = statusOf('indexing').counts;
    const before = view({ ...statusOf('indexing'), counts });
    expect(before.region.textContent).toContain('12 of 40');
    expect(before.region.textContent).not.toContain('searchable');
    expect(before.layer).toBeNull();
    before.region.parentElement?.remove();

    const done = view(statusOf('done'));
    expect(done.region.textContent).toContain('40 clips ready');
    expect(done.layer).toBeNull();
    done.region.parentElement?.remove();

    // A stopped scan has no failed files (UX1: one that ended with failed files reads "Clips from … are in").
    const someFailed = statusOf('someFailed');
    const stopped = view({ ...someFailed, state: 'failed', counts: { ...someFailed.counts, failed: 0 } });
    expect(stopped.region.textContent).toContain('The import from Goa stopped');
    expect(stopped.region.textContent).toContain('31 of 40');
    expect(stopped.region.textContent).not.toContain('searchable');
    expect(stopped.layer).toBeNull();
  });
});
