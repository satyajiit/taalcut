// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
'use client';

/* component: legal document · mode: Read · system: WEB2 Remix Vernacular
 * states: contents link default (ink-2, its icon ink-3) · hover (ink, hover ground) · focus (base ring) · active
 *   (pressed ground) · current (the section you are reading: ink, raised ground, its segment filled; aria-current) ·
 *   read (the segments before it filled) · sections arrive once each (rise 16 px and fade) · reduced motion (no rise)
 *   · without JavaScript (every section shown, no current mark)
 * The privacy notice and the terms, made comfortable to read: a sticky table of contents with an icon per section
 * beside the text from 1024 px up (wrapped chips above it below that), the reading position as a segmented bar down
 * the contents, a measure near 70 characters, and each section anchored by its id (/privacy/#waitlist). The gist box
 * and the date line sit at the top. */

import {
  Baby,
  Building2,
  CalendarClock,
  Cookie,
  ExternalLink,
  FileText,
  Globe,
  History,
  Landmark,
  Laptop,
  ListPlus,
  Mail,
  MapPin,
  MessageSquare,
  Scale,
  Send,
  Server,
  ShieldAlert,
  type LucideIcon,
} from 'lucide-react';
import { motion } from 'motion/react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useReducedMotionPref } from '#components/brand/use-reduced-motion';
import type { GistRow, LegalBlock, LegalDoc, LegalSection } from '#content/legal';
import { useArrival } from '#lib/arrival';
import { cn } from '#lib/cn';
import { ICON_STROKE } from '#lib/icons';
import { ARRIVE, EASE_OUT } from '#lib/motion';
import { FactsList } from './facts-list';
import { InlineText } from './inline-text';

/** Each section's glyph, by its id (the ids are the same on both documents where the subject is). */
const SECTION_ICONS: Readonly<Record<string, LucideIcon>> = {
  who: Building2,
  'by-default': Cookie,
  'after-sending': Send,
  waitlist: ListPlus,
  'contact-form': MessageSquare,
  processors: Server,
  where: MapPin,
  rights: Scale,
  children: Baby,
  'the-app': Laptop,
  changes: History,
  using: Globe,
  'no-warranty': ShieldAlert,
  licences: FileText,
  links: ExternalLink,
  contact: Mail,
  law: Landmark,
};

export function sectionIcon(id: string): LucideIcon {
  return SECTION_ICONS[id] ?? FileText;
}

function Block({ block }: { readonly block: LegalBlock }) {
  if (block.kind === 'p') {
    return (
      <p className="m-0 max-w-[40em] type-site-body text-pretty text-ink-2">
        <InlineText text={block.text} />
      </p>
    );
  }
  if (block.kind === 'list') {
    return (
      <ul className="m-0 flex max-w-[40em] list-none flex-col gap-2.5 p-0 type-site-body text-ink-2">
        {block.items.map((item) => (
          <li key={item} className="flex items-start gap-3">
            <span aria-hidden className="mt-[0.6lh] size-1.5 shrink-0 -translate-y-1/2 rounded-pill bg-ink-3" />
            <span className="min-w-0 text-pretty">
              <InlineText text={item} />
            </span>
          </li>
        ))}
      </ul>
    );
  }
  return <FactsList facts={block.facts} className="max-w-[46em]" />;
}

/** The date the notice last changed, as a chip under the lead. */
export function LegalStatus({ text }: { readonly text: string }) {
  return (
    <p role="note" className="m-0 inline-flex w-fit max-w-full items-center gap-2 rounded-pill bg-sunken px-4 py-2 type-label text-ink">
      <CalendarClock aria-hidden strokeWidth={ICON_STROKE} className="size-4 shrink-0 text-ink-2" />
      {text}
    </p>
  );
}

/** The notice in a few short lines, each linking to the section that says it in full. */
export function LegalGist({ heading, rows }: { readonly heading: string; readonly rows: readonly GistRow[] }) {
  return (
    <aside aria-labelledby="gist-title" className="px-gutter pb-section-bottom">
      <div className="mx-auto max-w-site">
        <div className="rounded-reel bg-sticker-teal p-6 text-sticker-teal-ink shadow-sticker sm:p-10">
          <h2 id="gist-title" className="m-0 flex items-center gap-3 type-site-subhead">
            <span aria-hidden className="inline-grid size-10 -rotate-6 place-items-center rounded-xl bg-sticker-cut text-sticker-teal-ink shadow-sm">
              <Cookie strokeWidth={ICON_STROKE} className="size-5" />
            </span>
            {heading}
          </h2>
          <ul className="m-0 mt-6 grid list-none gap-x-10 gap-y-4 p-0 md:grid-cols-2">
            {rows.map((row) => {
              const Icon = sectionIcon(row.section);
              return (
                <li key={row.text} className="flex items-start gap-3">
                  <Icon aria-hidden strokeWidth={ICON_STROKE} className="mt-[0.15lh] size-5 shrink-0" />
                  <a href={`#${row.section}`} className="type-site-body font-medium text-pretty text-sticker-teal-ink underline decoration-current/30 decoration-1 underline-offset-4 transition-[text-decoration-color] duration-(--dur-micro) hover:decoration-current">
                    {row.text}
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </aside>
  );
}

function DocSection({ section }: { readonly section: LegalSection }) {
  const ref = useRef<HTMLElement>(null);
  const reduce = useReducedMotionPref();
  const arrival = useArrival(ref, { reduce });
  const Icon = sectionIcon(section.id);
  return (
    <motion.section
      ref={ref}
      id={section.id}
      data-legal-section
      aria-labelledby={`${section.id}-title`}
      initial={false}
      animate={arrival}
      variants={{ hidden: { opacity: 0, y: ARRIVE.rise, transition: { duration: 0 } }, shown: { opacity: 1, y: 0, transition: { duration: ARRIVE.duration, ease: EASE_OUT } } }}
      className="flex flex-col gap-5 border-t border-rule-subtle py-12 first:border-t-0 first:pt-0"
    >
      <h2 id={`${section.id}-title`} className="m-0 flex items-start gap-4 type-site-subhead text-balance text-ink">
        <span aria-hidden className="inline-grid size-10 shrink-0 -rotate-3 place-items-center rounded-xl bg-sunken text-ink-2">
          <Icon strokeWidth={ICON_STROKE} className="size-5" />
        </span>
        <span className="pt-1.5">{section.heading}</span>
      </h2>
      {section.blocks.map((b, i) => (
        <Block key={i} block={b} />
      ))}
    </motion.section>
  );
}

/** The section in view: the last whose top has passed a third of the way down the screen. */
function useCurrent(ids: readonly string[]): number {
  const [current, setCurrent] = useState(-1);
  useEffect(() => {
    const els = ids.map((id) => document.getElementById(id)).filter((el): el is HTMLElement => el !== null);
    if (els.length === 0) return undefined;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const line = window.innerHeight / 3;
      let at = -1;
      els.forEach((el, i) => {
        if (el.getBoundingClientRect().top <= line) at = i;
      });
      setCurrent(at);
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [ids]);
  return current;
}

export function LegalBody({ doc, label, children }: { readonly doc: LegalDoc; readonly label: string; readonly children?: ReactNode }) {
  const ids = useRef(doc.sections.map((s) => s.id)).current;
  const current = useCurrent(ids);
  return (
    <div className="px-gutter pb-section-bottom">
      <div className="mx-auto grid max-w-site gap-x-16 gap-y-10 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)]">
        <nav aria-label={label} className="lg:sticky lg:top-[calc(var(--spacing-nav)+2rem)] lg:self-start">
          <p className="m-0 mb-3 hidden type-label font-semibold text-ink lg:block">On this page</p>
          <ol className="m-0 flex list-none flex-wrap gap-2 p-0 lg:flex-col lg:gap-0.5">
            {doc.sections.map((s, i) => {
              const Icon = sectionIcon(s.id);
              const now = i === current;
              return (
                <li key={s.id} className="flex items-stretch gap-3">
                  <span aria-hidden className="hidden w-1 shrink-0 overflow-hidden rounded-pill bg-rule-subtle lg:block">
                    <span className={cn('block size-full origin-top rounded-pill bg-ink transition-transform duration-(--dur-short) ease-(--ease-out) motion-reduce:transition-none', i <= current ? 'scale-y-100' : 'scale-y-0')} />
                  </span>
                  <a
                    href={`#${s.id}`}
                    aria-current={now ? 'location' : undefined}
                    className={cn(
                      'inline-flex min-h-9 flex-1 items-center gap-2.5 rounded-pill border border-rule-subtle px-3 type-label transition-colors duration-(--dur-micro) ease-(--ease-out) active:bg-pressed lg:min-h-10 lg:rounded-lg lg:border-transparent',
                      now ? 'bg-raised text-ink shadow-sm' : 'text-ink-2 hover:bg-hover hover:text-ink',
                    )}
                  >
                    <Icon aria-hidden strokeWidth={ICON_STROKE} className={cn('size-4 shrink-0', now ? 'text-ink' : 'text-ink-3')} />
                    <span className="min-w-0">{s.heading}</span>
                  </a>
                </li>
              );
            })}
          </ol>
        </nav>
        <div className="flex min-w-0 flex-col">
          {children}
          {doc.sections.map((s) => (
            <DocSection key={s.id} section={s} />
          ))}
        </div>
      </div>
    </div>
  );
}
