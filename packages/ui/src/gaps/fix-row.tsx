// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: gap fix row (P3-B8) · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 · one way to fill a gap, a row on the panel (hairline between rows, no box): a quiet icon
 *   (the AI mark in violet for a generated image: the AI's work), the fix's name, what it means in a line or two,
 *   and its one action at the right: Open on your phone · Ask in chat · Find stock video (opens the results under
 *   the row) · Drop this shot. While the agent asks, the action is Choose (a toggle: pressed ticks it in the answer, in teal: your choice)
 *   · FIX-ASK Add more clips: From this Mac (the library's folder import) and From your phone under its line, asking
 *   or not, so the person can add the clips the shot needs
 * states: default · hover/active/focus-visible (the kit's Button) · disabled (the gap is settled, or the answer went)
 *   · loading (Drop spins while the command runs) · error (the cause under the row, Retry) · success (the gap folds
 *   to one line; Choose shows a check and "Chosen")
 * pre-emit critique: P5 H4 E4 S5 R5 V4 */
import { Trans, useLingui } from '@lingui/react/macro';
import type { TaalcutError } from '@taalcut/core';
import {
  ArrowLeftRight,
  Check,
  Clapperboard,
  CopyPlus,
  FolderPlus,
  Pin,
  Replace,
  RotateCcw,
  Smartphone,
  Trash2,
} from 'lucide-react';
import { useId, useState, type ReactNode } from 'react';
import { AiMark } from '#components/ai-mark';
import { Button } from '#components/button';
import { ProviderLogo } from '#components/provider-logo';
import { cn } from '#lib/cn';
import { useFormatters } from '#lib/format';
import { UserContent } from '../cards/card-frame';
import { errorMessage } from '../feedback/error-messages';
import { toSeconds } from '../templates/slot-words';
import type { GapFixHandlers, GapFixItem, GapFixOptionView } from './gap-types';
import { FIX_TITLES } from './gap-words';
import { StockResults } from './stock-results';

export interface FixRowProps {
  gap: GapFixItem;
  option: GapFixOptionView;
  handlers: GapFixHandlers;
  /** While the agent asks: whether this fix is the gap's chosen one, and how to toggle it. */
  choose?: { readonly chosen: boolean; readonly locked: boolean; readonly onToggle: () => void };
  /** Called once the row's fix went through (the gap folds). */
  onDone: (via: GapFixItem['via']) => void;
}

const ICONS = {
  film: Smartphone,
  stock: Clapperboard,
  drop: Trash2,
  keep: Pin,
  swap: Replace,
  addClips: FolderPlus,
  borrow: ArrowLeftRight,
  reuse: CopyPlus,
} as const;

function Detail({ option }: { option: GapFixOptionView }) {
  const { t } = useLingui();
  const format = useFormatters();
  switch (option.kind) {
    case 'film':
      return <>{t`Add it to your shot list and film it on your phone.`}</>;
    case 'generate': {
      if (!option.provider || !option.model)
        return <>{t`Ask the chat for an image of it. You see the cost before anything is made.`}</>;
      const cost = option.estimate ? format.money(option.estimate) : null;
      return (
        <>
          <span className="flex flex-wrap items-center gap-x-1.5">
            <ProviderLogo provider={option.provider} size="xs" framed={false} />
            <UserContent translate="no" className="text-ink">
              {option.provider} · {option.model}
            </UserContent>
            {cost ? <span className="tabular-nums">{t`about ${cost}`}</span> : null}
          </span>
          {option.prompt ? (
            <span className="block">
              <UserContent translate="no">“{option.prompt}”</UserContent>
            </span>
          ) : null}
        </>
      );
    }
    case 'stock': {
      const query = option.query;
      return (
        <Trans>
          Up to six videos for{' '}
          <UserContent translate="no" className="text-ink">
            “{query}”
          </UserContent>
        </Trans>
      );
    }
    case 'drop': {
      const length = format.duration(toSeconds(option.newDuration) * 1000);
      return <>{t`The video becomes ${length}`}</>;
    }
    case 'keep':
      return <>{t`It stays in the video as it is.`}</>;
    case 'addClips':
      return (
        <>{t`Add clips from this Mac or your phone. Once they’re ready, Taalcut tries this shot again.`}</>
      );
    case 'swap':
    case 'borrow':
    case 'reuse':
      // Each candidate clip has its own row.
      return null;
  }
}

export function FixRow({ gap, option, handlers, choose, onDone }: FixRowProps) {
  const { t, i18n } = useLingui();
  const titleId = useId();
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<TaalcutError | null>(null);
  const [adding, setAdding] = useState<'idle' | 'busy' | 'added'>('idle');
  const title = i18n._(FIX_TITLES[option.kind]);

  const addFolder = async () => {
    if (!handlers.onAddFolder || adding === 'busy') return;
    setAdding('busy');
    setError(null);
    const result = await handlers.onAddFolder();
    setAdding(result.ok ? 'added' : 'idle');
    if (!result.ok) setError(result.error);
  };

  const drop = async () => {
    if (!handlers.onDrop || busy) return;
    setBusy(true);
    setError(null);
    const result = await handlers.onDrop(gap);
    setBusy(false);
    if (result.ok) onDone(undefined);
    else setError(result.error);
  };

  let action: ReactNode = null;
  if (choose) {
    action = (
      <Button
        size="sm"
        aria-pressed={choose.chosen}
        aria-describedby={titleId}
        disabled={choose.locked}
        className={cn(choose.chosen && 'border-you-strong bg-you-soft text-you-strong hover:bg-you-soft')}
        onClick={choose.onToggle}
      >
        {choose.chosen ? <Check aria-hidden /> : null}
        {choose.chosen ? t`Chosen` : t`Choose`}
      </Button>
    );
  } else {
    if (option.kind === 'film' && handlers.onFilm) {
      const onFilm = handlers.onFilm;
      action = (
        <Button size="sm" onClick={() => onFilm(gap)}>
          {t`Open on your phone`}
        </Button>
      );
    } else if (option.kind === 'generate' && handlers.onGenerate) {
      const onGenerate = handlers.onGenerate;
      action = (
        <Button size="sm" onClick={() => onGenerate(gap)}>
          {t`Ask in chat`}
        </Button>
      );
    } else if (option.kind === 'stock' && handlers.onStockSearch) {
      action = (
        <Button size="sm" aria-expanded={open} aria-controls={panelId} onClick={() => setOpen((was) => !was)}>
          {open ? t`Hide stock video` : t`Find stock video`}
        </Button>
      );
    } else if (option.kind === 'drop' && handlers.onDrop) {
      action = (
        <Button size="sm" loading={busy} onClick={() => void drop()}>
          {t`Drop this shot`}
        </Button>
      );
    }
  }

  const Icon = option.kind === 'generate' ? null : ICONS[option.kind];
  const search = handlers.onStockSearch;
  const use = handlers.onStockUse;
  return (
    <li
      data-slot="gap-fix"
      data-kind={option.kind}
      data-chosen={choose?.chosen || undefined}
      className="flex flex-col gap-2 border-t border-rule-subtle py-3 first:border-t-0 first:pt-1 last:pb-0"
    >
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="mt-0.5 inline-flex size-4 shrink-0 items-center justify-center text-ink-3"
        >
          {Icon ? <Icon className="size-4" /> : <AiMark className="size-4 text-ai-strong" />}
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span id={titleId} className="text-sm font-semibold text-ink">
            {title}
          </span>
          <span className="text-sm text-ink-2">
            <Detail option={option} />
          </span>
        </div>
        {action ? <div className="flex shrink-0 items-center">{action}</div> : null}
      </div>
      {option.kind === 'addClips' && (handlers.onAddFolder || handlers.onPhone) ? (
        <div className="flex flex-wrap items-center gap-2 ps-7">
          {handlers.onAddFolder ? (
            <Button size="sm" variant="ghost" loading={adding === 'busy'} onClick={() => void addFolder()}>
              <FolderPlus aria-hidden />
              {t`From this Mac`}
            </Button>
          ) : null}
          {handlers.onPhone ? (
            <Button size="sm" variant="ghost" onClick={handlers.onPhone}>
              <Smartphone aria-hidden />
              {t`From your phone`}
            </Button>
          ) : null}
          {adding === 'added' ? (
            <span role="status" className="text-xs text-ink-2">
              {t`Added. Taalcut uses the clips once they’re ready.`}
            </span>
          ) : null}
        </div>
      ) : null}
      {option.kind === 'stock' && open && search ? (
        <div id={panelId} className="ps-7">
          <StockResults
            query={option.query}
            search={search}
            {...(use
              ? {
                  onUse: async (item) => {
                    const result = await use(gap, item);
                    if (result.ok) onDone('stock');
                    return result;
                  },
                }
              : {})}
            {...(handlers.onSettings ? { onSettings: handlers.onSettings } : {})}
          />
        </div>
      ) : null}
      {error ? (
        <div
          role="alert"
          className="flex flex-wrap items-center gap-x-3 gap-y-1 ps-7 text-sm text-danger-strong"
        >
          <span className="min-w-0">{errorMessage(i18n, error)}</span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void (option.kind === 'addClips' ? addFolder() : drop())}
          >
            <RotateCcw aria-hidden />
            {t`Retry`}
          </Button>
        </div>
      ) : null}
    </li>
  );
}
