// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The composer's model, thinking and Recipes buttons (React Bits' PromptBar in
 * the kit): the model menu by provider with its "Connect more…" row, the
 * thinking slider with exactly the model's levels under its provider's names
 * (UX3-AGT), the recipes by task (P3-V11), and the keyboard path through all three.
 */
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import type { ReasoningLevel } from '@taalcut/core';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import {
  Composer,
  type ComposerModels,
  type ComposerRecipes,
  type ComposerThinkingReason,
  type ThinkingModel,
} from '../src/index';

const OPTIONS: ComposerModels['options'] = [
  { key: 'openai/gpt-6-astra', name: 'GPT-6 Astra', group: 'OpenAI' },
  { key: 'openai/gpt-6.1-sol', name: 'GPT-6.1 Sol', group: 'OpenAI' },
  { key: 'anthropic/claude-sonnet-5-5', name: 'Claude Sonnet 5.5', group: 'Anthropic' },
  { key: 'on-device/qwen3.5-4b', name: 'Qwen3.5 4B', group: 'On this Mac' },
];
/** GPT-6.1 Sol's reasoning efforts on an API key (pi-ai 1.4.0). */
const SOL: readonly ReasoningLevel[] = ['low', 'medium', 'high', 'xhigh', 'max'];

function Harness(props: {
  onModel?: (key: string) => void;
  onMore?: () => void;
  onLevel?: (level: ReasoningLevel) => void;
  levels?: readonly ReasoningLevel[];
  model?: ThinkingModel;
  reason?: ComposerThinkingReason;
  initial?: ReasoningLevel;
  recipes?: ComposerRecipes;
  onSend?: (text: string) => void;
}) {
  const [level, setLevel] = useState<ReasoningLevel>(props.initial ?? 'medium');
  return (
    <I18nProvider i18n={i18n}>
      <Composer
        busy={false}
        onSend={props.onSend ?? (() => undefined)}
        onStop={() => undefined}
        {...(props.recipes ? { recipes: props.recipes } : {})}
        models={{
          current: OPTIONS[1],
          options: OPTIONS,
          onChange: props.onModel ?? (() => undefined),
          ...(props.onMore ? { onMore: props.onMore } : {}),
        }}
        thinking={{
          value: level,
          levels: props.levels ?? SOL,
          model: props.model ?? { provider: 'openai', model: 'gpt-6.1-sol' },
          ...(props.reason ? { reason: props.reason } : {}),
          onChange: (next) => {
            setLevel(next);
            props.onLevel?.(next);
          },
        }}
      />
    </I18nProvider>
  );
}

/** Opens a bar button's menu from the keyboard (a click with detail 0), then lets focus move into it. */
async function openWithKeyboard(button: HTMLElement) {
  button.focus();
  fireEvent.click(button, { detail: 0 });
  await act(async () => await new Promise((resolve) => requestAnimationFrame(() => resolve(undefined))));
}

describe('the composer’s model button', () => {
  it('names the model and its provider, and lists models by provider with a way to connect more', () => {
    const onModel = vi.fn();
    const onMore = vi.fn();
    render(<Harness onModel={onModel} onMore={onMore} />);
    const button = screen.getByRole('button', { name: /^Model:\s*GPT-6\.1 Sol\s*OpenAI$/ });
    fireEvent.click(button);
    const menu = screen.getByRole('listbox', { name: 'Models' });
    const groups = within(menu).getAllByRole('group');
    expect(groups.map((g) => g.getAttribute('aria-label'))).toEqual([
      'OpenAI',
      'Anthropic',
      'On this Mac',
      null,
    ]);
    expect(
      within(groups[0]!)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['GPT-6 Astra', 'GPT-6.1 Sol']);
    // The model in use is the selected option; names are product names, never translated.
    expect(screen.getByRole('option', { name: 'GPT-6.1 Sol' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('Claude Sonnet 5.5').getAttribute('translate')).toBe('no');
    fireEvent.click(screen.getByRole('option', { name: 'Claude Sonnet 5.5' }));
    expect(onModel).toHaveBeenCalledWith('anthropic/claude-sonnet-5-5');
    expect(screen.queryByRole('listbox')).toBeNull();

    fireEvent.click(button);
    fireEvent.click(screen.getByRole('option', { name: 'Connect more…' }));
    expect(onMore).toHaveBeenCalledOnce();
    expect(onModel).toHaveBeenCalledOnce();
  });

  it('opens from the keyboard onto the chosen model, moves with the arrows and goes back to the button on Escape', async () => {
    const onModel = vi.fn();
    render(<Harness onModel={onModel} />);
    const button = screen.getByRole('button', { name: /^Model:/ });
    await openWithKeyboard(button);
    expect(document.activeElement).toBe(screen.getByRole('option', { name: 'GPT-6.1 Sol' }));
    fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('option', { name: 'Claude Sonnet 5.5' }));
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(document.activeElement).toBe(button);
    expect(onModel).not.toHaveBeenCalled();
  });
});

describe('the composer’s thinking button', () => {
  it('shows the level with a beat meter, its description, and exactly the model’s levels on the slider', () => {
    render(<Harness />);
    const button = screen.getByRole('button', { name: /^Thinking:\s*Medium$/ });
    expect(button.querySelectorAll('svg rect')).toHaveLength(5);
    fireEvent.click(button);
    const dialog = screen.getByRole('dialog', { name: 'Thinking' });
    const slider = within(dialog).getByRole('slider', { name: 'Thinking' });
    expect(slider.getAttribute('aria-valuetext')).toBe('Medium');
    expect(slider.getAttribute('aria-valuemax')).toBe('4');
    expect(dialog.textContent).toContain('Balances speed and depth. Right for most videos.');
  });

  it('goes from the model’s lightest level to its heaviest, under OpenAI’s names', async () => {
    const onLevel = vi.fn();
    const luna = ['off', 'low', 'medium', 'high', 'xhigh', 'max'] as const;
    render(<Harness levels={luna} model={{ provider: 'openai', model: 'gpt-6-luna' }} onLevel={onLevel} />);
    await openWithKeyboard(screen.getByRole('button', { name: /^Thinking:/ }));
    const slider = screen.getByRole('slider');
    expect(document.activeElement).toBe(slider);
    fireEvent.keyDown(slider, { key: 'End' });
    expect(onLevel).toHaveBeenLastCalledWith('max');
    expect(slider.getAttribute('aria-valuetext')).toBe('Max');
    fireEvent.keyDown(slider, { key: 'ArrowLeft' });
    expect(slider.getAttribute('aria-valuetext')).toBe('Extra high');
    fireEvent.keyDown(slider, { key: 'Home' });
    expect(onLevel).toHaveBeenLastCalledWith('off');
    // OpenAI calls no reasoning None.
    expect(slider.getAttribute('aria-valuetext')).toBe('None');
    fireEvent.keyDown(slider, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /^Thinking:\s*None$/ }));
  });

  it('calls no thinking Off, and Google’s lightest level Minimal, on Google’s models', () => {
    const flash = ['off', 'minimal', 'low', 'medium', 'high'] as const;
    render(
      <Harness
        levels={flash}
        initial="minimal"
        model={{ provider: 'google', model: 'gemini-3.5-flash-lite' }}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /^Thinking:\s*Minimal$/ }));
    const slider = screen.getByRole('slider');
    fireEvent.keyDown(slider, { key: 'Home' });
    expect(slider.getAttribute('aria-valuetext')).toBe('Off');
  });

  it('has only Off on a model that answers without thinking, and says why', () => {
    render(<Harness levels={['off']} reason="on-device" initial="off" model={{ provider: 'on-device' }} />);
    fireEvent.click(screen.getByRole('button', { name: /^Thinking:\s*Off$/ }));
    const slider = screen.getByRole('slider');
    expect(slider.getAttribute('aria-disabled')).toBe('true');
    fireEvent.keyDown(slider, { key: 'ArrowRight' });
    expect(slider.getAttribute('aria-valuetext')).toBe('Off');
    expect(screen.getByRole('dialog').textContent).toContain(
      'On this Mac, GPT-6.1 Sol answers without thinking, so it fits in memory.',
    );
  });
});

const RECIPE_GROUPS: ComposerRecipes['groups'] = [
  {
    id: 'cut',
    label: 'Cut',
    items: [
      { id: 'cut.tighten', label: 'Tighten the cut' },
      { id: 'cut.fifteen', label: 'Make it 15 seconds' },
    ],
  },
  { id: 'music', label: 'Music', items: [{ id: 'music.pick', label: 'Pick music for this' }] },
  { id: 'export', label: 'Export', items: [{ id: 'export.shorts', label: 'Export for Shorts' }] },
];

/** Radix moves focus a task later: into the sheet as it opens, and back (or to the text box) as it closes. */
const settle = () => act(async () => await new Promise((resolve) => setTimeout(resolve, 0)));

async function press(key: string) {
  fireEvent.keyDown(document.activeElement ?? document.body, { key });
  await settle();
}

describe('the composer’s Recipes button', () => {
  it('shows only with recipes, and not when none fits', () => {
    const { unmount } = render(<Harness />);
    expect(screen.queryByRole('button', { name: 'Recipes' })).toBeNull();
    unmount();
    render(<Harness recipes={{ groups: [{ id: 'cut', label: 'Cut', items: [] }], onPick: vi.fn() }} />);
    expect(screen.queryByRole('button', { name: 'Recipes' })).toBeNull();
  });

  it('lists recipes under their task and moves with arrows, Home, End and type-ahead; Escape goes back', async () => {
    const onPick = vi.fn();
    render(<Harness recipes={{ groups: RECIPE_GROUPS, onPick }} />);
    const button = screen.getByRole('button', { name: 'Recipes' });
    await openWithKeyboard(button);
    await settle();
    const menu = screen.getByRole('menu', { name: 'Recipes' });
    expect(
      within(menu)
        .getAllByRole('group')
        .map((group) => group.textContent),
    ).toEqual([
      'CutTighten the cutMake it 15 seconds',
      'MusicPick music for this',
      'ExportExport for Shorts',
    ]);
    expect(within(menu).getByRole('group', { name: 'Music' })).toBeTruthy();
    const item = (name: string) => screen.getByRole('menuitem', { name });
    expect(document.activeElement).toBe(item('Tighten the cut'));
    await press('ArrowDown');
    expect(document.activeElement).toBe(item('Make it 15 seconds'));
    await press('End');
    expect(document.activeElement).toBe(item('Export for Shorts'));
    await press('Home');
    expect(document.activeElement).toBe(item('Tighten the cut'));
    await press('p');
    expect(document.activeElement).toBe(item('Pick music for this'));
    await press('Escape');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(button);
    expect(onPick).not.toHaveBeenCalled();
    // The sheet opens above the composer as a dialog that says what it is.
    expect(button.getAttribute('aria-haspopup')).toBe('dialog');
  });

  it('hands a picked recipe to the host, never sends, and puts the focus in the text box', async () => {
    const onPick = vi.fn();
    const onSend = vi.fn();
    render(<Harness recipes={{ groups: RECIPE_GROUPS, onPick }} onSend={onSend} />);
    const button = screen.getByRole('button', { name: 'Recipes' });
    button.focus();
    fireEvent.keyDown(button, { key: 'ArrowDown' });
    await settle();
    await press('End');
    await press('Enter');
    expect(onPick).toHaveBeenCalledExactlyOnceWith('export.shorts');
    expect(screen.queryByRole('menu')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('textbox'));
    // By pointer too.
    fireEvent.click(button);
    await settle();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Pick music for this' }));
    await settle();
    expect(onPick).toHaveBeenLastCalledWith('music.pick');
    expect(onSend).not.toHaveBeenCalled();
  });
});
