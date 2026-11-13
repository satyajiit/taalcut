// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* component: button and button link · mode: Persuade · system: WEB2 Remix Vernacular (One Marigold Rule)
 * states: default · hover (marigold-hover / control-hover) · focus (base ring, instant) · active (2% give)
 *   · disabled (the control face whatever the variant, so a disabled button never holds the screen's marigold;
 *   ink-disabled label, not-allowed cursor, no hover or give) · loading (aria-busy, spinner, words stay) · error/success: owned by the form
 * A screen has one primary (marigold) fill: the page's waitlist button. Everything else is secondary or quiet. */

import Link from 'next/link';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { buttonClasses, type ButtonSize, type ButtonVariant } from './button-classes';

export { buttonClasses, type ButtonSize, type ButtonVariant };

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
}

export function Button({ variant, size, className, type = 'button', ...props }: ButtonProps) {
  return <button type={type} className={buttonClasses(variant, size, className)} {...props} />;
}

export interface ButtonLinkProps {
  readonly href: string;
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly className?: string;
  readonly children: ReactNode;
}

export function ButtonLink({ href, variant, size, className, children }: ButtonLinkProps) {
  const external = /^https?:/.test(href);
  if (external) {
    return (
      <a href={href} className={buttonClasses(variant, size, className)} rel="noopener noreferrer" target="_blank">
        {children}
      </a>
    );
  }
  return (
    // Paths come from content/site and content/pages, which the pages test checks against the routes.
    <Link href={href as never} className={buttonClasses(variant, size, className)}>
      {children}
    </Link>
  );
}
