// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · pre-emit critique: P4 H4 E4 S4 R5 V4
 * Hallmark · component: history buttons (Back, Forward) · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.4 ("Window": Back, forward and up)
 * states: default (ink-2 chevron) · hover (ink on the hover surface) · focus (base ring, instant) ·
 *   active (1 px press, pressed surface) · disabled (ink-disabled chevron, no surface: the end of history) ·
 *   inactive window (ink-3). No loading, error or success, as the traffic controls: the page changing is the
 *   answer, and the global loader shows a slow one.
 * motion: none of their own; the bar is never animated (DESIGN.md "Window").
 * contrast: pass (ink-2 on canvas 7:1; the disabled chevron is ink-disabled, exempt as a disabled control)
 */
import { useLingui } from '@lingui/react/macro';
import {
  Button,
  ShortcutKeys,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  useShortcutFormat,
} from '@taalcut/ui';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { BACK_SHORTCUT, FORWARD_SHORTCUT } from './history-keys';
import { useHistoryNav } from './use-history-nav';

interface StepProps {
  label: string;
  shortcut: string;
  enabled: boolean;
  onStep: () => void;
  icon: typeof ChevronLeft;
}

function HistoryStep({ label, shortcut, enabled, onStep, icon: Icon }: StepProps) {
  const format = useShortcutFormat();
  // A disabled button takes no pointer events and no focus, so its tooltip never opens: it has nothing to do.
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={label}
          aria-keyshortcuts={format.aria(shortcut)}
          disabled={!enabled}
          data-slot="history-step"
          className="size-7 window-inactive:text-ink-3 disabled:border-transparent disabled:bg-transparent"
          onClick={onStep}
        >
          <Icon aria-hidden className="size-[1.125rem]" />
        </Button>
      </TooltipTrigger>
      <TooltipContent className="flex items-center gap-2">
        {label}
        <ShortcutKeys accelerator={shortcut} />
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * Back and Forward at the start of the window bar's page side, as in Finder
 * (DESIGN.md "Window", v0.4). On wherever the window's history leads
 * somewhere; at either end the chevron stays, dimmed, so nothing moves.
 */
export function HistoryButtons() {
  const { t } = useLingui();
  const nav = useHistoryNav();
  return (
    <div
      role="group"
      aria-label={t`History`}
      data-slot="history-buttons"
      className="app-no-drag flex items-center gap-0.5"
    >
      <HistoryStep
        label={t`Back`}
        shortcut={BACK_SHORTCUT}
        enabled={nav.canGoBack}
        onStep={nav.back}
        icon={ChevronLeft}
      />
      <HistoryStep
        label={t`Forward`}
        shortcut={FORWARD_SHORTCUT}
        enabled={nav.canGoForward}
        onStep={nav.forward}
        icon={ChevronRight}
      />
    </div>
  );
}
