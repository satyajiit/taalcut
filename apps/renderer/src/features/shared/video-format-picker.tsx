// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Video format choices · Operate · system: DESIGN.md v0.7
 * Real aspect shapes distinguish delivery formats. Selected, hover, focus and disabled states use
 * the shared checkbox and surface roles; press feedback stops under reduced motion. */
import { useLingui } from '@lingui/react/macro';
import type { VideoAspect } from '@taalcut/core';
import { Checkbox, cn, HOVER_EASE, PRESS_ROW } from '@taalcut/ui';

const SHAPES: Record<VideoAspect, string> = {
  '16:9': cn('aspect-video w-12'),
  '9:16': cn('aspect-[9/16] h-12'),
  '1:1': cn('aspect-square w-10'),
  '4:5': cn('aspect-[4/5] h-10'),
};

export function VideoFormatPicker({
  values,
  onChange,
  disabled = false,
  portraitFirst = false,
}: {
  values: VideoAspect[];
  onChange: (values: VideoAspect[]) => void;
  disabled?: boolean;
  portraitFirst?: boolean;
}) {
  const { t } = useLingui();
  const labels: Record<VideoAspect, string> = {
    '16:9': t`Landscape · 16:9`,
    '9:16': t`Portrait · 9:16`,
    '1:1': t`Square · 1:1`,
    '4:5': t`Portrait · 4:5`,
  };
  const formats: VideoAspect[] = portraitFirst
    ? ['9:16', '16:9', '1:1', '4:5']
    : ['16:9', '9:16', '1:1', '4:5'];
  return (
    <div className="grid min-w-0 grid-cols-2 gap-3 xl:grid-cols-4">
      {formats.map((format) => {
        const selected = values.includes(format);
        return (
          <Checkbox
            key={format}
            checked={selected}
            disabled={disabled}
            className={cn(
              'min-w-0 rounded-lg border p-3',
              selected ? 'border-rule-strong bg-panel' : 'border-rule bg-canvas',
              !disabled && 'hover:border-rule-strong hover:bg-hover',
              HOVER_EASE,
              PRESS_ROW,
            )}
            label={
              <span className="flex min-w-0 flex-col gap-3">
                <span aria-hidden className="flex h-12 items-center">
                  <span
                    className={cn(
                      'block rounded-clip border-2',
                      selected ? 'border-ink-2 bg-raised' : 'border-rule-strong bg-well',
                      SHAPES[format],
                    )}
                  />
                </span>
                <span className="type-label-sm">{labels[format]}</span>
              </span>
            }
            onCheckedChange={(checked) => {
              const next = checked ? [...values, format] : values.filter((value) => value !== format);
              // Every creation needs a delivery format, including while editing its brief.
              if (next.length) onChange(next);
            }}
          />
        );
      })}
    </div>
  );
}
