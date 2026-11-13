// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
// UX4 kit, controls: Checkbox, Radio and Switch take their words as part of their hit area; Popover pops from its
// trigger; Button takes the verb's icon, presses by 2 % and draws a tick when it finishes; Tabs glide; menu items
// use the hover surface, not `bg-accent`.
import { i18n } from '@lingui/core';
import { I18nProvider } from '@lingui/react';
import { fireEvent, render, screen } from '@testing-library/react';
import { RotateCcw } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import {
  Button,
  Checkbox,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Radio,
  RadioGroup,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  VERB_ICONS,
} from '../src';

const wrapper = ({ children }: { children: ReactNode }) => (
  <I18nProvider i18n={i18n}>{children}</I18nProvider>
);
const show = (node: ReactNode) => render(node, { wrapper });

function ControlledCheckbox(props: { label?: string; loading?: boolean }) {
  const [on, setOn] = useState(false);
  return (
    <Checkbox
      checked={on}
      onCheckedChange={setOn}
      label={props.label}
      aria-label={props.label ? undefined : 'Pick'}
      loading={props.loading}
    />
  );
}

describe('Checkbox', () => {
  it('ticks when its words are clicked, and draws the tick in ink', () => {
    show(<ControlledCheckbox label="Include music" />);
    const box = screen.getByRole('checkbox', { name: 'Include music' });
    expect(box.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(screen.getByText('Include music'));
    expect(box.getAttribute('aria-checked')).toBe('true');
    const face = box.querySelector<HTMLElement>('[data-slot=checkbox-face]')!;
    expect(face.className).toContain('group-data-[state=checked]/box:bg-inverse');
    // With words, the label is the target and the button is the face's size.
    expect(box.className).toContain('size-4');
    expect(box.querySelector('[data-slot=tick]')?.getAttribute('data-draw')).toBe('true');
  });

  it('shows a dash when mixed, ignores clicks while loading and says it is invalid', () => {
    const { rerender } = show(
      <Checkbox checked="indeterminate" onCheckedChange={() => undefined} aria-label="All" />,
    );
    const mixed = screen.getByRole('checkbox', { name: 'All' });
    expect(mixed.getAttribute('aria-checked')).toBe('mixed');
    // A bare box is a 24 px target round its 16 px face (WCAG 2.5.8), so nothing hangs outside it.
    expect(mixed.className).toContain('size-6');
    expect(mixed.querySelector('[data-slot=checkbox-face]')?.className).toContain('size-4');
    rerender(<ControlledCheckbox loading />);
    const box = screen.getByRole('checkbox', { name: 'Pick' });
    fireEvent.click(box);
    expect(box.getAttribute('aria-checked')).toBe('false');
    expect(box.getAttribute('aria-busy')).toBe('true');
    rerender(<Checkbox checked={false} onCheckedChange={() => undefined} aria-label="Bad" invalid />);
    expect(screen.getByRole('checkbox', { name: 'Bad' }).getAttribute('aria-invalid')).toBe('true');
  });
});

describe('Radio', () => {
  it('chooses when a choice’s words are clicked', () => {
    function Choice() {
      const [value, setValue] = useState('wifi');
      return (
        <RadioGroup aria-label="How" value={value} onValueChange={setValue}>
          <Radio value="wifi" label="Wi-Fi" />
          <Radio value="cable" label="Cable" description="Faster for big files." />
        </RadioGroup>
      );
    }
    show(<Choice />);
    expect(screen.getByRole('radio', { name: 'Wi-Fi' }).getAttribute('aria-checked')).toBe('true');
    fireEvent.click(screen.getByText('Cable'));
    const cable = screen.getByRole('radio', { name: 'Cable' });
    expect(cable.getAttribute('aria-checked')).toBe('true');
    expect(document.getElementById(cable.getAttribute('aria-describedby') ?? '')?.textContent).toBe(
      'Faster for big files.',
    );
  });

  it('holds its choices while one saves, keeping focus where it is', () => {
    const chosen: string[] = [];
    function Saving({ loading }: { loading: boolean }) {
      return (
        <RadioGroup aria-label="How" value="cable" loading={loading} onValueChange={(v) => chosen.push(v)}>
          <Radio value="wifi" label="Wi-Fi" />
          <Radio value="cable" label="Cable" />
        </RadioGroup>
      );
    }
    const { rerender } = show(<Saving loading={false} />);
    const cable = screen.getByRole('radio', { name: 'Cable' });
    cable.focus();
    rerender(<Saving loading />);
    expect(screen.getByRole('radiogroup').getAttribute('aria-busy')).toBe('true');
    expect((cable as HTMLButtonElement).disabled).toBe(false);
    expect(document.activeElement).toBe(cable);
    fireEvent.click(screen.getByText('Wi-Fi'));
    expect(chosen).toEqual([]);
    rerender(<Saving loading={false} />);
    fireEvent.click(screen.getByText('Wi-Fi'));
    expect(chosen).toEqual(['wifi']);
  });
});

describe('Switch with its words', () => {
  it('flips when the label is clicked, and is described by its line', () => {
    function Setting() {
      const [on, setOn] = useState(false);
      return <Switch checked={on} onCheckedChange={setOn} label="Sounds" description="Four quiet cues." />;
    }
    show(<Setting />);
    const control = screen.getByRole('switch', { name: 'Sounds' });
    fireEvent.click(screen.getByText('Sounds'));
    expect(control.getAttribute('aria-checked')).toBe('true');
    expect(control.querySelector('[data-slot=tick]')).not.toBeNull();
    const described = document.getElementById(control.getAttribute('aria-describedby') ?? '');
    expect(described?.textContent).toBe('Four quiet cues.');
  });
});

describe('Popover', () => {
  it('opens from its trigger and pops in, with a fade alone under reduced motion', () => {
    show(
      <Popover>
        <PopoverTrigger>Scope</PopoverTrigger>
        <PopoverContent aria-label="Memory scope">Just this chat</PopoverContent>
      </Popover>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Scope' }));
    const panel = document.querySelector<HTMLElement>('[data-slot=popover-content]')!;
    expect(panel.textContent).toBe('Just this chat');
    expect(panel.className).toContain('data-[state=open]:animate-enter');
    expect(panel.className).toContain('motion-reduce:data-[state=open]:animate-fade-in');
  });
});

describe('Button', () => {
  it('leads with the verb’s icon, or ends with it', () => {
    const { rerender } = show(<Button icon={VERB_ICONS.retry}>Try again</Button>);
    const button = screen.getByRole('button', { name: 'Try again' });
    expect(button.firstElementChild?.getAttribute('data-slot')).toBe('glyph');
    rerender(
      <Button icon={<RotateCcw aria-hidden data-testid="end" />} iconPlacement="end">
        Next
      </Button>,
    );
    expect(screen.getByRole('button', { name: 'Next' }).lastElementChild?.getAttribute('data-testid')).toBe(
      'end',
    );
  });

  it('takes the control roles: type-label, and type-label-sm on a small button', () => {
    const { rerender } = show(<Button>Export</Button>);
    expect(screen.getByRole('button', { name: 'Export' }).className).toContain('type-label');
    rerender(<Button size="sm">Export</Button>);
    const small = screen.getByRole('button', { name: 'Export' }).className.split(' ');
    expect(small).toContain('type-label-sm');
    expect(small).not.toContain('type-label');
    expect(small).not.toContain('text-sm');
  });

  it('gives by 2 % on a press, never under reduced motion or while disabled', () => {
    show(<Button>Swap clip</Button>);
    const classes = screen.getByRole('button', { name: 'Swap clip' }).className;
    expect(classes).toContain('active:scale-[0.98]');
    expect(classes).toContain('motion-reduce:active:scale-100');
    expect(classes).toContain('disabled:active:scale-100');
    expect(classes).not.toContain('translate-y-px');
  });

  it('puts the spinner in the icon’s place, then draws a tick when it finishes', () => {
    const { rerender } = show(
      <Button icon={VERB_ICONS.export} loading>
        Exporting
      </Button>,
    );
    const button = () => screen.getByRole('button');
    expect(button().querySelectorAll('svg')).toHaveLength(1);
    expect(button().querySelector('.animate-spin')).not.toBeNull();
    rerender(
      <Button icon={VERB_ICONS.export} status="success">
        Exported
      </Button>,
    );
    expect(button().querySelector('[data-slot=button-tick]')?.getAttribute('data-draw')).toBe('true');
    rerender(
      <Button icon={VERB_ICONS.export} status="success">
        Exported
      </Button>,
    );
    // Already finished: the tick stays, without drawing again.
    expect(button().querySelector('[data-slot=button-tick]')?.hasAttribute('data-draw')).toBe(false);
  });
});

describe('Tabs', () => {
  it('puts the gliding thumb under the open tab', () => {
    show(
      <Tabs defaultValue="slots">
        <TabsList>
          <TabsTrigger value="slots">Slots</TabsTrigger>
          <TabsTrigger value="beats">Beats</TabsTrigger>
        </TabsList>
        <TabsContent value="slots">Slot list</TabsContent>
        <TabsContent value="beats">Beat list</TabsContent>
      </Tabs>,
    );
    const list = screen.getByRole('tablist');
    expect(list.querySelector('[data-slot=segment-thumb]')).not.toBeNull();
    expect(screen.getByRole('tab', { name: 'Slots' }).className).toContain('type-label');
  });
});
