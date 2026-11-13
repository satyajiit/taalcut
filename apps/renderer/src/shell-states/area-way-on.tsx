// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* component: a message page's way on, to its own area (UX4, B23) · system: DESIGN.md v0.6 "Message pages"
 * a page that isn't there (a clip, a project or a template whose id is wrong or deleted) or a page that failed with
 *   no history to go back to: the way on goes to the area it was in ("Back to Library"), not always to the chat.
 *   Anywhere outside an area (or in the Agent's), it is the chat, as before.
 * states (a link set as words, MESSAGE_LINK): default (underlined, primary-strong) · hover (thicker underline) · focus
 *   (base ring) · active · disabled: n/a
 */
import { useLingui } from '@lingui/react/macro';
import { Link, useRouterState } from '@tanstack/react-router';
import { AREAS, isUnder, type Area } from '../shell/areas';

/** The area a path is inside (its home included), or null: the chat is then the way on. */
export function areaOf(pathname: string): Area | null {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return AREAS.find((area) => area.id !== 'agent' && isUnder(path, area.paths)) ?? null;
}

/** Where a message page's way on goes, and its words. */
export function useAreaWayOn(): {
  readonly to: Area['to'];
  readonly label: string;
  readonly area: Area | null;
} {
  const { t, i18n } = useLingui();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const area = areaOf(pathname);
  if (!area) return { to: '/chat', label: t`Go to chat`, area: null };
  const name = i18n._(area.label);
  return { to: area.to, label: t`Back to ${name}`, area };
}

/** The way on as one link: to the page's own area, or the chat. */
export function AreaWayOn({ className }: { className: string }) {
  const way = useAreaWayOn();
  return (
    <Link to={way.to} className={className} data-action="way-on" data-area={way.area?.id}>
      {way.label}
    </Link>
  );
}
