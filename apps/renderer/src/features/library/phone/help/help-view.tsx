// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · page: Help (/library/phone/help) · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 · hairline sections, as Settings: why a phone can't connect over Wi-Fi (same network, VPN,
 *   the firewall, Local Network, the camera, public Wi-Fi), then the cable's own prompts, then what phones remember
 *   (paired phones; Android's USB debugging key) with the action that forgets it. Off a Mac (UX3-MAC) there is no
 *   Local Network switch and no cable yet, so those rows and the cable's section aren't shown, and the firewall row
 *   is the one a blocked check points at. A check the session itself points
 *   at ("Taalcut's check couldn't reach this Mac") is flagged on its row, with an icon and words.
 * states: rows are static · flagged (warning glyph and "This may be it") · forget rows (forget-row.tsx)
 */
import { plural } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import { callRpc } from '@taalcut/core';
import { Badge, usePlatformFeatures } from '@taalcut/ui';
import type { LucideIcon } from 'lucide-react';
import {
  Cable,
  Camera,
  Network,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  TriangleAlert,
  Wifi,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useBackend } from '../../../../backend/backend';
import { Section } from '../../../settings/fields';
import { usePhoneFlow } from '../session/phone-flow';
import { ForgetRow } from './forget-row';

function Tip({
  icon: Icon,
  title,
  flagged = false,
  children,
}: {
  icon: LucideIcon;
  title: ReactNode;
  flagged?: boolean;
  children: ReactNode;
}) {
  const { t } = useLingui();
  return (
    <li data-slot="phone-tip" data-flagged={flagged || undefined} className="flex gap-3 py-3.5">
      <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-ink-2" />
      <div className="flex max-w-prose min-w-0 flex-col gap-1">
        <p className="m-0 flex flex-wrap items-center gap-2 type-card-title text-ink">
          {title}
          {flagged ? (
            <Badge tone="warning" shape="chip">
              <TriangleAlert aria-hidden />
              {t`This may be it`}
            </Badge>
          ) : null}
        </p>
        <p className="m-0 type-body text-ink-2">{children}</p>
      </div>
    </li>
  );
}

const TIPS = 'm-0 list-none divide-y divide-rule-subtle p-0';

export function HelpView() {
  const { t } = useLingui();
  const backend = useBackend();
  const { transfer } = usePhoneFlow();
  const { cableImport, localNetworkPrivacy } = usePlatformFeatures();
  const reachable = transfer.session?.network?.reachable;
  return (
    <div className="flex flex-col gap-10">
      <Section title={t`If your phone can’t connect`}>
        <ul className={TIPS}>
          <Tip icon={Wifi} title={t`The same Wi-Fi`}>
            {t`Your phone and this Mac need to be on the same Wi-Fi. Guest and hotel networks often keep devices apart, so use your home or office network.`}
          </Tip>
          <Tip icon={ShieldAlert} title={t`A VPN or security app`} flagged={reachable === 'blocked'}>
            {t`A VPN or security app can stop your phone reaching this Mac. Pause it while you send, then try again.`}
          </Tip>
          {/* Off a Mac a firewall's refusal is what Taalcut's check calls blocked: this row may be it. */}
          <Tip
            icon={ShieldCheck}
            title={t`The Mac’s firewall`}
            flagged={!localNetworkPrivacy && reachable === 'blocked'}
          >
            <Trans>
              If macOS asked whether Taalcut may accept incoming connections and you chose Deny, phones can’t
              connect. Allow Taalcut in System Settings, Network, Firewall, Options.
            </Trans>
          </Tip>
          {/* macOS's own switch (platform-features.ts); no other system has one. */}
          {localNetworkPrivacy ? (
            <Tip icon={Network} title={t`Local Network`} flagged={reachable === 'local-network-denied'}>
              <Trans>
                Phones can send with it off. Turning on Local Network for Taalcut in System Settings, Privacy
                & Security only lets Taalcut check the connection itself.
              </Trans>
            </Tip>
          ) : null}
          <Tip icon={Camera} title={t`The camera won’t scan`}>
            {t`Open the address under the code in the phone’s browser, then type the setup code and the PIN.`}
          </Tip>
          <Tip icon={Smartphone} title={t`Keep the page open on the phone`}>
            {t`Phones stop sending when the page closes or the screen locks. Clips carry on from where they stopped once you’re back.`}
          </Tip>
        </ul>
      </Section>

      {/* The cable is a Mac's for now (platform-features.ts): its prompts and its key only matter there. */}
      {cableImport ? (
        <Section
          title={t`With a cable`}
          description={t`No network needed, and nothing travels over Wi-Fi. Use it on public networks too.`}
        >
          <ul className={TIPS}>
            <Tip icon={Cable} title={t`iPhone`}>
              {t`Unlock it and tap Trust, then enter your passcode.`}
            </Tip>
            <Tip icon={Cable} title={t`Android`}>
              {t`Unlock it, tap the USB notification and choose File transfer.`}
            </Tip>
            <Tip icon={Cable} title={t`Another app has the phone`}>
              {t`Quit Photos, Preview, Image Capture, Google Drive, Dropbox or Smart Switch, then unplug the phone and plug it in again.`}
            </Tip>
          </ul>
        </Section>
      ) : null}

      <Section title={t`What phones remember`}>
        <div className="flex flex-col divide-y divide-rule-subtle">
          <ForgetRow
            title={t`Paired phones`}
            description={t`A phone stays paired for a day after it last sends, so it can carry on if this page closes. Forget them and every phone needs a new code and PIN.`}
            action={t`Forget paired phones`}
            run={() => callRpc(backend.transfer.forgetDevices())}
            done={({ forgotten }) =>
              forgotten > 0
                ? plural(forgotten, {
                    one: 'Forgot # phone. It needs a new code and PIN.',
                    other: 'Forgot # phones. Each needs a new code and PIN.',
                  })
                : t`No phones were paired.`
            }
          />
          {cableImport ? (
            <ForgetRow
              title={t`USB debugging key`}
              description={t`Android phones with USB debugging on remember this Mac. Forget the key and they ask to allow it again.`}
              action={t`Forget USB debugging key`}
              run={() => callRpc(backend.transfer.forgetUsbDebugKey())}
              done={({ forgotten }) => (forgotten ? t`Forgot the key.` : t`There was no key to forget.`)}
            />
          ) : null}
        </div>
      </Section>
    </div>
  );
}
