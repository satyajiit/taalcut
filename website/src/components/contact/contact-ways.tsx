// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* component: contact ways · the one address and Instagram, each a row you can act on
 * mode: Persuade · system: WEB2 Remix Vernacular (a share sheet's rows: a tilted sticker chip with the glyph that leans
 *   toward a fine pointer, the
 *   address as a mailto link, one line, and Copy; Instagram with its own SVGL icon in colour)
 * states: row default · hover (the hover surface) · links default (ink, rule-strong underline) · hover (underline
 *   ink) · focus (base ring) · the Copy button's own (copy-button.tsx) · without JavaScript (the address is a working
 *   mailto; Copy isn't shown) */

import { ArrowUpRight, Mail, MessageCircleHeart } from 'lucide-react';
import { BrandMark } from '#components/brand/brand-mark';
import { CONTACT_PAGE } from '#content/contact';
import { SITE } from '#content/site';
import { cn } from '#lib/cn';
import { ICON_STROKE } from '#lib/icons';
import { CopyButton } from './copy-button';
import { LeanChip } from './lean-chip';
import { FIELD_FACES, INLINE_LINK } from './styles';

const ADDRESS_ID = 'contact-address';

const ROW =
  'flex items-center gap-4 rounded-2xl px-3 py-3 transition-colors duration-(--dur-micro) hover:bg-hover';
const CHIP = 'inline-grid size-11 shrink-0 place-items-center rounded-2xl shadow-sticker';

export function ContactWays({
  headingId,
  className,
}: {
  readonly headingId: string;
  readonly className?: string;
}) {
  return (
    <aside aria-labelledby={headingId} className={cn('flex flex-col gap-4', className)}>
      <h2 id={headingId} className="m-0 type-site-subhead text-ink">
        {CONTACT_PAGE.waysHeading}
      </h2>
      <ul className="m-0 -mx-3 flex list-none flex-col gap-1 p-0">
        <li className={ROW}>
          <LeanChip className={cn(CHIP, FIELD_FACES.pink, '-rotate-6')}>
            <Mail strokeWidth={ICON_STROKE} className="size-5" />
          </LeanChip>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <a
              id={ADDRESS_ID}
              href={`mailto:${CONTACT_PAGE.mailbox.address}`}
              className={cn(INLINE_LINK, 'self-start type-label [overflow-wrap:anywhere]')}
            >
              {CONTACT_PAGE.mailbox.address}
            </a>
            <span className="type-meta text-ink-2">{CONTACT_PAGE.mailbox.line}</span>
          </span>
          <CopyButton text={CONTACT_PAGE.mailbox.address} target={ADDRESS_ID} />
        </li>
        <li className={ROW}>
          <LeanChip className={cn(CHIP, FIELD_FACES.violet, 'rotate-6')}>
            <MessageCircleHeart strokeWidth={ICON_STROKE} className="size-5" />
          </LeanChip>
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <a
              href={SITE.instagram.url}
              rel="me noopener noreferrer"
              className={cn(INLINE_LINK, 'self-start type-label')}
            >
              {CONTACT_PAGE.instagram.title}{' '}
              <BrandMark
                id="instagram"
                name="Instagram"
                className="underline decoration-rule-strong decoration-1 underline-offset-4"
              />
            </a>
            <span className="type-meta text-ink-2">
              {SITE.instagram.handle} · {CONTACT_PAGE.instagram.line}
            </span>
          </span>
          <ArrowUpRight aria-hidden strokeWidth={ICON_STROKE} className="me-2 size-5 shrink-0 text-ink-3" />
        </li>
      </ul>
    </aside>
  );
}
