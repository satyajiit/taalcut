// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
// UX4 kit, page anatomy: ViewLinks (router-free links on the shared thumb), PageSection (icon-led heading, one
// rhythm), ListRow (one recipe, no nested interactive), EmptyState (Kaatu by default, a compact no-results row).
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { act, render, screen, within } from '@testing-library/react';
import { Clapperboard, Upload } from 'lucide-react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { EmptyState, ListRow, ListRows, PageSection, ViewLink, ViewLinks } from '../src';

const wrapper = ({ children }: { children: ReactNode }) => (
  <I18nProvider i18n={i18n}>{children}</I18nProvider>
);
const show = (node: ReactNode) => render(node, { wrapper });

describe('ViewLinks', () => {
  it('is a named nav of list items, the current view aria-current with its thumb', () => {
    show(
      <ViewLinks label="Make" data-slot="make-views">
        <ViewLink href="/projects" current icon={Clapperboard}>
          Projects
        </ViewLink>
        <ViewLink href="/renders" icon={Upload} count={3}>
          Exports
        </ViewLink>
      </ViewLinks>,
    );
    const nav = screen.getByRole('navigation', { name: 'Make' });
    expect(nav.dataset.slot).toBe('make-views');
    // The shell's page turn finds a views row by this, whatever slot the row keeps.
    expect(nav.hasAttribute('data-view-links')).toBe(true);
    expect(within(nav).getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'Projects' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: /Exports/ }).getAttribute('aria-current')).toBeNull();
    // Each view leads with its glyph; the count is a number in the language's digits.
    expect(nav.querySelectorAll('[data-slot=glyph]')).toHaveLength(2);
    expect(
      screen.getByRole('link', { name: /Exports/ }).querySelector('[data-slot=view-link-count]')?.textContent,
    ).toBe('3');
    // The thumb draws the current one, its edge rule-strong (3:1 in dark).
    const thumb = nav.querySelector('[data-slot=segment-thumb]');
    expect(thumb?.tagName).toBe('LI');
    expect(thumb?.getAttribute('aria-hidden')).toBe('true');
    expect(thumb?.querySelector('span')?.className).toContain('border-rule-strong');
  });

  it('hides a count of 0 and renders the caller’s own link with asChild', () => {
    show(
      <ViewLinks label="From your phone">
        <ViewLink asChild current count={0} data-tab="wifi">
          <a href="/library/phone/wifi" data-custom="">
            Wi-Fi
          </a>
        </ViewLink>
      </ViewLinks>,
    );
    const link = screen.getByRole('link', { name: 'Wi-Fi' });
    expect(link.hasAttribute('data-custom')).toBe(true);
    expect(link.dataset.tab).toBe('wifi');
    expect(link.dataset.viewCurrent).toBe('true');
    expect(link.className).toContain('type-label');
    expect(link.querySelector('[data-slot=view-link-count]')).toBeNull();
  });

  describe('across pages', () => {
    const at = (el: Element) => Number((el as HTMLElement).dataset.testX ?? 0);
    const width = (el: Element) => Number((el as HTMLElement).dataset.testW ?? 0);
    const props = ['offsetLeft', 'offsetWidth', 'offsetHeight'] as const;
    const saved = props.map((name) => Object.getOwnPropertyDescriptor(HTMLElement.prototype, name));
    afterEach(() =>
      props.forEach((name, i) => Object.defineProperty(HTMLElement.prototype, name, saved[i]!)),
    );

    it('starts the next page’s thumb where the last one was, then glides', async () => {
      Object.defineProperty(HTMLElement.prototype, 'offsetLeft', {
        configurable: true,
        get() {
          return at(this);
        },
      });
      Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
        configurable: true,
        get() {
          return width(this);
        },
      });
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 32 });
      const pill = (current: 'a' | 'b') => (
        <ViewLinks label="Glide test">
          <ViewLink href="/a" current={current === 'a'} data-test-x="4" data-test-w="90">
            A
          </ViewLink>
          <ViewLink href="/b" current={current === 'b'} data-test-x="96" data-test-w="80">
            B
          </ViewLink>
        </ViewLinks>
      );
      const first = show(pill('a'));
      const thumb = () => document.querySelector<HTMLElement>('[data-slot=segment-thumb]');
      expect(thumb()?.dataset.x).toBe('4');
      first.unmount();
      show(pill('b'));
      // The new pill opens where the old one left off…
      expect(thumb()?.dataset.x).toBe('4');
      // …and glides to its own view on the next frames.
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 60));
      });
      expect(thumb()?.dataset.x).toBe('96');
      expect(thumb()?.querySelector('span')?.className).toContain('transition-transform');
    });
  });
});

describe('PageSection', () => {
  it('is a section named by its icon-led h2, with its line and actions', () => {
    show(
      <PageSection
        title="Your templates"
        icon={Clapperboard}
        description="Made from reels."
        actions={<button>Import</button>}
      >
        <p>content</p>
      </PageSection>,
    );
    const section = screen.getByRole('region', { name: 'Your templates' });
    const heading = screen.getByRole('heading', { level: 2, name: 'Your templates' });
    expect(heading.className).toContain('type-section');
    // The glyph is 20 px at level 2, in ink-3, hidden from screen readers.
    const glyph = heading.querySelector('svg');
    expect(glyph?.getAttribute('width')).toBe('20');
    expect(glyph?.getAttribute('aria-hidden')).toBe('true');
    expect(within(section).getByText('Made from reels.').className).toContain('type-meta');
    expect(within(section).getByRole('button', { name: 'Import' })).toBeTruthy();
  });

  it('is an h3 at level 3, and more space sits above a following section than inside it', () => {
    show(
      <>
        <PageSection title="One">a</PageSection>
        <PageSection title="Two" level={3}>
          b
        </PageSection>
      </>,
    );
    expect(screen.getByRole('heading', { level: 3, name: 'Two' }).className).toContain('type-card-title');
    const sections = document.querySelectorAll<HTMLElement>('[data-slot=page-section]');
    expect(sections[0]?.className).toContain('gap-4');
    expect(sections[1]?.className).toContain('[[data-slot=page-section]+&]:mt-8');
  });
});

describe('ListRow', () => {
  it('makes its one action span the row, with its box (named by the title) and actions beside it, never inside', () => {
    show(
      <ListRows aria-label="Projects">
        <ListRow
          title="Golden hour market"
          meta="15s · 3 videos"
          trailingMeta="Oct 12"
          action={<a href="/projects/1" />}
          select={{ checked: false, onCheckedChange: () => undefined }}
          actions={<button aria-label="More actions" />}
        />
      </ListRows>,
    );
    const link = screen.getByRole('link', { name: /Golden hour market/ });
    expect(link.hasAttribute('data-row-action')).toBe(true);
    expect(link.className).toContain('active:scale-[0.99]');
    expect(within(link).queryByRole('button')).toBeNull();
    expect(within(link).queryByRole('checkbox')).toBeNull();
    expect(screen.getByRole('checkbox', { name: 'Select Golden hour market' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'More actions' })).toBeTruthy();
    expect(within(link).getByText('15s · 3 videos').className).toContain('type-meta');
  });

  it('shows the box in selection mode, marks a selected row, and divides rows in a framed list', () => {
    show(
      <ListRows framed aria-label="Settings">
        <ListRow
          title="Local only"
          size="dense"
          selected
          selecting
          leading={Clapperboard}
          select={{ checked: true, onCheckedChange: () => undefined, label: 'Select' }}
        />
      </ListRows>,
    );
    const row = document.querySelector<HTMLElement>('[data-slot=list-row]')!;
    expect(row.dataset.selected).toBe('true');
    expect(row.className).toContain('border-t');
    expect(row.querySelector('[data-slot=list-row-select]')?.className).toContain('opacity-100');
    expect(row.querySelector('[data-slot=glyph]')).not.toBeNull();
    expect(screen.getByText('Local only').className).toContain('type-label');
  });

  it('answers no hover and no press when static, as a fact that does nothing', () => {
    show(
      <ListRows framed aria-label="File">
        <ListRow title="GX010610.MP4" size="dense" static />
        <ListRow title="Night market" size="dense" action={<a href="/library/1" />} />
      </ListRows>,
    );
    const [fact, link] = [...document.querySelectorAll<HTMLElement>('[data-slot=list-row]')];
    expect(fact?.dataset.static).toBe('true');
    expect(fact?.className).not.toContain('hover:bg-hover');
    expect(fact?.className).not.toContain('bg-pressed');
    expect(link?.dataset.static).toBeUndefined();
    expect(link?.className).toContain('hover:bg-hover');
  });
});

describe('ListRow in a listbox', () => {
  it('can be an option of a windowed listbox, selected by aria-selected', () => {
    show(
      <div role="listbox" aria-label="Templates">
        <ListRow as="div" role="option" aria-selected title="Night market" />
      </div>,
    );
    const option = screen.getByRole('option', { name: /Night market/ });
    expect(option.tagName).toBe('DIV');
    expect(option.className).toContain('aria-selected:bg-selected');
  });
});

describe('EmptyState', () => {
  it('keeps Kaatu beside the words by default, and takes a mood or none', () => {
    const { rerender } = show(<EmptyState title="No projects yet" description="Make a video." />);
    expect(document.querySelector('[data-slot=mascot]')?.getAttribute('data-spot')).toBe('empty');
    rerender(<EmptyState title="No projects yet" description="Make a video." kaatu="sleep" />);
    expect(document.querySelector('[data-slot=mascot]')?.getAttribute('data-mood')).toBe('sleep');
    rerender(<EmptyState title="No projects yet" description="Make a video." kaatu={false} />);
    expect(document.querySelector('[data-slot=mascot]')).toBeNull();
  });

  it('sets its title in the type role its level takes', () => {
    show(<EmptyState titleAs="h1" title="Nothing here" description="Yet." kaatu={false} />);
    expect(screen.getByRole('heading', { level: 1 }).className).toContain('type-headline');
  });

  it('is a single status line when compact, Kaatu only when asked', () => {
    const { rerender } = show(
      <EmptyState
        variant="compact"
        icon={Upload}
        title="No clips match."
        action={<button>Clear filters</button>}
      />,
    );
    const row = screen.getByRole('status');
    expect(row.dataset.variant).toBe('compact');
    expect(row.querySelector('[data-slot=mascot]')).toBeNull();
    expect(within(row).getByRole('button', { name: 'Clear filters' })).toBeTruthy();
    // Asked for, Kaatu sits as in the shell's KaatuMoment: the moment's size, on the row's edge.
    rerender(<EmptyState variant="compact" title="No clips match." kaatu />);
    expect(screen.getByRole('status').querySelector('[data-slot=mascot]')?.getAttribute('data-spot')).toBe(
      'moment',
    );
  });
});
