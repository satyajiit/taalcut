// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · component: a template's details (/templates/$templateId/details; UX4 tpl) · system:
 *   DESIGN.md v0.6 + UX4 (PageSection, ListRow; design-tpl.md)
 * everything about a template that isn't making or checking it, as four icon-led sections: About it (Favourite,
 *   its folder, its tags, its trend date and where it came from: template-facts.tsx), Look (the look a video made
 *   from it starts with), Versions (every version newest first as framed dense rows: what made it, who, when; the
 *   one on screen marked, any other one a Read away, read-only) and Share (to the community, or as a file)
 * states: latest · older version (read-only facts and Look; the version rows still switch) · versions loading
 *   (the section's line) · one version (its row alone) · each control's own
 */
import { useLingui } from '@lingui/react/macro';
import { Button, Chip, CONCEPT_ICONS, ListRow, ListRows, PageSection } from '@taalcut/ui';
import { LookMenu } from '../../timeline/look/look-menu';
import { formatDateTime } from '../../shared/format';
import { TemplateLibraryFacts } from '../library/template-facts';
import { TEMPLATE_ICONS } from '../template-icons';
import { versionWords } from '../template-words';
import type { TemplateView } from './template-context';
import { TemplateShare } from './template-share';

function Versions({ view }: { view: TemplateView }) {
  const { t, i18n } = useLingui();
  const shown = view.template.version;
  if (!view.versions) return <p className="m-0 type-body text-ink-2">{t`Reading the versions…`}</p>;
  return (
    <ListRows framed aria-label={t`Versions`} data-slot="template-versions">
      {view.versions.map((version) => {
        const n = i18n.number(version.version);
        const by =
          version.source === 'agent'
            ? t`by Taalcut`
            : version.source === 'mcp'
              ? t`by another app`
              : version.source
                ? t`by you`
                : null;
        const current = version.version === shown;
        return (
          <ListRow
            key={version.version}
            size="dense"
            leading={TEMPLATE_ICONS.version}
            selected={current}
            title={version.isHead ? t`Version ${n}, latest` : t`Version ${n}`}
            meta={
              <>
                {i18n._(versionWords(version.command))}
                {by ? ` ${by}` : null}
              </>
            }
            trailingMeta={
              <time dateTime={new Date(version.createdAt).toISOString()}>
                {formatDateTime(i18n, version.createdAt)}
              </time>
            }
            actions={
              current ? (
                <Chip>{t`On screen`}</Chip>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={TEMPLATE_ICONS.open}
                  onClick={() => view.onVersion(version.isHead ? undefined : version.version)}
                >
                  {version.isHead ? t`Back to the latest` : t`Read it`}
                </Button>
              )
            }
          />
        );
      })}
    </ListRows>
  );
}

export function TemplateDetails({ view }: { view: TemplateView }) {
  const { t } = useLingui();
  const { summary, template, latest } = view;
  return (
    <div className="flex flex-col" data-slot="template-details">
      <PageSection
        icon={TEMPLATE_ICONS.details}
        title={t`About this template`}
        description={t`Your marks for finding it again, and where it came from.`}
      >
        <TemplateLibraryFacts summary={summary} template={template} readOnly={!latest} />
      </PageSection>
      <PageSection
        icon={CONCEPT_ICONS.brandKit}
        title={t`Look`}
        description={t`The colours, type and captions a video made from it starts with.`}
        actions={<LookMenu target={{ kind: 'template', template, readOnly: !latest }} />}
      />
      <PageSection
        icon={TEMPLATE_ICONS.version}
        title={t`Versions`}
        description={t`Every change makes a version. An older one opens read-only.`}
      >
        <Versions view={view} />
      </PageSection>
      <PageSection
        icon={TEMPLATE_ICONS.share}
        title={t`Share`}
        description={t`Send it to the community for anyone to use, or as a file someone can import.`}
      >
        <TemplateShare summary={summary} template={template} />
      </PageSection>
    </div>
  );
}
