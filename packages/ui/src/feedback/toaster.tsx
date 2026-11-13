// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { useLingui } from '@lingui/react/macro';
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-react';
import { Toast } from 'radix-ui';
import { useSyncExternalStore } from 'react';
import { buttonVariants } from '#components/button';
import { cn } from '#lib/cn';
import { toastStore as defaultStore, type ToastEntry, type ToastStore, type ToastTone } from './toast-store';

const ICONS = { info: Info, success: CircleCheck, warning: TriangleAlert, danger: CircleAlert } as const;

const ICON_COLOUR: Record<ToastTone, string> = {
  info: 'text-info-strong',
  success: 'text-success-strong',
  warning: 'text-warning-strong',
  danger: 'text-danger-strong',
};

/** Time for the exit animation before a closed toast leaves the queue. */
const EXIT_MS = 200;

export interface ToasterProps {
  store?: ToastStore;
}

/**
 * Renders the toast queue at the top right, under the window's toolbar, away
 * from the composer (DESIGN.md, "Toasts"). Mount once, at the root. F8 moves
 * focus to the toasts (Radix Toast); each one closes on its own, with its
 * close button, or with a swipe.
 */
export function Toaster({ store = defaultStore }: ToasterProps) {
  const { t } = useLingui();
  const entries = useSyncExternalStore(store.subscribe, store.list);
  // Radix replaces {hotkey} with the shortcut's name.
  const hotkey = '{hotkey}';
  return (
    <Toast.Provider label={t`Notification`} swipeDirection="right">
      {entries.map((entry) => (
        <ToastItem key={entry.id} entry={entry} store={store} />
      ))}
      <Toast.Viewport
        label={t`Notifications (${hotkey})`}
        className="fixed top-toolbar right-0 z-50 m-0 flex w-96 max-w-[100vw] list-none flex-col gap-2 p-4"
      />
    </Toast.Provider>
  );
}

function ToastItem({ entry, store }: { entry: ToastEntry; store: ToastStore }) {
  const { t } = useLingui();
  const tone = entry.tone ?? 'info';
  const Icon = ICONS[tone];
  const duration = entry.duration ?? (tone === 'warning' || tone === 'danger' ? 8000 : 5000);
  return (
    <Toast.Root
      data-slot="toast"
      data-tone={tone}
      open={entry.open}
      duration={duration}
      type={tone === 'danger' ? 'foreground' : 'background'}
      onOpenChange={(open) => {
        if (open) return;
        store.dismiss(entry.id);
        setTimeout(() => store.remove(entry.id), EXIT_MS);
      }}
      className={cn(
        'flex items-start gap-3 rounded-lg border border-rule bg-raised p-3 text-ink shadow-md',
        // Enters from the edge it sits on: 16 px in from the right and a fade (--dur-short, --ease-out), by
        // @starting-style; leaves faster, as a fade (Radix waits for the animation). Reduced motion: fades only.
        'translate-x-0 opacity-100 transition-[translate,opacity] duration-(--dur-short) ease-(--ease-out)',
        'starting:translate-x-4 starting:opacity-0',
        'data-[state=closed]:animate-fade-out',
        'data-[swipe=move]:translate-x-(--radix-toast-swipe-move-x) data-[swipe=move]:transition-none',
        'data-[swipe=cancel]:translate-x-0 data-[swipe=end]:translate-x-(--radix-toast-swipe-end-x) data-[swipe=end]:animate-fade-out',
      )}
    >
      <Icon aria-hidden className={cn('mt-0.5 size-4 shrink-0', ICON_COLOUR[tone])} />
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <Toast.Title className="type-card-title">{entry.title}</Toast.Title>
        {entry.description ? (
          <Toast.Description className="type-meta text-ink-2">{entry.description}</Toast.Description>
        ) : null}
        {entry.action ? (
          <Toast.Action
            altText={entry.action.label}
            className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }), 'mt-2 self-start')}
            onClick={entry.action.onSelect}
          >
            {entry.action.label}
          </Toast.Action>
        ) : null}
      </div>
      <Toast.Close
        aria-label={t`Close`}
        className={cn(buttonVariants({ variant: 'ghost', size: 'icon' }), 'size-7 shrink-0')}
      >
        <X aria-hidden />
      </Toast.Close>
    </Toast.Root>
  );
}
