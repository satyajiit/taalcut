// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · page: New template (/templates/new; UX4 tpl) · system: DESIGN.md v0.6 + UX4 (Page,
 *   PageSection, KaatuMoment; design-tpl.md)
 * one job: make a template. The area's views first; then the two ways in, each an icon-led section: From a reel
 *   (the paste-a-link field and Read this reel, the page's one marigold: the chat opens reading it) and From a file
 *   (Import… for .taalcut-template files; a drop anywhere on the page does the same). A last quiet line points at
 *   Start from… for someone with no reel. The window bar reads "Templates › New template"
 * states: the field's (reel-link-form.tsx: default · hover · focus · error with its fix · loading) · Import…'s
 *   (eight states; importing spins) · imported (the toast, with Undo) · nothing imported (a Kaatu failure moment in
 *   the section: the cause, which file, and the fix, Import… again; read out as an alert) · dragging files (the
 *   drop panel)
 * motion: the views' thumb; the drop panel fades; the moment's Kaatu
 */
import { Trans, useLingui } from '@lingui/react/macro';
import { Button, KaatuMoment, PageSection } from '@taalcut/ui';
import { Link } from '@tanstack/react-router';
import { Page } from '../../../shell/page';
import { ImportButton, ImportDropZone, RefusedLine, useImportTemplates } from '../library/import-drop';
import type { ImportOutcome } from '../library/import-templates';
import { libraryErrorText } from '../library/library-words';
import { ReelLinkForm } from '../reel-link-form';
import { TEMPLATE_ICONS } from '../template-icons';
import { TemplatesViews } from '../templates-views';

/** Why nothing came in, in one line: the service's cause, or the first file that isn't a template and why. */
function FailedLine({ outcome }: { outcome: ImportOutcome }) {
  const { i18n } = useLingui();
  if (outcome.error) {
    const cause = libraryErrorText(i18n, outcome.error);
    return <Trans>Nothing came in: {cause} Try the files again.</Trans>;
  }
  const first = outcome.refused[0];
  if (!first) return <Trans>Nothing came in. Choose the files again.</Trans>;
  return (
    <>
      <RefusedLine name={first.name} reason={first.reason} />{' '}
      <Trans>Export it again from Taalcut, then choose it here.</Trans>
    </>
  );
}

export function NewTemplatePage() {
  const { t } = useLingui();
  const imports = useImportTemplates({ failures: 'page' });
  const onFiles = (files: File[]) => {
    imports.clearFailed();
    void imports.importFiles(files);
  };
  const importButton = <ImportButton onFiles={onFiles} pending={imports.pending} />;
  return (
    <Page title={t`New template`} width="wide" views={<TemplatesViews current="new" />}>
      <ImportDropZone onFiles={onFiles}>
        <div className="flex max-w-[44rem] flex-col" data-slot="templates-new">
          <PageSection
            icon={TEMPLATE_ICONS.readReel}
            title={t`From a reel`}
            description={t`Paste a link to a reel you like. Taalcut learns its cuts and music beats and keeps them as a template you can use again.`}
          >
            {/* The slots for the specs sit inside: a section keeps the kit's own, which spaces it from the next. */}
            <div data-slot="add-template">
              <ReelLinkForm compact />
            </div>
          </PageSection>
          <PageSection
            icon={TEMPLATE_ICONS.import}
            title={t`From a file`}
            description={t`Templates someone shared from Taalcut, as .taalcut-template files. Choose them, or drop them anywhere on this page.`}
          >
            <div data-slot="templates-import">
              {imports.failed ? (
                <KaatuMoment tone="failure" action={importButton}>
                  <FailedLine outcome={imports.failed} />
                </KaatuMoment>
              ) : (
                importButton
              )}
            </div>
          </PageSection>
          <p className="m-0 mt-10 flex flex-wrap items-center gap-x-2 gap-y-1 type-body text-ink-2">
            {t`No reel to copy?`}
            <Button asChild size="sm" variant="ghost" icon={TEMPLATE_ICONS.startFrom} className="-ms-1">
              <Link to="/templates/start">{t`Start from…`}</Link>
            </Button>
          </p>
        </div>
      </ImportDropZone>
    </Page>
  );
}
