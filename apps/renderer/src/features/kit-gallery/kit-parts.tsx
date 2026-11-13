// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · page part: the UI kit's frame (UX4) · system: DESIGN.md v0.6 + UX4
 * each gallery on /dev/kit is a kit PageSection (icon-led, divided), and each state is a figure with its name under
 * it, so the page is built from the anatomy it shows */
import { PageSection, type IconComponent } from '@taalcut/ui';
import type { ReactNode } from 'react';

/** One gallery: a divided, icon-led section of the kit page. */
export function KitSection({
  title,
  icon,
  description,
  children,
}: {
  title: ReactNode;
  icon?: IconComponent;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <PageSection divided title={title} icon={icon} description={description}>
      {children}
    </PageSection>
  );
}

/** A part inside a gallery (h3). */
export function KitPart({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <PageSection level={3} title={title}>
      {children}
    </PageSection>
  );
}

/** One state of a component, named under it. */
export function KitState({ label, children }: { label: string; children: ReactNode }) {
  return (
    <figure className="m-0 flex flex-col items-start gap-1.5">
      {children}
      <figcaption className="type-caption text-ink-3">{label}</figcaption>
    </figure>
  );
}

/** A row of states that wraps, each column wide enough for the widest language. */
export function KitStates({ children, min = '10rem' }: { children: ReactNode; min?: string }) {
  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${min}, 1fr))` }}>
      {children}
    </div>
  );
}

/** The focus ring as base.css draws it, for showing the focus state without focus. */
export const SHOW_FOCUS = 'outline-2 outline-offset-2 outline-focus';
