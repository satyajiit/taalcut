// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { useLingui } from '@lingui/react/macro';
import type { CoverDesign } from '@taalcut/core';
import { Input } from '#components/input';

/** Edits the persisted authored layers, so the preview and export cannot drift into preset-only controls. */
export function CoverDesignFields({
  design,
  paused,
  onChange,
}: {
  design: CoverDesign;
  paused: boolean;
  onChange: (design: CoverDesign) => void;
}) {
  const { t, i18n } = useLingui();
  const colors = { ink: t`Ink`, paper: t`Paper`, accent: t`Accent`, muted: t`Muted` };
  return (
    <div className="flex flex-col gap-3" data-slot="cover-design-fields">
      {design.layers.map((layer, index) => {
        if (layer.kind !== 'text') return null;
        const n = i18n.number(index + 1);
        return (
          <label key={index} className="flex flex-col gap-1 type-label">
            {t`Text layer ${n}`}
            <textarea
              value={layer.text}
              maxLength={180}
              rows={Math.min(4, layer.text.split('\n').length)}
              disabled={paused}
              className="min-w-0 rounded-md border border-rule-strong bg-raised p-2 text-ink hover:border-ink-3 focus-visible:border-ink-2 focus-visible:bg-canvas disabled:cursor-not-allowed disabled:bg-sunken disabled:text-ink-disabled"
              onChange={(event) =>
                onChange({
                  ...design,
                  layers: design.layers.map((item, at) =>
                    at === index ? { ...layer, text: event.target.value || ' ' } : item,
                  ),
                })
              }
            />
          </label>
        );
      })}
      <div className="flex flex-wrap gap-3">
        {(Object.keys(colors) as (keyof typeof colors)[]).map((role) => (
          <label key={role} className="flex items-center gap-2 type-label">
            {colors[role]}
            <Input
              type="color"
              className="w-12"
              value={design.palette[role]}
              disabled={paused}
              onChange={(event) =>
                onChange({ ...design, palette: { ...design.palette, [role]: event.target.value } })
              }
            />
          </label>
        ))}
      </div>
    </div>
  );
}
