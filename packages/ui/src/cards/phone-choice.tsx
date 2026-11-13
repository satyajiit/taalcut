// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: source picker, from my phone · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 · "From my phone" opens a two-way choice (the kit's segmented control): With a cable and
 *   Over Wi-Fi, the cable first when a phone is already on one; the chosen way's panel (the app's, through
 *   CardData.phonePanel) shows under it on the same bed, never a card inside the card. Where the cable isn't yet
 *   (off a Mac, UX3-MAC's platform-features.ts) there is no choice: the Wi-Fi panel opens itself
 * states: default (closed: the secondary button) · hover/focus/active (Button, the segmented options) · disabled (a
 *   folder being added) · open (the choice, nothing picked yet) · loading, error and success (the panel's own: the
 *   Wi-Fi page and the cable picker say them) · reduced motion (the choice and panel appear at once)
 * pre-emit critique: P4 H5 E4 S5 R5 V4 · slop: pass (component gates: 4, 5, 10, 14, 23, 26, 30, 36, 40–41, 48, 49)
 */
import { useLingui } from '@lingui/react/macro';
import { useEffect, useId, useState } from 'react';
import { Button } from '#components/button';
import { Segmented, type SegmentedOption } from '#components/segmented';
import { useCardActions } from './card-actions';
import { usePlatformFeatures } from '../platform/platform-features';
import { useCardData } from './card-data';
import type { PhoneMethod } from './card-data-phase3';

/** Whether a phone is on a cable now, as the app reports it (false until it says, and where there is no cable). */
function usePhoneOnCable(cable: boolean): boolean {
  const { watchPhoneOnCable } = useCardData();
  const [listed, setListed] = useState(false);
  useEffect(
    () => (cable && watchPhoneOnCable ? watchPhoneOnCable(setListed) : undefined),
    [cable, watchPhoneOnCable],
  );
  return listed;
}

/** "From my phone": the two ways in, and the chosen way's panel. Needs the app's phonePanel. */
export function PhoneChoice({ disabled }: { disabled: boolean }) {
  const { t } = useLingui();
  const { phonePanel } = useCardData();
  const { cableImport } = usePlatformFeatures();
  const onCable = usePhoneOnCable(cableImport);
  const [open, setOpen] = useState(false);
  const [chosen, setMethod] = useState<PhoneMethod | null>(null);
  const panelId = useId();
  if (!phonePanel) return null;
  const method: PhoneMethod | null = cableImport ? chosen : 'wifi';
  const cable: SegmentedOption<PhoneMethod> = { value: 'cable', label: t`With a cable` };
  const wifi: SegmentedOption<PhoneMethod> = { value: 'wifi', label: t`Over Wi-Fi` };
  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        disabled={disabled}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((was) => !was)}
      >
        {t`From my phone`}
      </Button>
      {open ? (
        <div id={panelId} data-slot="phone-choice" className="flex basis-full flex-col gap-3">
          {cableImport ? (
            <Segmented
              label={t`How to bring in your phone’s clips`}
              value={method}
              options={onCable ? [cable, wifi] : [wifi, cable]}
              onChange={setMethod}
              className="self-start"
            />
          ) : null}
          {method ? (
            <div data-slot="phone-panel" data-method={method} className="flex flex-col gap-3">
              {phonePanel(method)}
            </div>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

/**
 * The source picker's phone way: "From my phone" when the app hosts the phone panels (Wi-Fi or a cable, P3-B4),
 * else Connect phone, which opens the Wi-Fi page as before.
 */
export function PhoneWay({ disabled }: { disabled: boolean }) {
  const { t } = useLingui();
  const actions = useCardActions();
  const { phonePanel } = useCardData();
  if (phonePanel) return <PhoneChoice disabled={disabled} />;
  if (!actions.navigate) return null;
  return (
    <Button
      variant="secondary"
      size="sm"
      disabled={disabled}
      onClick={() => actions.navigate?.({ to: 'phone' })}
    >
      {t`Connect phone`}
    </Button>
  );
}
