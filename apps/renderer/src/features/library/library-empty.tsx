// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { Trans, useLingui } from '@lingui/react/macro';
import { Button, CONCEPT_ICONS, EmptyState } from '@taalcut/ui';
import { Link } from '@tanstack/react-router';

export function LibraryEmpty() {
  const { t } = useLingui();
  return (
    <div
      className="flex min-h-72 flex-col justify-center gap-6 rounded-xl border border-dashed border-rule-strong p-8"
      data-slot="drop-zone"
    >
      <EmptyState
        icon={CONCEPT_ICONS.library}
        title={t`Bring your footage together`}
        description={t`Drop files or folders here, or import from your phone, camera or Apple Photos. Review every import before it starts.`}
        action={
          <Button asChild variant="secondary">
            <Link to="/library/import">{t`Choose a source`}</Link>
          </Button>
        }
      />
      <p className="m-0 text-center type-meta text-ink-2">
        <Trans>Your originals stay safe. Taalcut keeps copies by default and skips exact duplicates.</Trans>
      </p>
    </div>
  );
}
export function NoClipsYet({ importing }: { importing: boolean }) {
  const { t } = useLingui();
  return (
    <EmptyState
      icon={CONCEPT_ICONS.library}
      kaatu={importing ? false : 'idle'}
      title={importing ? t`Your clips are on their way` : t`No clips here yet`}
      description={
        importing
          ? t`They appear here as Taalcut finds them. You can keep working meanwhile.`
          : t`Import footage from a source, or check Imports for saved originals and files that need attention.`
      }
      action={
        importing ? undefined : (
          <Button asChild variant="secondary">
            <Link to="/library/import">{t`Choose a source`}</Link>
          </Button>
        )
      }
    />
  );
}
