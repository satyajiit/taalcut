// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: window title with its way up (crumbs) · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.4 ("Window": Title, Back, forward and up)
 * states (a crumb): default (ink-2, 500) · hover (ink on the hover surface) · focus (base ring, instant) ·
 *   active (pressed surface) · inactive window (ink-3). Not disabled, loading, error or success: a crumb exists
 *   only where there is a page above, and going there is the answer (the global loader shows a slow one).
 * motion: none; the bar is never animated (DESIGN.md "Window").
 * contrast: pass (ink-2 and ink-3 on canvas, the hover surface and the pressed one: design/contrast-report.md)
 */
import { useLingui } from '@lingui/react/macro';
import { cn, UserContent, WindowTitle, type WindowTitleProps } from '@taalcut/ui';
import { useChildMatches, useMatch, useRouter } from '@tanstack/react-router';
import { ChevronRight } from 'lucide-react';
import { Fragment, useEffect, useMemo, useRef, type MouseEvent, type ReactNode } from 'react';
import { useCrumbWords } from './crumb-words';
import { crumbText, crumbTrail, ownCrumb, type Crumb } from './crumbs';
import { useHistoryNav } from './use-history-nav';

const Chevron = () => <ChevronRight aria-hidden className="size-4 shrink-0 text-ink-3" />;

/** '/library/' and '/library' are one page; '/projects?archived=true' and '/projects' are two views of one. */
const samePage = (a: string | null, b: string) =>
  a !== null && a.replace(/\/+(?=\?|$)/, '') === b.replace(/\/+$/, '');

/**
 * The way up from the page this title belongs to (its own route, not the URL a pending navigation is heading to). A
 * layout that names the page (a template's frame, over Overview, Slots, Pacing and Details) speaks for the page open
 * under it: its deepest child on screen.
 */
function useCrumbs(): { trail: Crumb[]; own: Crumb | null; detailRoute: boolean } {
  const router = useRouter();
  const ownPath = useMatch({ strict: false, select: (match) => match.pathname });
  const ownRoute = useMatch({ strict: false, select: (match) => match.routeId });
  const childPath = useChildMatches({ select: (matches) => matches.at(-1)?.pathname });
  const childRoute = useChildMatches({ select: (matches) => matches.at(-1)?.routeId });
  const pathname = childPath ?? ownPath;
  const routeId = childRoute ?? ownRoute;
  const names = useCrumbWords();
  return useMemo(
    () => ({
      trail: crumbTrail(router, pathname, names),
      own: ownCrumb(router, pathname, names),
      detailRoute: (routeId ?? '').includes('$'),
    }),
    [router, pathname, routeId, names],
  );
}

/**
 * A crumb: a link to the page above. When that page is the one Back leads to
 * (you came down from it), it steps back instead, so the list comes back as
 * you left it: its search, its scroll and the clip you opened.
 */
function CrumbLink({
  crumb,
  previous,
  onBack,
}: {
  crumb: Crumb;
  previous: string | null;
  onBack: () => void;
}) {
  const { i18n } = useLingui();
  const router = useRouter();
  const go = (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault();
    if (samePage(previous, crumb.to)) onBack();
    else void router.navigate({ href: crumb.to });
  };
  // Crumbs in UI words are short and kept whole: 224 px holds the longest in the pseudo-locale ("From your phone",
  // 196 px). A name a page gave (a chat's, a template's) is cut at the same width, whole in the tooltip.
  const text = crumbText(i18n, crumb);
  const words = crumb.words;
  return (
    <a
      href={router.history.createHref(crumb.to)}
      data-slot="window-crumb"
      onClick={go}
      {...(words ? { title: text } : {})}
      {...(words?.own ? { translate: 'no' as const } : {})}
      className={cn(
        'app-no-drag -mx-2 -my-0.5 max-w-56 shrink-0 truncate rounded-md px-2 py-0.5 font-medium text-ink-2',
        'transition-colors duration-(--dur-micro) ease-(--ease-out) hover:bg-hover hover:text-ink active:bg-pressed',
        'window-inactive:text-ink-3',
      )}
    >
      {words?.own ? <UserContent>{text}</UserContent> : text}
    </a>
  );
}

/**
 * The page's name in the window bar with the way up before it (DESIGN.md
 * "Window", v0.4): "Library › IMG_2034", the parent a link. A page under
 * another (by path, or by its route's `up`) shows each page above it that is
 * a crumb; what is open (`detail`) takes the place of the page's own name,
 * which on a detail page is its area's. Until the detail has loaded, or when
 * there is none, the way up stands alone. A view of a page that is a crumb
 * ("Make › Archived") makes the page's name a link to it, unfiltered. Pages
 * with nothing above them read as before: their name, and what is open after
 * a quiet chevron.
 */
export function NavTitle({ title, detail, as: Tag = 'h1' }: WindowTitleProps) {
  const { i18n } = useLingui();
  const { trail: above, own, detailRoute } = useCrumbs();
  const nav = useHistoryNav();
  // A view of a page that is a crumb, with what it shows as its detail ("Make › Archived"): its name leads back up.
  const trail = detail && own && !detailRoute ? [...above, own] : above;
  if (trail.length === 0) return <WindowTitle title={title} {...(detail ? { detail } : {})} as={Tag} />;
  const parent = trail.at(-1);
  const ownName = detailRoute || (parent && crumbText(i18n, parent) === title) ? null : title;
  const current = detail ?? ownName;
  return (
    <Tag
      data-slot="window-title"
      // The crumbs' hover pills reach 8 px past their words; the title's own padding holds them, in place. On the
      // right only when a crumb ends the title: what is open ends at the bar's edge for the title, so a long name
      // fills the room and no more (it would push the title 8 px past its slot at the smallest window).
      className={cn(
        'm-0 -ml-2 flex min-w-0 items-center gap-1 pl-2 type-page-title text-ink window-inactive:text-ink-3',
        !current && '-mr-2 pr-2',
      )}
    >
      {trail.map((crumb, index) => (
        <Fragment key={crumb.to}>
          <CrumbLink crumb={crumb} previous={nav.previous} onBack={nav.back} />
          {index < trail.length - 1 || current ? <Chevron /> : null}
        </Fragment>
      ))}
      {current ? <OpenName>{current}</OpenName> : null}
    </Tag>
  );
}

/**
 * What is open, after the crumbs. Cut with an ellipsis when the bar is short of room. A person's own words (a
 * template's or a chat's name) keep all of themselves in the tooltip, as a list cuts them, and aren't offered for
 * translation; a view's name (translated UI words) stays as it is.
 */
function OpenName({ children }: { children: ReactNode }) {
  const name = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = name.current;
    if (!el) return;
    const sync = () => {
      const own = el.querySelector('[data-user-content]') !== null;
      const text = el.textContent?.trim() ?? '';
      if (own && text) {
        if (el.title !== text) el.title = text;
        el.setAttribute('translate', 'no');
      } else {
        el.removeAttribute('title');
        el.removeAttribute('translate');
      }
    };
    sync();
    // The name can arrive or change inside the slot without this re-rendering (a chat named after its first answer).
    const watch = new MutationObserver(sync);
    watch.observe(el, { childList: true, subtree: true, characterData: true });
    return () => watch.disconnect();
  }, []);
  return (
    <span ref={name} data-slot="window-title-open" className="min-w-0 truncate">
      {children}
    </span>
  );
}
