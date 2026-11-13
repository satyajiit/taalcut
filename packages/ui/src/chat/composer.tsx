// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: composer · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.2 (+ proposed A15–A17) · React Bits PromptBar in tokens: a raised bar on a rule
 * hairline, the model button and the thinking button (a beat meter), the Recipes and Effects buttons when the
 * host has them (UX4: each opens its picker sheet above the composer, composer-pickers.tsx), send in neutral ink
 * states: default · hover (buttons: hover surface + ink) · focus (ring on the bar while typing, base
 * ring on every button, menu rows and the slider) · active (press: scale 0.97 / 0.96) · disabled
 * (send while empty; levels the model doesn't have: hollow, passed by) · loading (busy: send morphs
 * into Stop) · error (the chat's error line under the transcript) · success (the message lands in
 * the transcript; a model or level change just shows on its button)
 * contrast: ink, ink-2 and ink-3 on raised and overlay (DESIGN.md contrast report)
 * UX round 1: held (the chat is loading or didn't load): Enter and Send do nothing, the words stay in the box, Send
 *   looks off, and a try says why in one line under the bar (it used to clear the box and drop the message)
 * UX round 3 (UX3-AGT): the thinking slider has exactly the current model's levels, under its provider's names
 *   (OpenAI's None to Extra high and Max, Anthropic's Low to Max, Google's Minimal to High) */

import { useLingui } from '@lingui/react/macro';
import type { ReasoningLevel } from '@taalcut/core';
import PromptBar, {
  type PromptBarEffort,
  type PromptBarLabels,
  type PromptBarModel,
} from '@taalcut-vendor/react-bits/prompt-bar';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import { cn } from '#lib/cn';
import { CrossfadeText } from '../components/crossfade-text';
import { ProviderLogo } from '../components/provider-logo';
import type { ComposerEffects } from '../effects/effect-types';
import type { ComposerRecipes } from '../recipes/recipe-types';
import { ComposerPickers } from './composer-pickers';
import { thinkingLevelDescription, thinkingLevelName, type ThinkingModel } from './thinking-levels';

/** A model the menu offers. */
export interface ComposerModelOption {
  /** 'provider/model'. */
  key: string;
  /** Product name, shown as written. */
  name: string;
  /** Translated heading it sits under: the provider, or "On this Mac". */
  group: string;
  /** Optional provider slug for logo resolution (otherwise derived from `key`). */
  provider?: string;
  /** Whether the model runs locally on this Mac. */
  local?: boolean;
}

export interface ComposerModels {
  /** The agent's model now (it may not be in `options`, e.g. an account was removed). */
  current?: ComposerModelOption;
  /** Models of connected accounts and keys, and the on-device model once downloaded, by group. */
  options: readonly ComposerModelOption[];
  onChange: (key: string) => void;
  /** "Connect more…": Settings, where accounts and every model are. */
  onMore?: () => void;
}

/** Why the current model answers without thinking. */
export type ComposerThinkingReason = 'no-thinking' | 'on-device';

export interface ComposerThinking {
  /** The level chosen: one of `levels`. */
  value: ReasoningLevel;
  /** The current model's levels, lightest first: exactly the ones its provider offers for it. */
  levels: readonly ReasoningLevel[];
  /** Whose levels they are, so each shows under its provider's name (OpenAI's off is None). */
  model?: ThinkingModel;
  reason?: ComposerThinkingReason;
  onChange: (level: ReasoningLevel) => void;
}

export interface ComposerProps {
  /** A run is streaming: the send button becomes Stop. */
  busy: boolean;
  onSend: (text: string) => void;
  /** Stops the run (the chat aborts its AbortSignal). */
  onStop: () => void;
  placeholder?: string;
  /** Text in the box when it first shows (a draft handed over from another page). */
  defaultDraft?: string;
  /** The model button and menu. Without it neither shows. */
  models?: ComposerModels;
  /** How long Taalcut thinks. Without it the button doesn't show. */
  thinking?: ComposerThinking;
  /** Inside the bar, above the text: what the message points at (the selection tray, P2-M7). */
  attachments?: ReactNode;
  /** The Recipes button and menu (P3-V11). Without it, or with no recipes, the button doesn't show. */
  recipes?: ComposerRecipes;
  /** The Effects CTA button and multi-select menu. Without it, or with no effects, the button doesn't show. */
  effects?: ComposerEffects;
  /**
   * Why a message can't go yet (the chat is still loading, or didn't load). While set, Enter and Send do nothing
   * and the words stay in the box; a try shows this line under the bar.
   */
  hold?: string;
  className?: string;
}

/**
 * Where you talk to Taalcut: React Bits' PromptBar (third_party/react-bits)
 * in Taalcut's tokens, translated. Enter sends, Shift+Enter adds a line;
 * while a run streams the send button morphs into Stop (neutral, never a
 * second marigold fill). The model button switches the agent's model for
 * every chat (the same undoable command as Settings); the thinking button
 * sets how long the agent thinks in this chat. Recipes put a starter prompt
 * in the box (the host fills it), unsent, and the focus goes back to the box.
 * Effects let the user tag single or multiple named video effects onto the message.
 */
export function Composer({
  busy,
  onSend,
  onStop,
  placeholder,
  defaultDraft,
  models,
  thinking,
  attachments,
  recipes,
  effects,
  hold,
  className,
}: ComposerProps) {
  const { t, i18n } = useLingui();
  const root = useRef<HTMLDivElement>(null);
  const held = useHeldSend(hold, busy);
  const labels = useMemo<PromptBarLabels>(
    () => ({
      sources: t`Sources`,
      commands: t`Commands`,
      models: t`Models`,
      effort: t`Thinking`,
      effortHint: t`Longer thinking takes more time before the answer`,
      faster: t`Faster`,
      smarter: t`Deeper`,
      noMatches: (query) => t`Nothing matches “${query}”`,
      remove: (file) => t`Remove ${file}`,
      listening: t`Listening…`,
      prompt: t`Message Taalcut`,
      addSources: t`Add files and sources`,
      model: t`Model`,
      chooseModel: t`Change the model`,
      chooseEffort: t`Change how long Taalcut thinks`,
      dictate: t`Dictate`,
      stopDictation: t`Stop dictation`,
      send: t`Send`,
      stop: t`Stop`,
    }),
    [t],
  );

  const options = models?.options;
  const current = models?.current;
  const menu = useMemo<PromptBarModel[]>(() => {
    const toBarModel = (o: ComposerModelOption): PromptBarModel => ({
      key: o.key,
      name: o.name,
      group: o.group,
      icon: <ProviderLogo provider={o.local ? 'local' : (o.provider ?? o.key)} size="xs" framed={false} />,
    });
    const rows = (options ?? []).map(toBarModel);
    // The model in use is always there to see, even when its account has gone.
    return current && !rows.some((r) => r.key === current.key) ? [toBarModel(current), ...rows] : rows;
  }, [options, current]);

  const value = thinking?.value;
  const offered = thinking?.levels;
  const provider = thinking?.model?.provider;
  const modelId = thinking?.model?.model;
  const levels = useMemo<PromptBarEffort[]>(() => {
    const of = provider === undefined ? undefined : { provider, ...(modelId ? { model: modelId } : {}) };
    return (offered ?? []).map((key) => ({
      key,
      name: i18n._(thinkingLevelName(key, of)),
      description: i18n._(thinkingLevelDescription(key)),
    }));
  }, [i18n, offered, provider, modelId]);
  const name = current?.name ?? '';
  const note =
    thinking?.reason === 'no-thinking'
      ? t`${name} answers without thinking first.`
      : thinking?.reason === 'on-device'
        ? t`On this Mac, ${name} answers without thinking, so it fits in memory.`
        : undefined;

  const focusBox = () => root.current?.querySelector('textarea')?.focus();
  return (
    <ComposerPickers recipes={recipes} effects={effects} focusBox={focusBox}>
      {(tools) => (
        <div
          ref={root}
          data-slot="composer"
          data-held={hold ? '' : undefined}
          onKeyDownCapture={held.onKeyDownCapture}
          onClickCapture={held.onClickCapture}
          className={cn(
            'flex w-full flex-col gap-2',
            // Held: Send looks as it does with nothing to send (PromptBar's own unarmed colours), and does nothing.
            hold &&
              '[&_button[data-armed]]:cursor-default [&_button[data-armed]]:[background:color-mix(in_srgb,var(--pb-ink)_12%,var(--pb-bg))] [&_button[data-armed]]:[color:color-mix(in_srgb,var(--pb-ink)_55%,var(--pb-bg))] [&_button[data-armed]:hover]:[background:color-mix(in_srgb,var(--pb-ink)_12%,var(--pb-bg))]',
            className,
          )}
        >
          <PromptBar
            placeholder={placeholder ?? t`Describe a video, or ask about your clips`}
            labels={labels}
            {...(defaultDraft ? { defaultDraft } : {})}
            sources={[]}
            commands={[]}
            models={menu}
            {...(current ? { model: current.key } : {})}
            onModelChange={(model) => models?.onChange(model.key)}
            {...(models?.onMore ? { modelAction: { label: t`Connect more…`, onSelect: models.onMore } } : {})}
            modelLabel={
              current ? (
                <CrossfadeText value={current.key}>
                  <span className="inline-flex items-center gap-1.5">
                    <ProviderLogo
                      provider={current.local ? 'local' : (current.provider ?? current.key)}
                      size="xs"
                      framed={false}
                    />
                    <span translate="no">{current.name}</span>{' '}
                    <span className="font-normal text-ink-3">{current.group}</span>
                  </span>
                </CrossfadeText>
              ) : undefined
            }
            modelMenuWidth="17rem"
            efforts={levels}
            {...(value ? { effort: value } : {})}
            onEffortChange={(key) => thinking?.onChange(key as ReasoningLevel)}
            {...(note ? { effortNote: note } : {})}
            sparks={false}
            {...(attachments ? { attachmentsSlot: attachments } : {})}
            {...(tools ? { toolsSlot: tools } : {})}
            busy={busy}
            width="100%"
            radius="var(--radius-2xl)"
            maxRows={8}
            background="var(--color-raised)"
            color="var(--color-ink)"
            secondaryColor="var(--color-ink-2)"
            mutedColor="var(--color-ink-3)"
            rule="var(--color-rule)"
            menuBackground="var(--color-overlay)"
            menuRule="var(--color-rule-subtle)"
            sparkColor="var(--color-ai-strong)"
            sparkWash="var(--color-ai-soft)"
            onSend={(text) => onSend(text)}
            onStop={onStop}
          />
          {hold && held.tried ? (
            <p role="status" data-slot="composer-hold" className="m-0 px-1 text-sm text-ink-2">
              {hold}
            </p>
          ) : null}
        </div>
      )}
    </ComposerPickers>
  );
}

/**
 * Keeps a held message in the box (UX round 1): PromptBar clears its box as it sends, so a send that can't go is
 * stopped before PromptBar sees it. Return without Shift in the text box, and a press on Send (the button PromptBar
 * marks armed), are caught on the way down. Stop still works: it is only armed while busy, which is never held.
 */
function useHeldSend(hold: string | undefined, busy: boolean) {
  const [tried, setTried] = useState(false);
  // A new reason (or none) starts over: the line shows again only after another try.
  useEffect(() => setTried(false), [hold]);
  const block = (event: { preventDefault(): void; stopPropagation(): void }) => {
    event.preventDefault();
    event.stopPropagation();
    setTried(true);
  };
  const active = Boolean(hold) && !busy;
  return {
    tried: active && tried,
    onKeyDownCapture(event: KeyboardEvent<HTMLDivElement>) {
      if (!active || event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
      if (event.target instanceof HTMLTextAreaElement) block(event);
    },
    onClickCapture(event: MouseEvent<HTMLDivElement>) {
      if (!active || !(event.target instanceof Element)) return;
      if (event.target.closest('button[data-armed]')) block(event);
    },
  };
}
