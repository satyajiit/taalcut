// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · page: a community template (/templates/start/community/$hubId, was /templates/hub/$hubId;
 *   P3-B12, P3-V8, UX4 tpl) · system: DESIGN.md v0.6 + UX4
 * one page, as the owner decided: the window bar reads "Templates › Start from… › Community › Morning café"; the page
 *   is the detail (hub-detail.tsx) or why it can't be shown. The way back is the bar's (Back, ⌘[ and the crumbs);
 *   the page's own actions only go forward
 * states: loading (the "hub-template" skeleton: bones captured from the real detail) · ready · settling (another
 *   template on its way: StaleContent) · already copied (Open my copy) · removed from the hub (hidden or gone: an
 *   EmptyState with Kaatu, Browse the community) · a newer format ("Update Taalcut to open this template", Check for
 *   updates) · offline or another error (the cause, Try again) · Local only and not set up (Kaatu, the reason)
 * motion: the preview's clock only
 */
import { useLingui } from '@lingui/react/macro';
import type { HubTemplateId } from '@taalcut/core';
import { Button, EmptyState, ErrorLine, Skeleton, StaleContent, UserContent, VERB_ICONS } from '@taalcut/ui';
import { Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { useBackend } from '../../../backend/backend';
import { useBackendEvents } from '../../../backend/use-events';
import { useRpcQuery } from '../../../backend/use-rpc';
import { Page } from '../../../shell/page';
import { CAPTURE_HUB_DETAIL } from '../capture/hub-fixtures';
import { TEMPLATE_ICONS } from '../template-icons';
import { HubBlocked } from './hub-blocked';
import { HubDetail } from './hub-detail';
import { hubBlock, useHubStatus } from './use-hub-status';

const noop = () => undefined;

function Gone({ title, line, action }: { title: string; line: string; action: ReactNode }) {
  return (
    <div data-slot="hub-gone">
      <EmptyState titleAs="h2" title={title} description={line} action={action} kaatu="oops" />
    </div>
  );
}

/** The generic stand-in until bones are captured: the frame beside the heading, in the detail's own shape. */
function DetailBones() {
  return (
    <span aria-hidden className="grid gap-8 md:grid-cols-[13rem_1fr]">
      <span className="tc-bone block aspect-[9/16] w-52 rounded-xl bg-hover" />
      <span className="flex flex-col gap-3">
        <span className="tc-bone block h-7 w-64 rounded-sm bg-hover" />
        <span className="tc-bone block h-4 w-40 rounded-sm bg-hover" />
        <span className="tc-bone block h-4 w-full max-w-md rounded-sm bg-hover" />
      </span>
    </span>
  );
}

export function HubDetailPage({ hubId }: { readonly hubId: HubTemplateId }) {
  const { t } = useLingui();
  const backend = useBackend();
  const status = useHubStatus();
  const block = hubBlock(status.data);
  const got = useRpcQuery(
    async (signal) => ({ hubId, detail: await backend.hub.get({ hubId }, { signal }) }),
    [backend, hubId],
  );
  useBackendEvents(['library.changed'], ({ payload }) => {
    if (payload.entity === 'template') got.reload();
  });
  // A failed read for another template shows the failure, not the last template.
  const detail = got.data && (!got.error || got.data.hubId === hubId) ? got.data.detail : undefined;
  // Another template is on its way: what shows is the last one, marked busy.
  const settling = got.data !== undefined && got.data.hubId !== hubId;
  const name = settling ? undefined : detail?.item.name;
  const failed = detail ? null : (got.error ?? null);
  const code = failed?.code;

  const body = block ? (
    <HubBlocked block={block} />
  ) : code === 'hub.hidden' || code === 'hub.not_found' ? (
    <Gone
      title={t`Removed from the hub`}
      line={
        code === 'hub.hidden'
          ? t`A maintainer took this template off the hub, so it can’t be copied or rated. A copy you already made stays yours.`
          : t`That template isn’t on the hub any more. A copy you already made stays yours.`
      }
      action={
        <Button asChild size="sm" icon={TEMPLATE_ICONS.community}>
          <Link to="/templates/start/community">{t`Browse the community`}</Link>
        </Button>
      }
    />
  ) : code === 'hub.unsupported_format' ? (
    <Gone
      title={t`Update Taalcut to open this template`}
      line={t`It was shared from a newer version of Taalcut, in a format this one can’t read yet.`}
      action={
        <Button asChild size="sm">
          <Link to="/settings/updates">{t`Check for updates`}</Link>
        </Button>
      }
    />
  ) : failed ? (
    <div className="flex flex-col items-start gap-3">
      <ErrorLine error={failed} />
      <Button size="sm" icon={VERB_ICONS.retry} onClick={got.reload}>
        {t`Try again`}
      </Button>
    </div>
  ) : (
    <div aria-busy={!detail || settling || undefined}>
      {detail ? null : (
        <span role="status" className="sr-only">
          {t`Loading the template`}
        </span>
      )}
      <Skeleton
        name="hub-template"
        loading={!detail}
        fallback={<DetailBones />}
        fixture={<HubDetail detail={CAPTURE_HUB_DETAIL} onChanged={noop} />}
      >
        {detail ? (
          <StaleContent stale={settling}>
            <HubDetail detail={detail} onChanged={got.reload} />
          </StaleContent>
        ) : null}
      </Skeleton>
    </div>
  );

  return (
    <Page
      title={t`Community`}
      width="wide"
      {...(name ? { detail: <UserContent translate="no">{name}</UserContent> } : {})}
    >
      {body}
    </Page>
  );
}
