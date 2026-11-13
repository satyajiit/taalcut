// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · component: a community template's two actions (/templates/start/community/$hubId; UX4 tpl)
 *   · system: DESIGN.md v0.6 + UX4 (design-tpl.md, "The Start from… card": the same two verbs as the cards)
 * Use for a video, the page's one marigold: copied into your templates (or the copy this Mac has), then a chat that
 *   makes a video from it. Copy to my templates, secondary (UX1 M23: not "Fork"); once there is a copy, Open my copy
 *   takes its place and a teal line says it is in your templates
 * states: default · hover · focus-visible · active (the Button's) · Use loading (copying, then the chat opens) ·
 *   Copy loading ("Copying") · copied (Open my copy, "In your templates"; ⌘Z removes the copy) · error (the cause
 *   under them, with its fix) · disabled (the other action while one runs)
 */
import { useLingui } from '@lingui/react/macro';
import type { HubBrowseItem, TaalcutError, TemplateId } from '@taalcut/core';
import { Button, ErrorLine } from '@taalcut/ui';
import { CircleCheck } from 'lucide-react';
import { useState } from 'react';
import { useStartActions, type Copyable } from '../start/use-start';
import { TEMPLATE_ICONS } from '../template-icons';

export function ForkControl({ item }: { readonly item: HubBrowseItem }) {
  const { t } = useLingui();
  const actions = useStartActions();
  const [busy, setBusy] = useState<'use' | 'copy' | null>(null);
  const [made, setMade] = useState<TemplateId | null>(null);
  const [error, setError] = useState<TaalcutError | null>(null);
  const copy = made ?? item.forkedAs;
  const source: Copyable = {
    kind: 'community',
    hubId: item.id,
    version: item.version,
    sha256: item.sha256,
    forkedAs: copy,
  };

  const run = async (what: 'use' | 'copy') => {
    setBusy(what);
    setError(null);
    const done = what === 'use' ? await actions.use(source, item.name) : await actions.copy(source);
    setBusy(null);
    if (!done.ok) setError(done.error);
    else if (what === 'copy') setMade(done.value.templateId);
  };

  return (
    <div data-slot="hub-fork" className="flex flex-col items-start gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="primary"
          icon={TEMPLATE_ICONS.makeVideo}
          loading={busy === 'use'}
          disabled={busy === 'copy'}
          onClick={() => void run('use')}
          data-action="use"
        >
          {t`Use for a video`}
        </Button>
        {copy ? (
          <Button icon={TEMPLATE_ICONS.open} onClick={() => actions.open(copy)} data-action="open-copy">
            {t`Open my copy`}
          </Button>
        ) : (
          <Button
            icon={TEMPLATE_ICONS.copy}
            loading={busy === 'copy'}
            disabled={busy === 'use'}
            onClick={() => void run('copy')}
            data-action="copy"
          >
            {busy === 'copy' ? t`Copying` : t`Copy to my templates`}
          </Button>
        )}
      </div>
      {copy ? (
        <span role="status" className="flex items-center gap-1.5 type-meta text-you-strong">
          <CircleCheck aria-hidden className="size-4" />
          {t`In your templates`}
        </span>
      ) : null}
      {error ? <ErrorLine error={error} /> : null}
    </div>
  );
}
