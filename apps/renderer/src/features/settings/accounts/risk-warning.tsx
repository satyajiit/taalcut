// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The warning card (PRD 10.1, P1-H2's WarningCard) in front of Claude, Copilot
 * and Grok logins. Main says which card and terms version (accounts state);
 * the acknowledgement is kept in the app's AcknowledgementStore, the same one
 * main checks before it starts the login.
 */
import { msg } from '@lingui/core/macro';
import { Trans, useLingui } from '@lingui/react/macro';
import {
  Button,
  WarningCard,
  useHostPlatform,
  type Acknowledgement,
  type AcknowledgementStore,
} from '@taalcut/ui';
import type { SignInWarning, WarnedLogin } from '@taalcut/core';
import { translateKey } from '../model-messages';

export interface RiskWarningProps {
  readonly provider: WarnedLogin;
  readonly warning: SignInWarning;
  /** Translated name of the service, e.g. "Claude". */
  readonly service: string;
  readonly store: AcknowledgementStore;
  /** "I understand" was recorded (now, or the first time for this terms version). */
  onAcknowledged(acknowledgement: Acknowledgement): void;
  /** The one-tap safer choice: an API key instead. */
  onSaferChoice(): void;
  onCancel(): void;
}

const FALLBACK_BODY = msg`This sign-in wasn’t made for Taalcut. The provider hasn’t said other apps may use it.`;
const FALLBACK_RISK = msg`The provider could block these requests or limit your account. An API key avoids this.`;

export function RiskWarning({
  provider,
  warning,
  service,
  store,
  onAcknowledged,
  onSaferChoice,
  onCancel,
}: RiskWarningProps) {
  const { i18n, t } = useLingui();
  const platform = useHostPlatform();
  return (
    <div className="flex flex-col items-start gap-2">
      <WarningCard
        topic={warning.feature}
        termsVersion={warning.termsVersion}
        store={store}
        context={{ provider }}
        title={translateKey(i18n, warning.titleKey, msg`Before you sign in to ${service}`, platform)}
        risk={
          <>
            <p className="m-0">{translateKey(i18n, warning.bodyKey, FALLBACK_BODY, platform)}</p>
            <p className="m-0 mt-2">{translateKey(i18n, warning.riskKey, FALLBACK_RISK, platform)}</p>
          </>
        }
        bearer={
          <Trans>You do. It’s your {service} account, and Taalcut can’t undo a block or a limit.</Trans>
        }
        saferAlternative={{ label: t`Use an API key instead`, onSelect: onSaferChoice }}
        onAcknowledged={onAcknowledged}
      />
      <Button variant="ghost" size="sm" onClick={onCancel}>
        <Trans>Not now</Trans>
      </Button>
    </div>
  );
}
