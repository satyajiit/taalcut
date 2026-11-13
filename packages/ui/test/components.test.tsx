// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { useState, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import {
  Badge,
  Button,
  Chip,
  cn,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
  EmptyState,
  Input,
  Logo,
  ProviderLogo,
  ScrollArea,
  Segmented,
  Select,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '../src';

const wrapper = ({ children }: { children: ReactNode }) => (
  <I18nProvider i18n={i18n}>{children}</I18nProvider>
);

describe('cn', () => {
  it('keeps Taalcut text sizes next to text colours', () => {
    expect(cn('text-md', 'text-ink')).toBe('text-md text-ink');
    expect(cn('text-sm', 'text-display')).toBe('text-display');
    expect(cn('rounded-md', 'rounded-pill')).toBe('rounded-pill');
    expect(cn('bg-sunken', false, 'bg-raised')).toBe('bg-raised');
  });
});

describe('Button', () => {
  it('is a plain button by default', () => {
    render(<Button>Swap clip</Button>);
    const button = screen.getByRole('button', { name: 'Swap clip' });
    expect(button.getAttribute('type')).toBe('button');
    expect(button.dataset.state).toBe('idle');
  });

  it('marks loading as busy, ignores clicks, keeps focus and shows a spinner', () => {
    let clicks = 0;
    render(
      <Button variant="primary" loading onClick={() => clicks++}>
        Rendering
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Rendering' }) as HTMLButtonElement;
    fireEvent.click(button);
    expect(clicks).toBe(0);
    expect(button.disabled).toBe(false);
    button.focus();
    expect(document.activeElement).toBe(button);
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.dataset.state).toBe('loading');
    expect(button.querySelector('svg')).not.toBeNull();
  });

  it('shows error and success states over the variant', () => {
    render(
      <>
        <Button variant="primary" status="error">
          Try again
        </Button>
        <Button status="success">Saved</Button>
      </>,
    );
    const error = screen.getByRole('button', { name: 'Try again' });
    expect(error.dataset.state).toBe('error');
    expect(error.className).toContain('bg-danger-soft');
    expect(error.className).not.toContain('bg-primary ');
    expect(screen.getByRole('button', { name: 'Saved' }).dataset.state).toBe('success');
  });

  it('styles a child element with asChild', () => {
    render(
      <Button asChild variant="ghost">
        <a href="/library">Library</a>
      </Button>,
    );
    const link = screen.getByRole('link', { name: 'Library' });
    expect(link.className).toContain('text-ink-2');
  });
});

describe('Dialog', () => {
  it('opens with a translated close button', async () => {
    render(
      <Dialog>
        <DialogTrigger>Open</DialogTrigger>
        <DialogContent>
          <DialogTitle>Delete project</DialogTitle>
          <DialogDescription>This removes the timeline.</DialogDescription>
        </DialogContent>
      </Dialog>,
      { wrapper },
    );
    await act(async () => fireEvent.click(screen.getByText('Open')));
    expect(screen.getByRole('dialog', { name: 'Delete project' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Close' })).toBeTruthy();
  });

  it('gives focus back to what opened it without a DialogTrigger (WCAG 2.4.3)', async () => {
    function Opened() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <Button onClick={() => setOpen(true)}>Export…</Button>
          {open ? (
            <Dialog open onOpenChange={setOpen}>
              <DialogContent>
                <DialogTitle>Export</DialogTitle>
                <DialogDescription>Where it goes.</DialogDescription>
              </DialogContent>
            </Dialog>
          ) : null}
        </>
      );
    }
    render(<Opened />, { wrapper });
    const opener = screen.getByRole('button', { name: 'Export…' });
    opener.focus();
    await act(async () => fireEvent.click(opener));
    expect(screen.getByRole('dialog', { name: 'Export' })).toBeTruthy();
    await act(async () => fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' }));
    await act(async () => new Promise((resolve) => setTimeout(resolve, 10)));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});

describe('small parts', () => {
  it('renders badges and chips with their tone', () => {
    render(
      <>
        <Badge tone="ai">AI pick</Badge>
        <Chip tone="you">You changed this</Chip>
      </>,
    );
    expect(screen.getByText('AI pick').className).toContain('bg-ai-soft');
    expect(screen.getByText('You changed this').className).toContain('rounded-pill');
  });

  it('marks an input with an error as invalid', () => {
    render(<Input aria-label="Project name" status="error" />);
    expect(screen.getByRole('textbox', { name: 'Project name' }).getAttribute('aria-invalid')).toBe('true');
  });

  it('gives the logo an accessible name', () => {
    render(<Logo label="Taalcut" />);
    expect(screen.getByRole('img', { name: 'Taalcut' })).toBeTruthy();
  });

  it('teaches the one action in an empty state', () => {
    render(
      <EmptyState
        icon={<svg />}
        title="No clips yet"
        description="Add a folder."
        action={<Button>Add a folder</Button>}
      />,
      { wrapper },
    );
    expect(screen.getByRole('heading', { name: 'No clips yet' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add a folder' })).toBeTruthy();
    // Kaatu keeps it company (UX4), decorative.
    expect(document.querySelector('[data-slot=mascot][data-spot=empty]')).not.toBeNull();
  });

  it('scrolls natively in the chosen direction', () => {
    render(<ScrollArea orientation="horizontal" data-testid="area" />);
    expect(screen.getByTestId('area').className).toContain('overflow-x-auto');
  });

  it('switches tabs', async () => {
    render(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a">Slots</TabsTrigger>
          <TabsTrigger value="b">Beats</TabsTrigger>
        </TabsList>
        <TabsContent value="a">Slot list</TabsContent>
        <TabsContent value="b">Beat grid</TabsContent>
      </Tabs>,
    );
    expect(screen.getByText('Slot list')).toBeTruthy();
    await act(async () => {
      fireEvent.mouseDown(screen.getByRole('tab', { name: 'Beats' }));
    });
    expect(screen.getByRole('tab', { name: 'Beats' }).getAttribute('aria-selected')).toBe('true');
  });

  it('renders SVGL provider logos, custom Select with leading icon, and Switch states', () => {
    let checked = false;
    render(
      <>
        <ProviderLogo provider="openai" data-testid="logo-openai" />
        <ProviderLogo provider="google" framed={false} data-testid="logo-google" />
        <Select aria-label="Model" leading={<ProviderLogo provider="anthropic" size="xs" framed={false} />}>
          <option value="claude">Claude</option>
        </Select>
        <Switch aria-label="Local only" checked={checked} onCheckedChange={(next) => (checked = next)} />
      </>,
    );
    expect(screen.getByTestId('logo-openai').getAttribute('data-provider')).toBe('openai');
    expect(screen.getByTestId('logo-google').querySelector('svg')).not.toBeNull();
    expect(screen.getByRole('combobox', { name: 'Model' })).toBeTruthy();
    const toggle = screen.getByRole('switch', { name: 'Local only' });
    fireEvent.click(toggle);
    expect(checked).toBe(true);
  });

  it('names a segmented group by a string or by the element that names it', () => {
    const options = [
      { value: 'read', label: 'Look only' },
      { value: 'edit', label: 'Edit' },
    ] as const;
    render(
      <>
        <Segmented label="Theme" value="read" options={options} onChange={() => undefined} />
        <span id="level-name">
          What <span translate="no">Claude Code</span> may do
        </span>
        <Segmented labelledBy="level-name" value="edit" options={options} onChange={() => undefined} />
      </>,
    );
    expect(screen.getByRole('radiogroup', { name: 'Theme' })).toBeTruthy();
    const named = screen.getByRole('radiogroup', { name: 'What Claude Code may do' });
    expect(named.hasAttribute('aria-label')).toBe(false);
    expect(screen.getAllByRole('radio', { checked: true }).map((radio) => radio.textContent)).toEqual([
      'Look only',
      'Edit',
    ]);
  });
});
