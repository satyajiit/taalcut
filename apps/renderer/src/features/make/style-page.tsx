// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · page: Your style (/projects/style, UX4, LRN1-STY) · system: DESIGN.md v0.6 + UX4
 * distilled out of Exports, where it sat above the queue as a card: what the templates behind your finished
 *   exports have in common, as one of Make's views. The page is the container, so no card: one section, led by the
 *   style glyph, its heading and how many templates it's measured from; then the measured numbers, the most typical
 *   templates and the model's paragraph, in that order (measured first, a model's words last)
 * states: loading (the profile's own bones) · empty (StyleEmpty: nothing exported from a template yet) · one
 *   template (its own numbers, said so) · filled · error with no answer (the cause, Try again) · a failed re-read
 *   (the answer stays, the cause above it) · refreshing (aria-busy) · the summary's own states
 * motion: none of its own (the views' glide and the page turn are the shell's and the kit's)
 */
import { useLingui } from '@lingui/react/macro';
import type { StyleSource } from '@taalcut/core';
import {
  CONCEPT_ICONS,
  ErrorLine,
  MeasuredFrom,
  PageSection,
  Skeleton,
  StyleProfileBody,
  StyleProfileBones,
} from '@taalcut/ui';
import { useNavigate } from '@tanstack/react-router';
import { useMediaUrls } from '../../services/provider';
import { Page } from '../../shell/page';
import { useStyleProfile } from '../templates/profiles/use-style-profile';
import { StyleEmpty } from './make-empty';
import { MakeViews } from './make-views';

const MY_EXPORTS: StyleSource = { kind: 'my-exports' };

function StyleProfile() {
  const { t } = useLingui();
  const { state, asking, askFailure, writeAgain } = useStyleProfile(MY_EXPORTS);
  const media = useMediaUrls();
  const navigate = useNavigate();
  if (state.error && !state.data) return <ErrorLine error={state.error} onRetry={state.reload} />;
  if (state.data?.profile === null) return <StyleEmpty />;
  return (
    <Skeleton name="style-profile" loading={state.status === 'loading'} fallback={<StyleProfileBones />}>
      {state.data?.profile ? (
        <PageSection
          data-slot="style-profile"
          data-source="my-exports"
          aria-busy={state.refreshing === true || undefined}
          icon={CONCEPT_ICONS.styleProfile}
          title={t`What your own videos have in common`}
          description={<MeasuredFrom members={state.data.profile.members} />}
        >
          <div className="flex flex-col gap-6">
            {state.error ? <ErrorLine error={state.error} onRetry={state.reload} /> : null}
            <StyleProfileBody
              view={state.data}
              level={3}
              sheetUrl={(sheet) => media.templateAsset(sheet)}
              onOpenTemplate={(templateId) =>
                void navigate({ to: '/templates/$templateId', params: { templateId } })
              }
              onWriteAgain={writeAgain}
              asking={asking}
              askFailure={askFailure}
            />
          </div>
        </PageSection>
      ) : null}
    </Skeleton>
  );
}

/** Make's fourth view: your style, measured from what you exported. */
export function StylePage() {
  const { t } = useLingui();
  return (
    <Page title={t`Make`} detail={t`Your style`} views={<MakeViews current="style" />}>
      <StyleProfile />
    </Page>
  );
}
