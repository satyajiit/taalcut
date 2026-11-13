// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · state preview: window controls. Shown on /dev/kit; not used by any page.
 * A window control has six states (no loading, error or success): default, hover,
 * pressed, inactive window, disabled, and focus, which only assistive tech reaches. */
import { useLingui } from '@lingui/react/macro';
import type { ReactNode } from 'react';
import { cn } from '#lib/cn';
import { WindowControl, WindowControls } from './window-controls';

const noop = () => {};

interface RowProps {
  label: string;
  /** Forces a state on the row: .is-hover, .is-focus, .is-active (the CSS targets them beside the real pseudo-classes). */
  force?: 'is-hover' | 'is-focus' | 'is-active';
  disabled?: boolean;
  edited?: boolean;
  inactive?: boolean;
  third?: 'fullScreen' | 'zoom' | 'exitFullScreen';
}

function Row({ label, force, disabled, edited, inactive, third = 'fullScreen' }: RowProps) {
  const { t } = useLingui();
  const thirdLabel =
    third === 'zoom'
      ? t`Zoom window`
      : third === 'exitFullScreen'
        ? t`Exit full screen`
        : t`Enter full screen`;
  return (
    <div className="flex items-center gap-6 py-1.5" {...(inactive ? { 'data-window-active': 'false' } : {})}>
      <span className="w-44 shrink-0 text-xs text-ink-3">{label}</span>
      <div
        role="group"
        aria-label={label}
        className={cn('group/controls flex items-center', force === 'is-hover' && 'is-hover')}
      >
        <WindowControl
          kind="close"
          glyph="close"
          label={t`Close window`}
          className={force && force !== 'is-hover' ? force : undefined}
          disabled={disabled}
          edited={edited}
          onClick={noop}
        />
        <WindowControl
          kind="minimize"
          glyph="minimize"
          label={t`Minimize window`}
          disabled={disabled}
          onClick={noop}
        />
        <WindowControl kind="zoom" glyph={third} label={thirdLabel} disabled={disabled} onClick={noop} />
      </div>
    </div>
  );
}

function Panel({ children }: { children: ReactNode }) {
  return (
    <div className="flex flex-col rounded-lg border border-rule-subtle bg-canvas px-4 py-2">{children}</div>
  );
}

/**
 * The traffic controls in their six states, plus what the window adds:
 * unsaved changes, Option held, full screen. Pressed and focus are forced on
 * the close control.
 */
export function WindowControlsPreview() {
  const { t } = useLingui();
  return (
    <div data-slot="window-controls-preview" className="flex flex-col gap-3">
      <Panel>
        <Row label={t`Default`} />
        <Row label={t`Hover`} force="is-hover" />
        <Row label={t`Pressed`} force="is-active" />
        <Row label={t`Inactive`} inactive />
        <Row label={t`Inactive, pointed at`} inactive force="is-hover" />
        <Row label={t`Disabled`} disabled />
        <Row label={t`Focus (assistive tech)`} force="is-focus" />
      </Panel>
      <Panel>
        <Row label={t`Unsaved changes`} edited />
        <Row label={t`Unsaved, inactive`} edited inactive />
        <Row label={t`Option held`} force="is-hover" third="zoom" />
        <Row label={t`In full screen (menu)`} force="is-hover" third="exitFullScreen" />
      </Panel>
      <Panel>
        <div className="flex items-center gap-6 py-1.5">
          <span className="w-44 shrink-0 text-xs text-ink-3">{t`Live (does nothing)`}</span>
          <WindowControls onAction={noop} />
        </div>
      </Panel>
    </div>
  );
}
