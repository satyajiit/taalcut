// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · page: Wi-Fi (/library/phone/wifi) · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 · the QR as the hero with the steps beside it (wifi-way.tsx), its links opening the
 *   Transfers and Help tabs; showing this tab is what makes the Mac listen
 * states: wifi-way.tsx's (bones, waiting, connected, lost, dormant)
 */
import { PHONE_TAB_PATHS, tabLink } from '../flow/phone-tabs';
import { usePhoneFlow } from '../session/phone-flow';
import { WifiWay } from './wifi-way';

export function WifiTab() {
  const { transfer } = usePhoneFlow();
  return (
    <WifiWay
      transfer={transfer}
      transfersLink={tabLink(PHONE_TAB_PATHS.transfers)}
      helpLink={tabLink(PHONE_TAB_PATHS.help)}
    />
  );
}
