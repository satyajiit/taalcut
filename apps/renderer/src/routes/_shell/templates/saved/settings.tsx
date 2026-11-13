// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { useLingui } from '@lingui/react/macro';
import { createFileRoute } from '@tanstack/react-router';
import { SavedFrame } from '../../../../features/templates/saved/saved-page';
import { SavedSettings } from '../../../../features/templates/saved/saved-settings';
import { useSaved } from '../../../../features/templates/saved/use-saved';

/** Saved on Instagram's settings (UX4 tpl): the account and the watched collections. Settings › Accounts links here. */
export const Route = createFileRoute('/_shell/templates/saved/settings')({
  component: Settings,
});

const NO_SEARCH = {};

function Settings() {
  const { t } = useLingui();
  const saved = useSaved(null, NO_SEARCH);
  return (
    <SavedFrame saved={saved} detail={t`Settings`} settings>
      <SavedSettings saved={saved} />
    </SavedFrame>
  );
}
