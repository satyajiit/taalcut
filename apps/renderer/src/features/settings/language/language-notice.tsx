// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { Trans } from '@lingui/react/macro';

/** Keep the supported scope visible before a contributor selects an incomplete translation. */
export function LanguageNotice() {
  return (
    <p className="m-0 text-sm text-ink-3">
      <Trans>
        English is supported and used for automatic selection. Other languages are incomplete drafts for
        contributors.
      </Trans>
    </p>
  );
}
