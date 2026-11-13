// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · page frame: a template (/templates/$templateId and its Slots, Pacing and Details; P2-T6,
 *   UX1, UX4 tpl) · system: DESIGN.md v0.6 + UX4 (Page, ViewLinks; design-tpl.md)
 * the window bar reads "Templates › Golden hour market" on the overview and "Templates › Golden hour market › Slots"
 *   (Pacing, Details) on the others, the name a crumb back to the overview; the template's views come first, then
 *   the open page (its route's), which reads the template from here (template-context.tsx). An older version
 *   (`?version=`) says so on every page in one information line, with Back to the latest
 * states: loading (each page's own bones) · filled · settling (another template or version on its way: the page
 *   dims, aria-busy) · older version (the line; nothing can change) · not found (an EmptyState with Kaatu: "isn't
 *   here any more", the way to Your templates; the bar's crumb and Back are the way back) · error (the cause, Try
 *   again)
 */
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import type { TemplateId } from '@taalcut/core';
import { Button, EmptyState, ErrorLine, UserContent, VERB_ICONS } from '@taalcut/ui';
import { Link } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';
import { useBackend } from '../../../backend/backend';
import { useBackendEvents } from '../../../backend/use-events';
import { useRpcQuery } from '../../../backend/use-rpc';
import { useNameCrumb } from '../../../shell/nav/crumb-words';
import { Page } from '../../../shell/page';
import { formatDateTime } from '../../shared/format';
import { isStarterName, templateName } from '../library/library-words';
import { TEMPLATE_ICONS } from '../template-icons';
import { TemplateProvider, type TemplateView } from './template-context';
import { TemplateViews, type TemplatePageView } from './template-views';

export interface TemplateFrameProps {
  readonly templateId: TemplateId;
  /** An older version to read; undefined is the latest. */
  readonly version: number | undefined;
  readonly onVersion: (version: number | undefined) => void;
  readonly view: TemplatePageView;
  readonly children: ReactNode;
}

/** The bar's last word on a template's other pages, after its name: the views row's words. */
const PAGE_WORDS = { slots: msg`Slots`, pacing: msg`Pacing`, details: msg`Details` } as const;

/** An older version on screen: one line, read-only, and the way back to the latest. */
function OlderVersion({ view }: { view: TemplateView }) {
  const { t, i18n } = useLingui();
  const number = i18n.number(view.template.version);
  const readAt = formatDateTime(i18n, view.template.createdAt);
  return (
    <p role="status" className="m-0 flex flex-wrap items-center gap-x-3 gap-y-2 type-body text-ink-2">
      <span className="flex items-center gap-2">
        {/* The information glyph in its status ink: what is on screen isn't the latest. */}
        <span aria-hidden className="inline-flex text-info-strong [&_svg]:size-4">
          <TEMPLATE_ICONS.details />
        </span>
        {t`You’re reading version ${number}, from ${readAt}. Older versions can’t be changed.`}
      </span>
      <Button size="sm" variant="ghost" icon={VERB_ICONS.back} onClick={() => view.onVersion(undefined)}>
        {t`Back to the latest`}
      </Button>
    </p>
  );
}

export function TemplateFrame({ templateId, version, onVersion, view: open, children }: TemplateFrameProps) {
  const { t, i18n } = useLingui();
  const backend = useBackend();
  const [round, setRound] = useState(0);
  const got = useRpcQuery(
    async (signal) => ({
      asked: `${templateId}@${version ?? 'head'}`,
      ...(await backend.templates.get({ templateId, ...(version ? { version } : {}) }, { signal })),
    }),
    [backend, templateId, version, round],
  );
  const versions = useRpcQuery(
    (signal) => backend.templates.versions({ templateId }, { signal }),
    [backend, templateId, round],
  );
  useBackendEvents(['library.changed'], ({ payload }) => {
    if (payload.entity === 'template' && payload.ids.includes(templateId)) setRound((n) => n + 1);
  });

  const title = t`Templates`;
  const data = got.data;
  const summary = data?.summary;
  // The template's name is its pages' crumb: a starter's name is ours, translated; anyone else's is theirs.
  useNameCrumb(
    `/templates/${templateId}`,
    summary
      ? isStarterName(summary)
        ? { text: templateName(i18n, summary), own: false }
        : { text: summary.name, own: true }
      : null,
  );
  const views = <TemplateViews templateId={templateId} current={open} version={version} />;

  if (!data && got.error?.code === 'core.not_found')
    return (
      <Page title={title} width="wide">
        <div data-slot="template-missing">
          <EmptyState
            titleAs="h2"
            kaatu="oops"
            title={t`This template isn’t here any more`}
            description={t`It may have been archived or deleted. Your other templates are where you left them.`}
            action={
              <Button asChild size="sm" icon={TEMPLATE_ICONS.mine}>
                <Link to="/templates">{t`Your templates`}</Link>
              </Button>
            }
          />
        </div>
      </Page>
    );
  if (!data && got.error)
    return (
      <Page title={title} width="wide">
        <div className="flex flex-col items-start gap-3">
          <ErrorLine error={got.error} />
          <Button size="sm" icon={VERB_ICONS.retry} onClick={got.reload}>
            {t`Try again`}
          </Button>
        </div>
      </Page>
    );

  const value: TemplateView | null = data
    ? {
        summary: data.summary,
        template: data.template,
        versions: versions.data,
        latest: data.template.version === data.summary.head,
        settling: data.asked !== `${templateId}@${version ?? 'head'}`,
        onVersion,
      }
    : null;
  return (
    <Page
      title={title}
      width="wide"
      views={views}
      {...(summary && open !== 'overview'
        ? { detail: i18n._(PAGE_WORDS[open]) }
        : summary
          ? {
              // One line, as the editor's: the window bar shortens it when it needs the room.
              detail: isStarterName(summary) ? (
                <span className="whitespace-nowrap">{templateName(i18n, summary)}</span>
              ) : (
                <UserContent translate="no" className="whitespace-nowrap">
                  {summary.name}
                </UserContent>
              ),
            }
          : {})}
    >
      <TemplateProvider value={value}>
        <div className="@container flex flex-col gap-8" data-slot="template-page" data-view={open}>
          {value && !value.latest ? <OlderVersion view={value} /> : null}
          {children}
        </div>
      </TemplateProvider>
    </Page>
  );
}
