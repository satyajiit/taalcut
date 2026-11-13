// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { useLingui } from '@lingui/react/macro';
import { Button, VERB_ICONS } from '@taalcut/ui';
import { Link } from '@tanstack/react-router';

export function LibraryActions() {
  const { t } = useLingui();
  return (
    <Button asChild size="sm" variant="primary" icon={VERB_ICONS.import}>
      <Link to="/library/import">{t`Import`}</Link>
    </Button>
  );
}
