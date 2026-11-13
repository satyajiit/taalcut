// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · component: the export's choices as steps (UX4) · system: DESIGN.md v0.6 + UX4
 * one decision a step (export-steps.ts: where it's going, sound, captions, framing, credits), then a summary before
 *   Export. The steps row across the top; the video's first frame on the left on every step, the chosen app's
 *   buttons and the safe line drawn over it; the step on the right, its heading taking focus; Back and Next at the
 *   foot, Next the one marigold fill until the summary, where "Export for <app>" is. Any step opens from the row,
 *   and every choice has a working default, so the summary is one press away
 * states: loading (poster grey, bone rows) · error (the cause, Try again) · a step (its sections' own states) ·
 *   the summary · exporting (Export spins, nothing changes meanwhile) · export refused (the cause above the buttons)
 * keyboard: Tab reaches the steps row, the step's controls, Back and Next in that order; each step's heading takes
 *   focus when it opens · motion: the steps crossfade (StepCrossfade: --dur-short in, --dur-micro out; reduced: a
 *   150 ms fade)
 */
import { useLingui } from '@lingui/react/macro';
import {
  callRpc,
  newId,
  RENDER_COMMANDS,
  type ExportPresetId,
  type ProjectId,
  type RenderId,
  type Timeline,
  type TimelineId,
  type TimelineItemId,
} from '@taalcut/core';
import {
  Button,
  DialogFooter,
  errorMessage,
  presetLabel,
  SafeZoneOverlay,
  VERB_ICONS,
  videoClips,
} from '@taalcut/ui';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useBackend } from '../../backend/backend';
import { askWith } from '../../chat/selection-store';
import { LoadError } from '../make/load-error';
import { useMediaUrls } from '../../services/provider';
import { shotLookup } from '../timeline/shot-frames';
import { ExportStepBody } from './export-step-body';
import { ExportStepper } from './export-stepper';
import { shownSteps, type ExportStepId } from './export-steps';
import { ExportSummary } from './export-summary';
import { availableSections } from './sections';
import type { ExportChoices, ExportContext, ExportSectionId, SectionProps } from './sections';
import { keptCodec, keptRate } from './sections/codec-choices';
import { useExportContext } from './sections/use-export-context';
import { StepCrossfade } from './step-crossfade';

export interface ExportFormProps {
  projectId: ProjectId;
  timelineId: TimelineId;
  presetId?: ExportPresetId | undefined;
  onStarted: (renderId: RenderId) => void;
  onCancel: () => void;
}

function usePosterOf(timeline: Timeline | undefined): string | null {
  const backend = useBackend();
  const media = useMediaUrls();
  const [url, setUrl] = useState<string | null>(null);
  const first = timeline ? videoClips(timeline)[0] : undefined;
  const assetId = first?.media.assetId;
  const shotId = first?.media.kind === 'video' ? first.media.shotId : null;
  useEffect(() => {
    if (!assetId) return;
    let live = true;
    void shotLookup(backend, media)
      .frame(assetId, shotId, { width: 270, height: 480 })
      .then((frame) => {
        if (live) setUrl(frame?.url ?? null);
      });
    return () => {
      live = false;
    };
  }, [backend, media, assetId, shotId]);
  return url;
}

/** Where the export starts: the preset asked for, else the project's when it fits, else the first that fits. */
function firstChoices(context: ExportContext, presetId: ExportPresetId | undefined): ExportChoices {
  const { options } = context;
  const fits = options.presets.filter((entry) => entry.available);
  const fallback = fits.some((entry) => entry.preset.id === options.defaultPresetId)
    ? options.defaultPresetId
    : (fits[0]?.preset.id ?? options.defaultPresetId);
  return {
    presetId: presetId ?? fallback,
    burnIn: options.captions.enabled,
    srt: false,
    includeBumpers: true,
  };
}

function Bones() {
  const { t } = useLingui();
  return (
    <div aria-busy="true" aria-label={t`Loading the export choices`} className="flex flex-col gap-4">
      <span aria-hidden className="tc-bone block h-8 w-full max-w-xl rounded-md bg-hover" />
      <span className="flex gap-6">
        <span aria-hidden className="tc-bone block aspect-[9/16] w-40 shrink-0 rounded-lg bg-hover" />
        <span className="flex flex-1 flex-col gap-3">
          {Array.from({ length: 6 }, (_, i) => (
            <span key={i} aria-hidden className="tc-bone block h-8 w-full rounded-md bg-hover" />
          ))}
        </span>
      </span>
    </div>
  );
}

export function ExportForm({ projectId, timelineId, presetId, onStarted, onCancel }: ExportFormProps) {
  const { t, i18n } = useLingui();
  const backend = useBackend();
  const navigate = useNavigate();
  const loaded = useExportContext(projectId, timelineId);
  const context = loaded.data;
  const poster = usePosterOf(context?.timeline);
  const [shown, setShown] = useState<readonly ExportSectionId[] | null>(null);
  const [choices, setChoices] = useState<ExportChoices | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [step, setStep] = useState<ExportStepId>('destination');
  const [seen, setSeen] = useState<ReadonlySet<ExportStepId>>(() => new Set(['destination']));
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!context) return;
    setShown((was) => was ?? availableSections(context).map((section) => section.id));
    setChoices((was) => was ?? firstChoices(context, presetId));
  }, [context, presetId]);
  const steps = useMemo(() => (shown ? shownSteps(shown) : []), [shown]);
  // A new step starts at its top.
  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 0;
  }, [step]);

  if (loaded.error && !context) return <LoadError error={loaded.error} onRetry={loaded.reload} />;
  if (!context || !choices || !shown) return <Bones />;

  const { options } = context;
  const selected =
    options.presets.find((entry) => entry.preset.id === choices.presetId) ?? options.presets[0];
  const index = steps.findIndex((candidate) => candidate.id === step);
  const current = steps[index];
  if (!selected || !current) return <Bones />;
  const where = presetLabel(i18n, selected.preset.id);
  const codec = keptCodec(selected, choices.codec);
  const rate = keptRate(selected, context.timeline.canvas.rate, choices.rate);
  const burning = options.captions.available && choices.burnIn;
  const last = current.id === 'summary';

  const go = (next: ExportStepId) => {
    setStep(next);
    setSeen((was) => new Set([...was, next]));
  };
  const dispatch = (name: string, payload: unknown) =>
    callRpc(backend.commands.dispatch({ name, payload, source: 'ui', idempotencyKey: newId() }));
  const editor = (search: { timeline: TimelineId; clip?: TimelineItemId }) =>
    void navigate({ to: '/projects/$projectId/timeline', params: { projectId }, search });
  const props: SectionProps = {
    context,
    choices,
    choose: (patch) => setChoices((was) => (was ? { ...was, ...patch } : was)),
    dispatch,
    reload: loaded.reload,
    ask: (text) => {
      askWith(text, []);
      editor({ timeline: timelineId });
    },
    review: (clipId) => editor({ timeline: timelineId, clip: clipId }),
    disabled: exporting,
  };
  const start = async () => {
    setExporting(true);
    setExportError(null);
    const result = await dispatch(RENDER_COMMANDS.export, {
      projectId,
      timelineId,
      presetId: selected.preset.id,
      // LNX1-AV1: the video format picked, while the preset offers it and this machine makes it.
      ...(codec ? { codec } : {}),
      ...(rate ? { rate } : {}),
      captions: { burnIn: burning, sidecars: choices.srt && options.captions.available ? ['srt'] : [] },
      contentCredentials: { add: options.credentials?.add ?? false },
      includeBumpers: choices.includeBumpers,
    });
    setExporting(false);
    if (!result.ok) return setExportError(errorMessage(i18n, result.error));
    const value = result.value as { result?: { renderId?: RenderId } } | undefined;
    if (value?.result?.renderId) onStarted(value.result.renderId);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4" data-slot="export-form" data-step={current.id}>
      <ExportStepper steps={steps} current={current.id} seen={seen} onPick={go} />
      <div className="flex min-h-0 flex-1 gap-6 border-t border-rule-subtle pt-4">
        <figure className="m-0 hidden shrink-0 flex-col gap-2 self-start sm:flex">
          <div
            className="relative aspect-[9/16] w-40 overflow-hidden rounded-lg bg-viewer bg-cover bg-center"
            style={poster ? { backgroundImage: `url("${poster}")` } : undefined}
          >
            <SafeZoneOverlay overlays={selected.preset.overlays} safe={selected.preset.safe} />
          </div>
          <figcaption className="max-w-40 type-meta text-ink-2">
            {selected.preset.overlays.length > 0
              ? t`Grey: where ${where} puts its own buttons. The dashed line is safe for words.`
              : t`The dashed line is safe for words on any phone.`}
          </figcaption>
        </figure>
        {/* Room for focus rings inside the scroll, borrowed on the start and top only: a margin past the end would
            make the row wider than the dialog. */}
        <div ref={scroller} className="-ms-1 -mt-1 min-h-0 min-w-0 flex-1 overflow-y-auto p-1">
          <StepCrossfade id={current.id}>
            <ExportStepBody
              step={current}
              shown={shown}
              props={props}
              {...(last
                ? {
                    summary: (
                      <ExportSummary
                        context={context}
                        choices={choices}
                        selected={selected}
                        steps={steps}
                        onChange={go}
                        disabled={exporting}
                      />
                    ),
                  }
                : {})}
            />
          </StepCrossfade>
        </div>
      </div>
      {exportError ? (
        <p role="alert" className="m-0 type-body text-danger-strong">
          {exportError}
        </p>
      ) : null}
      <DialogFooter className="border-t border-rule-subtle pt-4 sm:justify-between">
        <p className="m-0 type-meta text-ink-2">
          {last ? t`It’s checked before it’s saved. Find it in Exports.` : null}
        </p>
        <div className="flex gap-2">
          {index > 0 ? (
            <Button
              variant="ghost"
              icon={VERB_ICONS.back}
              data-slot="export-back"
              onClick={() => go(steps[index - 1]!.id)}
            >
              {t`Back`}
            </Button>
          ) : (
            <Button variant="ghost" onClick={onCancel}>
              {t`Cancel`}
            </Button>
          )}
          {last ? (
            <Button
              variant="primary"
              icon={VERB_ICONS.export}
              loading={exporting}
              disabled={!selected.available}
              data-slot="export-start"
              onClick={() => void start()}
            >
              {t`Export for ${where}`}
            </Button>
          ) : (
            <Button
              variant="primary"
              icon={VERB_ICONS.next}
              iconPlacement="end"
              data-slot="export-next"
              onClick={() => go(steps[index + 1]!.id)}
            >
              {t`Next`}
            </Button>
          )}
        </div>
      </DialogFooter>
    </div>
  );
}
