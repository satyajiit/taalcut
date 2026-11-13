// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { useLingui } from '@lingui/react/macro';
import { Link } from '@tanstack/react-router';
import { useBackend } from '../../../backend/backend';
import { useRpcStream } from '../../../backend/use-rpc';

export function ActiveImports() {
  const { t, i18n } = useLingui();
  const backend = useBackend();
  const live = useRpcStream((signal) => backend.imports.watch({}, { signal }), [backend]);
  const active =
    live.data?.sessions.filter((session) => ['running', 'paused', 'interrupted'].includes(session.status)) ??
    [];
  if (!active.length) return null;
  const count = new Intl.NumberFormat(i18n.locale).format(active.length);
  return (
    <Link
      to="/library/imports"
      className="flex items-center justify-between gap-4 border-y border-rule-subtle py-3 type-body text-ink"
    >
      <span>{t`${count} imports in progress`}</span>
      <span className="type-label underline underline-offset-4">{t`View progress`}</span>
    </Link>
  );
}
