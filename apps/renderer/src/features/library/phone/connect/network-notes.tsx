// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: network notes · genre: atmospheric studio app · system: DESIGN.md v0.3
 * one line each, an icon and a plain sentence (status is never colour alone): warnings above the QR, where they
 *   change what you do (a VPN may block the phone; someone typed wrong PINs, so the code is new); the standing
 *   notes under it (same Wi-Fi; no encryption on the Wi-Fi, use a cable on networks you don't trust)
 * states: warning (warning-strong) · information (ink-2); static
 */
import { useLingui } from '@lingui/react/macro';
import type { TransferSession } from '@taalcut/core';
import { cn, usePlatformFeatures } from '@taalcut/ui';
import { Info, ShieldAlert, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';

function Note({ tone, children }: { tone: 'warning' | 'info' | 'trust'; children: ReactNode }) {
  const Icon = tone === 'warning' ? TriangleAlert : tone === 'trust' ? ShieldAlert : Info;
  return (
    <p
      data-slot="phone-note"
      data-tone={tone}
      className={cn(
        'm-0 flex max-w-prose items-start gap-2 type-body',
        tone === 'warning' ? 'text-warning-strong' : 'text-ink-2',
      )}
    >
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}

/** What changes how you connect, above the QR. Nothing when all is well. */
export function NetworkWarnings({ session }: { session: TransferSession | null }) {
  const { t } = useLingui();
  const { localNetworkPrivacy } = usePlatformFeatures();
  const reachable = session?.network?.reachable;
  const notes = [
    session && session.pairingResets > 0 ? (
      <Note key="reset" tone="warning">
        {t`Someone on this network typed a wrong PIN five times, so Taalcut made a new code and PIN. Phones already connected carry on.`}
      </Note>
    ) : null,
    reachable === 'blocked' ? (
      <Note key="blocked" tone="warning">
        {t`A VPN or security app may stop your phone reaching this Mac. If the phone can’t connect, pause it and try again.`}
      </Note>
    ) : null,
    // macOS's Local Network switch; no other system has one (platform-features.ts).
    reachable === 'local-network-denied' && localNetworkPrivacy ? (
      <Note key="local" tone="info">
        {t`Your phone can still send clips. To let Taalcut check the connection itself, turn on Local Network for Taalcut in System Settings, Privacy & Security.`}
      </Note>
    ) : null,
  ].filter((note) => note !== null);
  return notes.length > 0 ? <div className="flex flex-col gap-2">{notes}</div> : null;
}

/** The standing notes, under the QR; `lead`: a note of the surface's own first (first run's line for iPhones). */
export function NetworkFinePrint({ lead }: { lead?: ReactNode } = {}) {
  const { t } = useLingui();
  return (
    <div className="flex flex-col gap-2 border-t border-rule-subtle pt-5">
      {lead ? <Note tone="info">{lead}</Note> : null}
      <Note tone="info">
        {t`Your phone needs to be on the same Wi-Fi. Guest networks often keep devices apart.`}
      </Note>
      {/* Plain HTTP on the local network (security review SB-16, option A for the beta); the cable path needs none. */}
      <Note tone="trust">
        {t`Clips travel over your Wi-Fi without encryption, so use this on a network you trust. On public Wi-Fi, bring them in with a cable instead.`}
      </Note>
    </div>
  );
}
