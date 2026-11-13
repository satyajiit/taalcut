// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: Settings › General › Kaatu and tips (UX4) · genre: atmospheric studio app (chrome
 *   modern-minimal) · system: DESIGN.md v0.6 + UX4 (Kaatu as a companion, _orch/ux4/specs/design-shell.md)
 * one grouped list: Show Kaatu (a switch row, on by default, kept on this computer like Interface sounds; off, the
 *   companion and every decorative Kaatu go and their words stay) and the first-visit tips (Show tips again brings
 *   back every tip that was dismissed)
 * states: Show Kaatu: on · off · changed in another window (the switch follows). Tips: none dismissed (the button
 *   disabled, the line says how tips work) · some dismissed (how many) · brought back (the button's success tick,
 *   held 1.6 s, and a polite announcement) */
import { Plural, Trans, useLingui } from '@lingui/react/macro';
import { Button, PageSection, SUCCESS_HOLD_MS, VERB_ICONS } from '@taalcut/ui';
import { useEffect, useState } from 'react';
import { useShowKaatu } from '../../kaatu/kaatu-preference';
import { dismissedTips, resetTips } from '../../kaatu/tips';
import { SettingRow, SettingRows } from '../rows';
import { SETTINGS_ICONS } from '../settings-icons';
import { SwitchRow } from '../switch-row';

/** How many tips are dismissed: read when the section opens and after Show tips again. */
function useDismissedCount(): [number, () => void] {
  const [count, setCount] = useState(() => dismissedTips().size);
  return [count, () => setCount(dismissedTips().size)];
}

export function KaatuSection() {
  const { t } = useLingui();
  const [shown, setShown] = useShowKaatu();
  const [dismissed, reread] = useDismissedCount();
  const [backAt, setBackAt] = useState<number | null>(null);

  // The tick holds as long as every finished button's does (the kit's SUCCESS_HOLD_MS), then the words come back.
  useEffect(() => {
    if (backAt === null) return;
    const timer = window.setTimeout(() => setBackAt(null), SUCCESS_HOLD_MS);
    return () => window.clearTimeout(timer);
  }, [backAt]);

  const bringBack = () => {
    resetTips();
    reread();
    setBackAt(Date.now());
  };

  return (
    <PageSection
      title={<Trans>Kaatu and tips</Trans>}
      icon={SETTINGS_ICONS.help}
      description={<Trans>Kaatu, the beaver, keeps you company and points out what each page can do.</Trans>}
    >
      <SettingRows aria-label={t`Kaatu and tips`}>
        <SwitchRow
          as="li"
          data-setting="show-kaatu"
          label={<Trans>Show Kaatu</Trans>}
          description={<Trans>Kaatu keeps you company in the sidebar and in moments. Off, the words stay.</Trans>}
          checked={shown}
          onChange={setShown}
        />
        <SettingRow
          data-setting="tips"
          title={<Trans>First-visit tips</Trans>}
          description={
            dismissed > 0 ? (
              <Plural
                value={dismissed}
                one="You dismissed # tip. Bring it back to see it once more."
                other="You dismissed # tips. Bring them back to see each once more."
              />
            ) : (
              <Trans>Each page offers one tip, once, until you dismiss it.</Trans>
            )
          }
          control={
            <Button
              size="sm"
              icon={VERB_ICONS.retry}
              status={backAt === null ? undefined : 'success'}
              disabled={dismissed === 0 && backAt === null}
              onClick={bringBack}
            >
              {backAt === null ? <Trans>Show tips again</Trans> : <Trans>Tips are back</Trans>}
            </Button>
          }
        />
      </SettingRows>
      <p aria-live="polite" className="sr-only">
        {backAt === null ? '' : t`Every tip shows again on its page.`}
      </p>
    </PageSection>
  );
}
