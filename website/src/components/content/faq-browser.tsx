// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: FAQ browser · mode: Read · system: WEB2 Remix Vernacular
 * states: search empty (every question, the count) · typing (questions filter as you type; matches marked; an answer
 *   that matches opens) · no match (the empty state: what was searched, Clear the search, and the contact page) ·
 *   search field default · hover · focus (base ring) · filled (a Clear button) · question closed · hover (ink) · focus
 *   (base ring) · open (chevron turned, the answer rises 8 px and fades in) · Open all / Close all · topic link default
 *   · hover · focus · a topic with no match (dimmed, not a link) · groups arrive once each · reduced motion (answers
 *   and chevrons switch with 150 ms fades) · without JavaScript (every answer shown, the search hidden)
 * The questions grouped by topic, each group under its icon, as an accordion (WAI-ARIA: h3 > button[aria-expanded],
 * Up and Down move between questions, Home and End go to the ends), with search-as-you-type over the questions and
 * answers. Every question keeps its anchor id (/faq/#footage-leaves opens and lands on it), and a closed answer stays
 * findable with the browser's find (hidden="until-found"). */

import { ChevronDown, CircleHelp, MonitorSmartphone, Search, SearchX, ShieldCheck, X, type LucideIcon } from 'lucide-react';
import { motion } from 'motion/react';
import { type KeyboardEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { AiMark } from '#components/brand/ai-mark';
import { useReducedMotionPref } from '#components/brand/use-reduced-motion';
import { buttonClasses } from '#components/ui/button';
import { FAQ, FAQ_GROUPS, faqGroupId } from '#content/faq';
import type { FaqEntry } from '#content/schema';
import { useArrival } from '#lib/arrival';
import { cn } from '#lib/cn';
import { ICON_STROKE, ICONS } from '#lib/icons';
import { ARRIVE, DUR, EASE_OUT, REDUCED_FADE, RISE } from '#lib/motion';
import { matchFaq, splitMatches, terms } from './faq-search';
import { InlineLink } from './inline-text';

type Group = FaqEntry['group'];

/** Each topic's glyph and the colour job its chip carries. */
export const FAQ_TOPICS: Readonly<Record<Group, { readonly icon: LucideIcon | 'ai'; readonly chip: string }>> = {
  'Making videos': { icon: ICONS.make, chip: 'bg-rose-soft text-rose-strong' },
  'Your footage and privacy': { icon: ShieldCheck, chip: 'bg-teal-soft text-teal-strong' },
  'Your AI': { icon: 'ai', chip: 'bg-violet-soft text-violet-strong' },
  'Platforms and price': { icon: MonitorSmartphone, chip: 'bg-sticker-sky text-sticker-sky-ink' },
};

export function TopicIcon({ group, className }: { readonly group: Group; readonly className?: string }) {
  const topic = FAQ_TOPICS[group];
  const Glyph = topic.icon;
  return (
    <span aria-hidden className={cn('inline-grid shrink-0 place-items-center rounded-xl', topic.chip, className)}>
      {Glyph === 'ai' ? <AiMark className="size-1/2!" /> : <Glyph strokeWidth={ICON_STROKE} className="size-1/2" />}
    </span>
  );
}

/** Text with the searched words marked. */
function Marked({ text, words }: { readonly text: string; readonly words: readonly string[] }) {
  if (words.length === 0) return <>{text}</>;
  return (
    <>
      {splitMatches(text, words).map((part, i) =>
        part.match ? (
          <mark key={i} className="rounded-sm bg-sticker-marigold px-0.5 text-sticker-marigold-ink">
            {part.text}
          </mark>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  );
}

function Question({ entry, open, words, onToggle, onKey, reduce }: {
  readonly entry: FaqEntry;
  readonly open: boolean;
  readonly words: readonly string[];
  readonly onToggle: () => void;
  readonly onKey: (e: KeyboardEvent<HTMLButtonElement>) => void;
  readonly reduce: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);
  // A closed answer is still found by the browser's find; finding it opens it.
  useEffect(() => {
    const el = panel.current;
    if (!el) return undefined;
    el.addEventListener('beforematch', onToggle);
    return () => el.removeEventListener('beforematch', onToggle);
  }, [onToggle]);
  // React writes hidden="" (the server HTML is closed; the noscript style shows it without JavaScript). Once running,
  // a closed answer becomes hidden="until-found", which takes no more room and lets the browser's find reach it.
  useEffect(() => {
    if (!open) panel.current?.setAttribute('hidden', 'until-found');
  }, [open]);
  return (
    <div data-slot="faq-item" data-open={open || undefined} className="border-b border-rule-subtle">
      <h3 id={entry.id} className="m-0">
        <button
          type="button"
          id={`${entry.id}-q`}
          data-slot="faq-question"
          aria-expanded={open}
          aria-controls={`${entry.id}-a`}
          onClick={onToggle}
          onKeyDown={onKey}
          className="group flex min-h-14 w-full items-start justify-between gap-6 py-5 text-left type-site-subhead text-balance text-ink transition-colors duration-(--dur-micro) ease-(--ease-out) hover:text-ink-2"
        >
          <span>
            <Marked text={entry.question} words={words} />
          </span>
          <motion.span
            aria-hidden
            animate={{ rotate: open ? 180 : 0 }}
            transition={reduce ? { duration: 0 } : { duration: DUR.short, ease: EASE_OUT }}
            className="mt-0.5 inline-grid size-8 shrink-0 place-items-center rounded-pill bg-sunken text-ink-2 group-hover:bg-hover group-hover:text-ink"
          >
            <ChevronDown strokeWidth={ICON_STROKE} className="size-4" />
          </motion.span>
        </button>
      </h3>
      <div ref={panel} id={`${entry.id}-a`} role="region" aria-labelledby={`${entry.id}-q`} data-faq-answer hidden={!open}>
        <motion.p
          key={open ? 'open' : 'closed'}
          initial={open ? (reduce ? { opacity: 0 } : { opacity: 0, y: RISE }) : false}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reduce ? REDUCED_FADE : DUR.long, ease: EASE_OUT }}
          className="m-0 max-w-[40em] pb-7 type-site-body text-pretty text-ink-2"
        >
          <Marked text={entry.answer} words={words} />
        </motion.p>
      </div>
    </div>
  );
}

function GroupBlock({ group, children, count }: { readonly group: Group; readonly children: ReactNode; readonly count: number }) {
  const ref = useRef<HTMLElement>(null);
  const reduce = useReducedMotionPref();
  const arrival = useArrival(ref, { reduce });
  const id = faqGroupId(group);
  return (
    <motion.section
      ref={ref}
      id={id}
      aria-labelledby={`${id}-title`}
      initial={false}
      animate={arrival}
      variants={{ hidden: { opacity: 0, y: ARRIVE.rise, transition: { duration: 0 } }, shown: { opacity: 1, y: 0, transition: { duration: ARRIVE.duration, ease: EASE_OUT } } }}
      className="flex scroll-mt-24 flex-col"
    >
      <h2 id={`${id}-title`} className="m-0 flex items-center gap-4 border-b border-rule pb-5 type-site-headline text-ink">
        <TopicIcon group={group} className="size-12 -rotate-6 shadow-sticker" />
        <span className="min-w-0">{group}</span>
        <span className="ms-auto type-timecode text-ink-3">{count}</span>
      </h2>
      {children}
    </motion.section>
  );
}

export function FaqBrowser() {
  const reduce = useReducedMotionPref();
  const [query, setQuery] = useState('');
  /** What the visitor opened or closed; anything else is open while the search matches its answer. */
  const [chosen, setChosen] = useState<ReadonlyMap<string, boolean>>(new Map());
  const input = useRef<HTMLInputElement>(null);
  const words = useMemo(() => terms(query), [query]);
  const shown = useMemo(() => FAQ.map((e) => ({ entry: e, match: matchFaq(e, words) })).filter((m) => m.match.any), [words]);
  const counts = (g: Group) => shown.filter((m) => m.entry.group === g).length;
  const isOpen = (id: string, inAnswer: boolean) => chosen.get(id) ?? inAnswer;
  const allOpen = shown.length > 0 && shown.every((m) => isOpen(m.entry.id, m.match.inAnswer));
  const choose = (ids: readonly string[], open: boolean) =>
    setChosen((prev) => {
      const next = new Map(prev);
      for (const id of ids) next.set(id, open);
      return next;
    });

  // A new search may open answers again that the visitor closed under the last one.
  useEffect(() => {
    setChosen((prev) => new Map([...prev].filter(([, open]) => open)));
  }, [words]);

  // /faq/#footage-leaves opens its answer, on load and on every later jump.
  useEffect(() => {
    const openHash = () => {
      const id = decodeURIComponent(window.location.hash.slice(1));
      if (FAQ.some((e) => e.id === id)) choose([id], true);
    };
    openHash();
    window.addEventListener('hashchange', openHash);
    return () => window.removeEventListener('hashchange', openHash);
  }, []);

  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('[data-slot="faq-question"]')];
    const at = buttons.indexOf(e.currentTarget);
    const to = e.key === 'ArrowDown' ? at + 1 : e.key === 'ArrowUp' ? at - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? buttons.length - 1 : null;
    if (to === null || buttons.length === 0) return;
    e.preventDefault();
    buttons[(to + buttons.length) % buttons.length]?.focus();
  };

  const status =
    words.length === 0
      ? `${FAQ.length} questions in ${FAQ_GROUPS.length} topics`
      : shown.length === 0
        ? `No question matches “${query.trim()}”`
        : `${shown.length} ${shown.length === 1 ? 'question matches' : 'questions match'} “${query.trim()}”`;

  return (
    <div className="px-gutter pb-section-bottom">
      {/* Without JavaScript the accordion can't open, so every answer shows and the search, which can't run, hides. */}
      <noscript>
        <style>{'@layer base{[data-faq-answer][hidden]{display:block!important;content-visibility:visible!important}}[data-slot="faq-search"]{display:none!important}'}</style>
      </noscript>
      <div className="mx-auto grid max-w-site gap-x-16 gap-y-12 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)]">
        <div className="flex flex-col gap-8 lg:sticky lg:top-[calc(var(--spacing-nav)+2rem)] lg:self-start">
          <div data-slot="faq-search" className="flex flex-col gap-3">
            <label htmlFor="faq-search" className="type-label font-semibold text-ink">
              Search the questions
            </label>
            <div className="relative">
              <Search aria-hidden strokeWidth={ICON_STROKE} className="pointer-events-none absolute top-1/2 left-4 size-5 -translate-y-1/2 text-ink-3" />
              <input
                ref={input}
                id="faq-search"
                type="search"
                value={query}
                autoComplete="off"
                spellCheck={false}
                placeholder="Try “phone” or “ChatGPT”"
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape' && query) {
                    e.preventDefault();
                    setQuery('');
                  }
                }}
                className="h-13 w-full rounded-pill border border-rule-strong bg-raised ps-12 pe-12 type-site-body text-ink shadow-sm transition-[border-color,box-shadow] duration-(--dur-micro) ease-(--ease-out) placeholder:text-ink-3 hover:border-ink-3 [&::-webkit-search-cancel-button]:appearance-none"
              />
              {query ? (
                <button
                  type="button"
                  onClick={() => {
                    setQuery('');
                    input.current?.focus();
                  }}
                  className="absolute top-1/2 right-2 inline-grid size-9 -translate-y-1/2 place-items-center rounded-pill text-ink-2 transition-colors duration-(--dur-micro) hover:bg-hover hover:text-ink active:bg-pressed"
                >
                  <X aria-hidden strokeWidth={ICON_STROKE} className="size-4" />
                  <span className="sr-only">Clear the search</span>
                </button>
              ) : null}
            </div>
            <p role="status" className="m-0 type-meta text-ink-2">
              {status}
            </p>
          </div>
          <nav aria-label="Topics">
            <ul className="m-0 flex list-none flex-wrap gap-2 p-0 lg:flex-col lg:gap-1">
              {FAQ_GROUPS.map((g) => {
                const n = counts(g);
                const inner = (
                  <>
                    <TopicIcon group={g} className="size-8" />
                    <span className="min-w-0 flex-1">{g}</span>
                    <span className="type-timecode text-ink-3">{n}</span>
                  </>
                );
                return (
                  <li key={g}>
                    {n > 0 ? (
                      <a
                        href={`#${faqGroupId(g)}`}
                        className="flex min-h-11 items-center gap-3 rounded-pill py-1.5 ps-1.5 pe-4 type-label text-ink-2 transition-colors duration-(--dur-micro) ease-(--ease-out) hover:bg-hover hover:text-ink active:bg-pressed lg:rounded-xl"
                      >
                        {inner}
                      </a>
                    ) : (
                      <span className="flex min-h-11 items-center gap-3 py-1.5 ps-1.5 pe-4 type-label text-ink-disabled opacity-70">{inner}</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </nav>
          <button
            type="button"
            data-slot="faq-search"
            disabled={shown.length === 0}
            onClick={() => choose(shown.map((m) => m.entry.id), !allOpen)}
            className={buttonClasses('quiet', 'md', 'self-start')}
          >
            <ChevronDown aria-hidden strokeWidth={ICON_STROKE} className={cn('size-4 transition-transform duration-(--dur-short)', allOpen ? 'rotate-180' : '')} />
            {allOpen ? 'Close all answers' : 'Open all answers'}
          </button>
        </div>

        <div className="flex min-w-0 flex-col gap-16">
          {FAQ_GROUPS.map((g) => {
            const items = shown.filter((m) => m.entry.group === g);
            if (items.length === 0) return null;
            return (
              <GroupBlock key={g} group={g} count={items.length}>
                {items.map(({ entry, match }) => {
                  const open = isOpen(entry.id, match.inAnswer);
                  return <Question key={entry.id} entry={entry} words={words} open={open} onToggle={() => choose([entry.id], !open)} onKey={onKey} reduce={reduce} />;
                })}
              </GroupBlock>
            );
          })}
          {shown.length === 0 ? (
            <div role="group" aria-label="No match" className="flex flex-col items-start gap-5 rounded-reel bg-sunken p-8 sm:p-10">
              <span aria-hidden className="inline-grid size-14 -rotate-6 place-items-center rounded-2xl bg-sticker-pink text-sticker-pink-ink shadow-sticker">
                <SearchX strokeWidth={ICON_STROKE} className="size-7" />
              </span>
              <p className="m-0 type-site-subhead text-ink">No question matches “{query.trim()}”.</p>
              <p className="m-0 max-w-[36em] type-site-body text-ink-2">
                Try another word, or ask us on the <InlineLink href="/contact/">contact page</InlineLink>.
              </p>
              <button type="button" onClick={() => setQuery('')} className={buttonClasses('secondary', 'md')}>
                <CircleHelp aria-hidden strokeWidth={ICON_STROKE} className="size-4" />
                Clear the search
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
