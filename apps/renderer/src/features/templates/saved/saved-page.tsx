// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · page frame: Saved on Instagram (/templates/saved, /templates/saved/$collectionId and
 *   /templates/saved/settings; UX3, UX4 tpl) · system: DESIGN.md v0.6 + UX4 (Page, EmptyState; design-tpl.md)
 * the Templates views first, with who is signed in and the way to Saved's settings at the row's end once signed
 *   in; one sentence on what this place does; then, signed out, the one Instagram sign-in (instagram-sign-in.tsx),
 *   or, signed in, the open page: a collection (saved-collection.tsx) or the settings (saved-settings.tsx). The bar
 *   reads "Templates › Saved on Instagram", then the collection's name or Settings
 * states: loading (the "templates-saved" bones) · signed out (the sign-in) · signed in (the page) · error (the
 *   cause, Try again; a later one above the page, which stays)
 */
import { Trans, useLingui } from '@lingui/react/macro';
import { INSTAGRAM_WARNING } from '@taalcut/core';
import { Button, ErrorLine, Skeleton, VERB_ICONS } from '@taalcut/ui';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useServices } from '../../../services/provider';
import { Page } from '../../../shell/page';
import { TEMPLATE_ICONS } from '../template-icons';
import { TemplatesViews } from '../templates-views';
import { InstagramSignIn } from './instagram-sign-in';
import { SavedBones } from './saved-bones';
import type { Saved } from './use-saved';

export interface SavedFrameProps {
  readonly saved: Saved;
  /** What is open, after "Saved on Instagram" in the bar: a collection's name, Settings. */
  readonly detail?: ReactNode;
  readonly settings?: boolean;
  /** `?warning=`: the feature whose warning to open on the sign-in. */
  readonly warning?: string | undefined;
  /** The open page, once signed in. */
  readonly children: ReactNode;
}

function Account({ saved, settings }: { saved: Saved; settings: boolean }) {
  const { t } = useLingui();
  return (
    <span className="flex min-w-0 items-center gap-1 type-meta text-ink-2" data-slot="saved-account">
      <span className="truncate" dir="auto" translate="no">
        {saved.username ? `@${saved.username}` : t`Signed in`}
      </span>
      <Button asChild size="sm" variant="ghost" icon={TEMPLATE_ICONS.settings}>
        <Link to="/templates/saved/settings" aria-current={settings ? 'page' : undefined}>
          {t`Settings`}
        </Link>
      </Button>
    </span>
  );
}

export function SavedFrame({ saved, detail, settings = false, warning, children }: SavedFrameProps) {
  const { t } = useLingui();
  const ackStore = useServices().acknowledgements;
  const { state } = saved;
  const views = (
    <TemplatesViews current="saved">
      {saved.signedIn ? <Account saved={saved} settings={settings} /> : null}
    </TemplatesViews>
  );
  return (
    <Page title={t`Saved on Instagram`} width="wide" views={views} {...(detail ? { detail } : {})}>
      <p className="m-0 max-w-prose type-body text-ink-2" data-slot="saved-intro">
        {t`Browse the Reels you saved on Instagram, turn any saved Reel into a template, or watch a collection so new saves appear here automatically.`}
      </p>
      {state.error && !state.data ? (
        <div className="flex flex-col items-start gap-3">
          <ErrorLine error={state.error} />
          <Button size="sm" icon={VERB_ICONS.retry} onClick={state.reload}>
            <Trans>Try again</Trans>
          </Button>
        </div>
      ) : (
        <Skeleton name="templates-saved" loading={!state.data} fixture={<SavedBones />}>
          {state.error && state.data ? <ErrorLine error={state.error} onRetry={state.reload} /> : null}
          {state.data && !saved.signedIn ? (
            <InstagramSignIn
              ackStore={ackStore}
              signingIn={saved.signingIn}
              error={saved.authError}
              onSignIn={(acknowledgedAt) => void saved.signIn(acknowledgedAt)}
              openWarning={warning === INSTAGRAM_WARNING.feature}
            />
          ) : state.data ? (
            children
          ) : null}
        </Skeleton>
      )}
    </Page>
  );
}
