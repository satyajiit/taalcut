// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { useLingui } from '@lingui/react/macro';
import { CONCEPT_ICONS, ViewLink, ViewLinks } from '@taalcut/ui';
import { Link, useRouterState } from '@tanstack/react-router';

export function LibraryViews() {
  const { t } = useLingui();
  const path = useRouterState({ select: (state) => state.location.pathname });
  return (
    <ViewLinks label={t`Library views`}>
      <ViewLink asChild current={path === '/library' || path === '/library/'} icon={CONCEPT_ICONS.library}>
        <Link to="/library">{t`Clips`}</Link>
      </ViewLink>
      <ViewLink asChild current={path.startsWith('/library/sources')} icon={CONCEPT_ICONS.folder}>
        <Link to="/library/sources">{t`Sources`}</Link>
      </ViewLink>
      <ViewLink asChild current={path.startsWith('/library/imports')} icon={CONCEPT_ICONS.transfer}>
        <Link to="/library/imports">{t`Imports`}</Link>
      </ViewLink>
    </ViewLinks>
  );
}
