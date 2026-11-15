// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: cover composition fields (CVR2) · genre: atmospheric studio app (chrome modern-minimal)
 * system: DESIGN.md v0.3 · a designed cover in the cover panel: the designs it came with (up to three, one in
 *   use), the idea of the one in use in the designing model's own words, and its words and colours as the same
 *   plain controls a designed graphic has (DesignVariablesForm). The design itself is the AI's: a person changes
 *   what its variables let them change, picks another design, or removes the design to make a cover by hand
 * states: default · hover · focus-visible (each control's base ring) · active (the design in use is pressed) ·
 *   disabled (paused) · empty: no designs row for a single design, no fields for a design without variables
 * pre-emit critique: P4 H4 E4 S4 R5 V3 */
import { useLingui } from '@lingui/react/macro';
import type { CoverComposition, CoverSettings } from '@taalcut/core';
import { Button } from '#components/button';
import { DesignVariablesForm } from '../media/design-variables';
import { UserContent } from './card-frame';

type Changes = Partial<CoverSettings>;

/** The cover with `composition` in use, and the same design kept in step among the ones offered. */
export function withComposition(cover: CoverSettings, composition: CoverComposition): Changes {
  const options = cover.options && {
    ...cover.options,
    designs: cover.options.designs.map((design) => (design.hash === composition.hash ? composition : design)),
  };
  const lead = composition.pictures[0]?.source;
  return {
    composition,
    ...(options ? { options } : {}),
    source: !lead
      ? { kind: 'solid' }
      : lead.kind === 'frame'
        ? { kind: 'frame', frame: lead.frame }
        : { kind: 'asset', assetId: lead.assetId },
  };
}

/** A new picture for the cover: a designed cover's lead picture is re-pointed, any other cover's source is set. */
export function withLeadFrame(cover: CoverSettings, frame: number): Changes {
  const { composition } = cover;
  if (!composition || composition.pictures.length === 0) return { source: { kind: 'frame', frame } };
  const [lead, ...rest] = composition.pictures;
  return withComposition(cover, {
    ...composition,
    pictures: [{ name: lead!.name, source: { kind: 'frame', frame } }, ...rest],
  });
}

export function CoverCompositionFields({
  cover,
  paused,
  onChange,
}: {
  cover: CoverSettings & { composition: CoverComposition };
  paused: boolean;
  onChange: (changes: Changes) => void;
}) {
  const { t, i18n } = useLingui();
  const { composition } = cover;
  const designs = cover.options?.designs ?? [];
  return (
    <div className="flex flex-col gap-3" data-slot="cover-composition-fields">
      {designs.length > 1 ? (
        <div className="flex flex-wrap gap-1" role="group" aria-label={t`Designs to choose from`}>
          {designs.map((design, index) => {
            const n = i18n.number(index + 1);
            return (
              <Button
                key={design.hash}
                size="sm"
                variant="secondary"
                disabled={paused}
                aria-pressed={design.hash === composition.hash}
                title={design.idea}
                onClick={() => onChange(withComposition(cover, design))}
              >{t`Design ${n}`}</Button>
            );
          })}
        </div>
      ) : null}
      {composition.idea ? (
        <p className="m-0 type-meta text-ink-2">
          <UserContent translate="no">{composition.idea}</UserContent>
        </p>
      ) : null}
      <DesignVariablesForm
        key={composition.hash}
        variables={composition.variables}
        params={composition.params}
        disabled={paused}
        busy={null}
        error={null}
        onSave={async (_key, params) => {
          onChange(withComposition(cover, { ...composition, params: { ...composition.params, ...params } }));
          return true;
        }}
      />
      <div>
        <Button
          size="sm"
          variant="ghost"
          disabled={paused}
          onClick={() => onChange({ composition: undefined, options: undefined, medium: undefined })}
        >{t`Remove design`}</Button>
      </div>
    </div>
  );
}
