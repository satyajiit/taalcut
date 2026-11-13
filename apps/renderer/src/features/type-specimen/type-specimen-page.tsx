// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/*
 * /dev/type: the type reference. Every type role as the browser computes it, the app's chrome and prose set in
 * those roles in English and Hindi, the body weight on this theme, people's own words in every script the app
 * ships a face for, and the families themselves. Everything here uses the real tokens and roles (roles.css), so
 * the page shows what the app does, not a proposal.
 */
import { Trans, useLingui } from '@lingui/react/macro';
import { useId, type ReactNode } from 'react';
import { Page } from '../../shell/page';
import { FamilyFacts } from './family-facts';
import { BarSample, SectionSample, SettingsSample, TemplateRowSample } from './sample-rows';
import { EN, HI, type Samples } from './samples';
import {
  BrandSample,
  ButtonsSample,
  HindiSample,
  NumbersSample,
  ProseSample,
  WeightSample,
} from './sample-text';
import { ScriptLines } from './script-lines';
import { TypeLadder } from './type-ladder';

/** One part of the reference: its heading and note, then the samples, in their own language. */
function Part({
  title,
  note,
  samples,
  children,
}: {
  title: ReactNode;
  note: ReactNode;
  samples?: Samples;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} data-slot="type-part" className="@container flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 id={id} className="type-section text-ink">
          {title}
        </h2>
        <p className="type-body m-0 max-w-prose text-ink-2">{note}</p>
      </div>
      {samples ? (
        <div lang={samples.lang} translate="no" className="flex min-w-0 flex-col gap-5">
          {children}
        </div>
      ) : (
        children
      )}
    </section>
  );
}

export function TypeSpecimenPage() {
  const { t, i18n } = useLingui();
  return (
    <Page
      title={t`Type`}
      description={
        <Trans>
          Onest for everything you read, JetBrains Mono for numbers that change in place, and a Noto family
          for every other script. Switch the theme to see each part in light and dark.
        </Trans>
      }
      className="max-w-6xl"
    >
      <div className="flex flex-col gap-12">
        <Part
          title={<Trans>The roles</Trans>}
          note={
            <Trans>
              Every piece of text takes one of these roles, largest first. Each is a clear step from the next;
              Hindi gets more leading, and its chips go up to 12 px.
            </Trans>
          }
        >
          <TypeLadder />
        </Part>
        <Part
          title={<Trans>The app’s chrome</Trans>}
          note={
            <Trans>
              A window bar, a section, settings rows and a template row: page title, section, label, body,
              card title, meta and caption together.
            </Trans>
          }
          samples={EN}
        >
          <BarSample s={EN} />
          <SectionSample s={EN} />
          <SettingsSample s={EN} />
          <TemplateRowSample s={EN} />
        </Part>
        <Part
          title={<Trans>Agent prose</Trans>}
          note={<Trans>The prose role at the reading measure: about 65 characters of Onest a line.</Trans>}
          samples={EN}
        >
          <ProseSample s={EN} />
        </Part>
        <Part
          title={<Trans>Numbers and timecodes</Trans>}
          note={
            <Trans>
              Figures that sit still use Onest’s tabular figures. Numbers that change in place use JetBrains
              Mono.
            </Trans>
          }
          samples={EN}
        >
          <NumbersSample s={EN} />
        </Part>
        <Part
          title={<Trans>Buttons and brand moments</Trans>}
          note={
            <Trans>The kit’s buttons, then display and headline, for an export finished and first run.</Trans>
          }
          samples={EN}
        >
          <ButtonsSample s={EN} />
          <BrandSample s={EN} />
        </Part>
        <Part
          title={<Trans>Body weight on this theme</Trans>}
          note={
            <Trans>
              Body and meta from weight 360 to 450, on this theme’s canvas. Body text is 400 in both themes:
              lighter reads faint on dark.
            </Trans>
          }
          samples={EN}
        >
          <WeightSample s={EN} weightLabel={(weight) => i18n.number(weight)} />
        </Part>
        <Part
          title={<Trans>Hindi</Trans>}
          note={
            <Trans>
              The same chrome and prose in Devanagari, with Latin names and numbers in the same lines.
            </Trans>
          }
          samples={HI}
        >
          <HindiSample s={HI} />
        </Part>
        <Part
          title={<Trans>Every script</Trans>}
          note={
            <Trans>
              People’s own words, in any language: a clip name with a phrase in another script, at section and
              body size. The fallbacks are sized to Onest, so a mixed line doesn’t jump.
            </Trans>
          }
        >
          <ScriptLines />
        </Part>
        <FamilyFacts />
      </div>
    </Page>
  );
}
