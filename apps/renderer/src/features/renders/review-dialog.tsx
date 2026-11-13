// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: QA review dialog · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md v0.3
 * an export the checks stopped: its poster with the platform's buttons drawn over it (where captions mustn't
 *   go), what failed in plain words with its fixes, and Export anyway only when every failing check allows it.
 *   A fix changes the timeline, so the next step is to export again, which checks it again.
 * states: loading (the poster grey and three bone lines) · error (the cause, Try again) · default (the checks)
 *   · fixing (the fix button spins) · fixed ("Changed. Export again to check it." and the one primary button)
 *   · exporting (Export again spins) · overridden (the dialog closes; the row reads Exported anyway)
 *   · fix failed (the cause under the checks; the dialog stays)
 * pre-emit critique: P5 H5 E4 S5 R4 V4
 */
import { Plural, Trans, useLingui } from '@lingui/react/macro';
import {
  callRpc,
  newId,
  RENDER_COMMANDS,
  type QaCheckId,
  type QaFix,
  type RenderSnapshot,
} from '@taalcut/core';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  ErrorLine,
  errorMessage,
  presetLabel,
  QaChecklist,
  SafeZoneOverlay,
  UserContent,
  VERB_ICONS,
} from '@taalcut/ui';
import { useNavigate } from '@tanstack/react-router';
import { CircleCheck } from 'lucide-react';
import { useState } from 'react';
import { useBackend } from '../../backend/backend';
import { useRpcQuery } from '../../backend/use-rpc';
import { useRenderPoster } from './use-render-media';

export interface ReviewDialogProps {
  render: RenderSnapshot | null;
  onOpenChange: (open: boolean) => void;
}

export function ReviewDialog({ render, onOpenChange }: ReviewDialogProps) {
  return (
    <Dialog open={render !== null} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        {render ? <ReviewBody key={render.id} render={render} close={() => onOpenChange(false)} /> : null}
      </DialogContent>
    </Dialog>
  );
}

/** The review itself, for this dialog and for the export dialog when its export needs a look. */
export function ReviewBody({ render, close }: { render: RenderSnapshot; close: () => void }) {
  const { t, i18n } = useLingui();
  const backend = useBackend();
  const navigate = useNavigate();
  const poster = useRenderPoster(render.id, render.status);
  const report = useRpcQuery(
    (signal) => backend.renders.qaReport({ renderId: render.id }, { signal }),
    [backend, render.id],
  );
  const presets = useRpcQuery((signal) => backend.renders.presets(undefined, { signal }), [backend]);
  const preset = presets.data?.find((candidate) => candidate.id === render.presetId);
  const [fixed, setFixed] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const dispatch = (name: string, payload: unknown) =>
    callRpc(backend.commands.dispatch({ name, payload, source: 'ui', idempotencyKey: newId() }));
  const fix = async (fixAction: QaFix) => {
    setProblem(null);
    if (fixAction.kind === 'agent') {
      // A fix that needs judgment: the project's timeline, where the agent can be asked.
      close();
      return void navigate({
        to: '/projects/$projectId/timeline',
        params: { projectId: render.projectId },
        search: { timeline: render.timelineId },
      });
    }
    if (fixAction.kind !== 'command') return;
    const result = await dispatch(fixAction.command, fixAction.payload);
    if (result.ok) setFixed(true);
    else setProblem(errorMessage(i18n, result.error));
  };
  const override = async (checks: readonly QaCheckId[]) => {
    setProblem(null);
    const result = await dispatch(RENDER_COMMANDS.overrideQa, {
      projectId: render.projectId,
      renderId: render.id,
      checks,
    });
    if (result.ok) close();
    else setProblem(errorMessage(i18n, result.error));
  };
  const exportAgain = async () => {
    setExporting(true);
    setProblem(null);
    const result = await dispatch(RENDER_COMMANDS.export, {
      projectId: render.projectId,
      timelineId: render.timelineId,
      presetId: render.presetId,
      captions: render.captions,
      supersedes: render.id,
    });
    setExporting(false);
    if (result.ok) close();
    else setProblem(errorMessage(i18n, result.error));
  };

  const rounds = render.qa?.round ?? report.data?.round ?? 1;
  const where = presetLabel(i18n, render.presetId);
  return (
    <div className="flex flex-col gap-5" data-slot="render-review">
      <DialogHeader>
        <DialogTitle>{t`Needs review before you post it`}</DialogTitle>
        <DialogDescription>
          <Trans>
            Taalcut checked it <Plural value={rounds} one="once" other="# times" /> and couldn’t fix this by
            itself. Fix it here, or export it as it is.
          </Trans>
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-col gap-5 sm:flex-row">
        <figure className="m-0 flex shrink-0 flex-col gap-2">
          <div
            className="relative aspect-[9/16] w-40 overflow-hidden rounded-lg bg-viewer bg-cover bg-center"
            style={poster ? { backgroundImage: `url("${poster}")` } : undefined}
          >
            {preset ? <SafeZoneOverlay overlays={preset.overlays} safe={preset.safe} /> : null}
          </div>
          <figcaption className="max-w-40 text-xs text-ink-2">
            {t`Grey: where ${where} puts its own buttons and words.`}
          </figcaption>
        </figure>
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <UserContent translate="no" className="text-md font-semibold text-ink">
            {render.name}
          </UserContent>
          {report.error && !report.data ? (
            <div className="flex flex-col items-start gap-3">
              <ErrorLine error={report.error} />
              <Button size="sm" icon={VERB_ICONS.retry} onClick={report.reload}>
                {t`Try again`}
              </Button>
            </div>
          ) : !report.data ? (
            <div aria-busy="true" aria-label={t`Loading the checks`} className="flex flex-col gap-2">
              {Array.from({ length: 3 }, (_, i) => (
                <span key={i} aria-hidden className="tc-bone block h-4 w-full rounded-sm bg-hover" />
              ))}
            </div>
          ) : fixed ? (
            <p className="m-0 flex items-start gap-2 text-sm text-ink" role="status">
              <CircleCheck aria-hidden className="mt-0.5 size-4 shrink-0 text-success-strong" />
              {t`Changed. Export again to check it.`}
            </p>
          ) : (
            <QaChecklist
              checks={report.data.checks}
              onFix={(_check, fixAction) => fix(fixAction)}
              onOverride={override}
            />
          )}
          {problem ? (
            <p role="alert" className="m-0 text-sm text-danger-strong">
              {problem}
            </p>
          ) : null}
        </div>
      </div>
      <DialogFooter>
        <Button variant="ghost" onClick={close}>
          {fixed ? t`Later` : t`Close`}
        </Button>
        {fixed ? (
          <Button
            variant="primary"
            icon={VERB_ICONS.export}
            loading={exporting}
            onClick={() => void exportAgain()}
          >
            {t`Export again`}
          </Button>
        ) : null}
      </DialogFooter>
    </div>
  );
}
