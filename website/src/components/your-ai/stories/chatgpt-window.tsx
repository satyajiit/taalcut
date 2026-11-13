// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: ChatGPT in Settings › Accounts, coded · mode: Persuade (show, don't tell) · system: WEB2 Remix Vernacular
 * states: accounts (the row offers Continue with ChatGPT: a real button, the ink pill) · signing in (loading: a
 *   turning ring, "Waiting for your browser", Cancel) · signed in (success: the teal "Using ChatGPT plan" chip, Manage
 *   usage, a real Sign out) · the window's buttons: default · hover · focus (base ring) · active (2 % give) · reduced
 *   motion (the swap is a 150 ms fade, the ring still) · without JavaScript (signed in, every word shown).
 * motion: the row's right end swaps with a short rise on the ease-out.
 * The app's Settings › Accounts, coded: the ChatGPT row large at the top, the keys you could add under it. It lays out
 * at its own width (fluid), so its words keep their size on a phone. The window's own buttons work. */

import { Check, ExternalLink, LoaderCircle, LogIn, LogOut } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type { ReactNode } from 'react';
import { BrandIcon } from '#components/brand/brand-icon';
import { AppWindow } from '#components/ui/app-window';
import { CHATGPT_STICKERS } from '#content/ai-stories';
import { CHATGPT } from '#content/providers';
import { cn } from '#lib/cn';
import { ICON_STROKE } from '#lib/icons';
import { DUR, EASE_OUT, REDUCED_FADE } from '#lib/motion';
import { PROVIDER_GLYPHS } from './story-avatar';

export type ChatgptStep = 0 | 1 | 2;

const KEY_MARKS = { Anthropic: 'anthropic', 'Google Gemini': 'gemini' } as const;

function WindowButton({ onClick, children, tone = 'plain' }: { readonly onClick: () => void; readonly children: ReactNode; readonly tone?: 'plain' | 'strong' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex h-11 items-center gap-2 rounded-pill border px-4 type-label font-semibold whitespace-nowrap select-none',
        'transition-[background-color,transform] duration-(--dur-micro) ease-(--ease-out) active:scale-[0.98] motion-reduce:active:scale-100',
        tone === 'strong' ? 'border-inverse bg-inverse text-on-inverse hover:bg-inverse/85' : 'border-rule bg-control text-ink hover:bg-control-hover',
      )}
    >
      {children}
    </button>
  );
}

interface RowProps {
  readonly step: ChatgptStep;
  readonly onSignIn: () => void;
  readonly onCancel: () => void;
  readonly onSignOut: () => void;
  readonly reduce: boolean;
}

function ChatgptRow({ step, onSignIn, onCancel, onSignOut, reduce }: RowProps) {
  const swap = reduce ? { duration: REDUCED_FADE } : { duration: DUR.short, ease: EASE_OUT };
  return (
    <div data-slot="chatgpt-row" className="flex min-h-28 flex-wrap items-center justify-between gap-x-4 gap-y-3 rounded-2xl border border-rule bg-raised p-5 shadow-sm">
      <div data-slot="icon-text" className="flex min-w-0 items-center gap-4">
        <span aria-hidden className="inline-grid size-14 shrink-0 place-items-center rounded-xl border border-rule-subtle bg-canvas">
          <BrandIcon id="openai" className="size-8" />
        </span>
        <span className="flex min-w-0 flex-col items-start gap-1.5">
          <span className="type-section text-ink">ChatGPT</span>
          {step === 2 ? (
            <span className="inline-flex h-7 items-center gap-1.5 rounded-pill bg-teal-soft px-2.5 type-label-sm font-semibold whitespace-nowrap text-teal-strong">
              <Check aria-hidden strokeWidth={ICON_STROKE} className="size-3.5" />
              {CHATGPT.row.plan}
            </span>
          ) : (
            <span className="type-label-sm text-ink-2">{step === 1 ? CHATGPT.waitingLine : CHATGPT.rowLine}</span>
          )}
        </span>
      </div>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div
          key={step}
          initial={{ opacity: 0, y: reduce ? 0 : 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, transition: { duration: DUR.micro } }}
          transition={swap}
          className="flex shrink-0 flex-wrap items-center gap-3"
        >
          {step === 0 ? (
            <WindowButton onClick={onSignIn} tone="strong">
              <LogIn aria-hidden strokeWidth={ICON_STROKE} className="size-4" />
              {CHATGPT.row.button}
            </WindowButton>
          ) : step === 1 ? (
            <>
              <span role="status" className="inline-flex items-center gap-2 type-label text-ink-2">
                <LoaderCircle aria-hidden strokeWidth={ICON_STROKE} className="size-4 animate-spin text-violet-strong motion-reduce:animate-none" />
                {CHATGPT.waiting}
              </span>
              <WindowButton onClick={onCancel}>{CHATGPT.cancel}</WindowButton>
            </>
          ) : (
            <>
              <span className="inline-flex items-center gap-1 type-label-sm whitespace-nowrap text-ink-2">
                {CHATGPT.row.manage}
                <ExternalLink aria-hidden strokeWidth={ICON_STROKE} className="size-3.5" />
              </span>
              <WindowButton onClick={onSignOut}>
                <LogOut aria-hidden strokeWidth={ICON_STROKE} className="size-4" />
                {CHATGPT.row.signOut}
              </WindowButton>
            </>
          )}
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function KeyRows() {
  return (
    <ul aria-label="API keys you can add" className="flex flex-col divide-y divide-rule-subtle rounded-xl border border-rule-subtle bg-raised">
      {CHATGPT.keyRows.map((name) => {
        const mark = KEY_MARKS[name as keyof typeof KEY_MARKS];
        const Glyph = PROVIDER_GLYPHS.elevenlabs!;
        return (
          <li key={name} className="flex h-14 items-center justify-between gap-3 px-4">
            <span className="inline-flex items-center gap-3 type-label text-ink">
              <span aria-hidden className="inline-grid size-7 place-items-center rounded-md bg-sunken text-ink-2">
                {mark ? <BrandIcon id={mark} className="size-4" /> : <Glyph strokeWidth={ICON_STROKE} className="size-4" />}
              </span>
              {name}
            </span>
            <span className="inline-flex h-7 items-center rounded-pill border border-rule-subtle px-3 type-label-sm text-ink-3">{CHATGPT.addKey}</span>
          </li>
        );
      })}
    </ul>
  );
}

export interface ChatgptWindowProps extends RowProps {
  /** The window bar's right end: Play again. */
  readonly actions?: ReactNode;
}

export function ChatgptWindow({ actions, ...row }: ChatgptWindowProps) {
  return (
    <AppWindow title="Settings" area="settings" size="lg" fit="fluid" actions={actions} pageClassName="flex flex-col gap-5 bg-panel p-5 sm:p-7">
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <div className="flex flex-col gap-0.5">
          <span className="type-section text-ink">Accounts</span>
          <span className="type-label-sm text-ink-2">{CHATGPT_STICKERS.accountsLine}</span>
        </div>
        <span className="type-label-sm text-ink-3">{CHATGPT.row.where}</span>
      </div>
      <ChatgptRow {...row} />
      <KeyRows />
    </AppWindow>
  );
}
