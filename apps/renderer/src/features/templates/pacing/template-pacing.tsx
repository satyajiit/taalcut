// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
/* Hallmark · component: the template page's Pacing · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md v0.6
 * (UX3: a section of the page, its heading led by a gauge, as Slots is)
 * below the breakdown, the same bands as the editor's Pacing tab on the template's own rhythm bed (the sunken
 *   surface, rose beat ticks under the bands), the same controls row; Apply makes the template's next version
 *   (template.setEnergyCurve), the preview is the re-split worked out here (a template has no shots to pick)
 * states: no beat map (one line: nothing to pace) · default · read only (an older version: the bands to read,
 *   no controls) · loading/error/success: the controls' (the toast has Undo) · pre-emit critique: P4 H4 E4 S5 R5 V4 */
import { useLingui } from '@lingui/react/macro';
import {
  callRpc,
  newId,
  ok,
  RationalTime,
  TEMPLATE_COMMANDS,
  type SlotId,
  type Template,
} from '@taalcut/core';
import { Gauge } from 'lucide-react';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useBackend } from '../../../backend/backend';
import { useDefaultCurve } from '../../timeline/energy/default-curve';
import { beatFrames } from '../../timeline/energy/energy-grid';
import { cutsOf, splitOnCurve } from '../../timeline/energy/energy-split';
import { PacingBands } from '../../timeline/energy/pacing-bands';
import { PacingControls } from '../../timeline/energy/pacing-controls';
import { usePacing, type PacingSource } from '../../timeline/energy/use-pacing';

export interface TemplatePacingProps {
  readonly template: Template;
  readonly readOnly: boolean;
}

/** Ids for the preview's new slots: only their count and cuts are shown (the command makes its own). */
const previewIds = { slot: (): SlotId => newId<'TemplateSlot'>() };

function useLaneWidth() {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useLayoutEffect(() => {
    const node = box.current;
    if (!node) return;
    const measure = () => setWidth(node.clientWidth);
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    measure();
    return () => observer.disconnect();
  }, []);
  return { box, width };
}

function TemplatePacingEditor({ template, readOnly }: TemplatePacingProps) {
  const backend = useBackend();
  const defaultCurve = useDefaultCurve(template);
  const { box, width } = useLaneWidth();
  const total = Math.max(1, RationalTime.toFrames(template.duration, template.canvas.rate));
  const px = (frame: number) => (frame / total) * width;
  const source = useMemo<PacingSource<null>>(
    () => ({
      template,
      defaultCurve,
      preview: async (curve) => {
        const split = splitOnCurve(template, curve, previewIds);
        if (!split.ok) return split;
        return ok({
          curve,
          cuts: cutsOf(split.value.template),
          changed: split.value.slotMap.filter((entry) => !entry.unchanged).length,
          picks: 0,
          lockedKept: false,
          plan: null,
        });
      },
      apply: (preview) =>
        callRpc(
          backend.commands.dispatch({
            name: TEMPLATE_COMMANDS.setEnergyCurve,
            payload: {
              projectId: null,
              templateId: template.id,
              baseVersion: template.version,
              curve: preview.curve,
            },
            source: 'ui',
            idempotencyKey: newId(),
          }),
        ),
      undo: () => callRpc(backend.commands.undo({ projectId: null, source: 'ui' })),
    }),
    [backend, template, defaultCurve],
  );
  const pacing = usePacing(source);
  const beats = beatFrames(template.beatMap, template.canvas.rate);
  const downbeats = new Set(template.beatMap?.downbeats ?? []);
  return (
    <>
      <div className="rounded-xl bg-sunken p-3" data-slot="template-pacing-bed">
        {/* Measured inside the padding: the bands' frames map onto this box's width. */}
        <div ref={box} className="flex flex-col gap-1.5">
          {width > 0 ? (
            <PacingBands
              template={template}
              curve={pacing.draft}
              selected={pacing.selected}
              onSelect={pacing.select}
              onChange={pacing.change}
              px={px}
              ghost={pacing.state.status === 'ready' ? pacing.state.preview.cuts : null}
              readOnly={readOnly}
            />
          ) : (
            <div className="h-16" />
          )}
          <div aria-hidden className="relative h-2.5">
            {beats.map((frame, index) => (
              <span
                key={frame}
                className={
                  downbeats.has(index)
                    ? 'absolute top-0 h-2.5 w-px rounded-pill bg-beat-strong'
                    : 'absolute top-0 h-1.5 w-px rounded-pill bg-beat'
                }
                style={{ left: px(frame) }}
              />
            ))}
          </div>
        </div>
      </div>
      {readOnly ? null : <PacingControls pacing={pacing} template={template} kind="template" />}
    </>
  );
}

/** P3-V12: the template's energy curve (template.setEnergyCurve), on its page. */
export function TemplatePacing({ template, readOnly }: TemplatePacingProps) {
  const { t } = useLingui();
  const beats = (template.beatMap?.beats.length ?? 0) > 0;
  return (
    <section
      aria-labelledby="template-pacing-title"
      data-slot="template-pacing"
      className="flex flex-col gap-3 border-t border-rule-subtle pt-8"
    >
      <h2 id="template-pacing-title" className="m-0 flex items-center gap-2 text-lg font-semibold text-ink">
        <Gauge aria-hidden className="size-5 text-ink-3" />
        {t`Pacing`}
      </h2>
      {beats ? (
        <>
          <p className="m-0 max-w-prose text-sm text-ink-2">
            {t`How often the cuts come, section by section, on the beat. Raise a section for more energy.`}
          </p>
          <TemplatePacingEditor
            key={`${template.id}:${template.version}`}
            template={template}
            readOnly={readOnly}
          />
        </>
      ) : (
        <p className="m-0 text-sm text-ink-3" data-slot="pacing-no-beats">
          {t`This template follows speech, not music beats, so it has no pacing to change.`}
        </p>
      )}
    </section>
  );
}
