// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { useLingui } from '@lingui/react/macro';
import { X } from 'lucide-react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { useState, type ComponentProps } from 'react';
import { cn } from '#lib/cn';
import { HOVER_EASE } from '#lib/motion-classes';
/* Hallmark · component: dialog · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md v0.6 + UX4
 * a modal for what needs protected focus: the overlay surface, 2xl radius, the lg shadow; it rises 4 px and grows
 *   from 0.98 as it fades in (--dur-short) and fades out faster; the scrim fades. Title type-section (the dialog's
 *   h2), description type-meta. Focus goes back to what opened it.
 * states: n/a for the frame (its controls carry theirs); the close button: default, hover (eased), focus, active
 * reduced motion: the fades alone */

export const Dialog = DialogPrimitive.Root;
export const DialogTrigger = DialogPrimitive.Trigger;
export const DialogClose = DialogPrimitive.Close;
export const DialogPortal = DialogPrimitive.Portal;

export function DialogOverlay({ className, ...props }: ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        'fixed inset-0 z-50 bg-scrim data-[state=open]:animate-fade-in data-[state=closed]:animate-fade-out',
        className,
      )}
      {...props}
    />
  );
}

export function DialogContent({
  className,
  children,
  showClose = true,
  onCloseAutoFocus,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & { showClose?: boolean }) {
  const { t } = useLingui();
  // What had focus when it opened. Radix gives focus back only to a DialogTrigger; a dialog opened from a
  // button's onClick or a URL would leave it on the page (WCAG 2.4.3), so it goes back here, if still there.
  const [opener] = useState(() => (typeof document === 'undefined' ? null : document.activeElement));
  return (
    <DialogPortal>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          'fixed top-1/2 left-1/2 z-50 grid w-[calc(100%-2rem)] max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4',
          'rounded-2xl border border-rule-subtle bg-overlay p-6 text-ink shadow-lg',
          'data-[state=open]:animate-enter data-[state=closed]:animate-exit',
          'motion-reduce:data-[state=open]:animate-fade-in motion-reduce:data-[state=closed]:animate-fade-out',
          className,
        )}
        onCloseAutoFocus={(event) => {
          onCloseAutoFocus?.(event);
          if (event.defaultPrevented || !(opener instanceof HTMLElement) || !opener.isConnected) return;
          if (opener === document.body) return;
          event.preventDefault();
          opener.focus();
        }}
        {...props}
      >
        {children}
        {showClose ? (
          <DialogPrimitive.Close
            className={cn(
              'absolute top-4 right-4 inline-flex size-8 cursor-pointer items-center justify-center rounded-md text-ink-3',
              HOVER_EASE,
              'hover:bg-hover hover:text-ink active:bg-pressed [&_svg]:size-4',
            )}
          >
            <X aria-hidden />
            <span className="sr-only">{t`Close`}</span>
          </DialogPrimitive.Close>
        ) : null}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

export function DialogHeader({ className, ...props }: ComponentProps<'div'>) {
  return <div data-slot="dialog-header" className={cn('flex flex-col gap-1.5 pr-8', className)} {...props} />;
}

export function DialogFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn('flex flex-wrap items-center justify-end gap-2', className)}
      {...props}
    />
  );
}

export function DialogTitle({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn('m-0 type-section text-ink', className)}
      {...props}
    />
  );
}

export function DialogDescription({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn('m-0 type-meta text-ink-2', className)}
      {...props}
    />
  );
}
