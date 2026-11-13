// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* component: ai-mark · system: WEB2 Remix Vernacular · DESIGN.md v0.7.2 · states: n/a (static mark)
 * The app's AI mark (packages/ui/src/brand ai-mark): the Avartan's four beats with beat three and the core in full,
 * the rest at 45%. It replaces every sparkle. Colour comes from the text colour (text-ai-strong). 1em square unless the
 * caller passes a size-* class (the default is world.css's, at zero specificity, so the caller's wins). */

import { cn } from '#lib/cn';

const BEATS = [
  'M142.45 16.88A112 112 0 0 1 232.16 85.72L167.15 103.14A46 46 0 0 0 142.45 84.18Z',
  'M239.41 112.76A112 112 0 0 1 142.45 239.12L142.45 192.5A66 66 0 0 0 194.37 124.83Z',
  'M114.45 239.12A112 112 0 0 1 24.73 170.28L55.99 161.91A80 80 0 0 0 114.45 206.77Z',
  'M17.49 143.24A112 112 0 0 1 114.45 16.88L114.45 63.5A66 66 0 0 0 62.52 131.17Z',
] as const;
const CORE = 'M128 92L139 117L164 128L139 139L128 164L117 139L92 128L117 117Z';

export function AiMark({ label, className }: { readonly label?: string; readonly className?: string }) {
  return (
    <svg
      data-slot="ai-mark"
      viewBox="14 14 228 228"
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn('shrink-0 fill-current', className)}
    >
      {BEATS.map((d, i) => (
        <path key={d} fillRule="evenodd" d={d} opacity={i === 2 ? 1 : 0.45} />
      ))}
      <path d={CORE} />
    </svg>
  );
}
