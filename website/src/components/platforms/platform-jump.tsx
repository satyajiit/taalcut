// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* component: platform jump · three sticker links to the platforms below, each with its SVGL icon and name
 * mode: Persuade · system: WEB2 Remix Vernacular (stickers as links)
 * states: default (the sticker at its tilt) · hover (it straightens and lifts) · focus (base ring around the link)
 *   · active (gives 3%) · reduced motion (no lift). Plain links: they work without JavaScript. */

import { BrandIcon, type BrandIconId } from '#components/brand/brand-icon';
import { PLATFORMS_PAGE } from '#content/platforms';
import type { PlatformId } from '#content/schema';
import { cn } from '#lib/cn';

const JUMPS: readonly {
  readonly id: PlatformId;
  readonly brand: BrandIconId;
  readonly face: string;
  readonly tilt: string;
}[] = [
  { id: 'macos', brand: 'apple', face: 'bg-sticker-sky text-sticker-sky-ink', tilt: '-rotate-3' },
  { id: 'ubuntu', brand: 'ubuntu', face: 'bg-sticker-paper text-sticker-paper-ink', tilt: 'rotate-2' },
  { id: 'windows', brand: 'windows', face: 'bg-sticker-violet text-sticker-violet-ink', tilt: '-rotate-2' },
];

export function PlatformJump() {
  return (
    <nav aria-label={PLATFORMS_PAGE.jump}>
      <ul className="m-0 flex list-none flex-wrap gap-3 p-0">
        {JUMPS.map((j) => (
          <li key={j.id}>
            <a
              href={`#${j.id}`}
              className={cn(
                'inline-flex h-12 items-center gap-2.5 rounded-pill px-5 type-sticker shadow-sticker select-none',
                'transition-[rotate,translate,scale] duration-(--dur-short) ease-(--ease-out)',
                'hover:-translate-y-0.5 hover:rotate-0 active:scale-[0.97] motion-reduce:transition-none motion-reduce:hover:translate-y-0',
                j.face,
                j.tilt,
              )}
            >
              <BrandIcon id={j.brand} themeAware={false} className="size-5" />
              {PLATFORMS_PAGE.platforms[j.id].heading}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
