// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* component: the recovery prompt (P1-D5; UX4 icons and type roles) · genre: atmospheric studio app · system: DESIGN.md
 *   v0.7 (Icons, Dialogs) + _orch/ux4/specs/design-onb.md
 * a decision dialog, so no Kaatu: the title, one calm sentence, what was recovered as a list (each line led by its
 *   registry glyph: an earlier copy, the agent, waiting, a warning), then the answer: Resume (play glyph, the one
 *   marigold fill) or Not now / Got it, and View details. Only the middle scrolls.
 * states (buttons): default · hover · focus (base ring) · active · loading (Resume spins) · error (ErrorCard in the
 *   middle, with Try again) · success (the chat opens, or a toast when there is none)
 */
import { Plural, Trans, useLingui } from '@lingui/react/macro';
import type { RecoveryReport, TaalcutError } from '@taalcut/core';
import {
  AiMarkIcon,
  Button,
  CONCEPT_ICONS,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  ErrorCard,
  Glyph,
  toast,
  VERB_ICONS,
} from '@taalcut/ui';
import { useNavigate } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useBackendEvents } from '../backend/use-events';
import { useConversationsRevision, useRunsResumed, useServices } from '../services/provider';
import { mergeReports } from './client';
import { Moment, RecoveryDetails } from './recovery-details';

/** Why the prompt is showing: a launch after a crash, or the agent process restarting mid-session. */
type Cause = 'launch' | 'agent-restarted';

function Item({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <li className="flex items-start gap-3 type-body text-ink">
      <span aria-hidden className="mt-0.75 inline-flex shrink-0 text-ink-2 [&_svg]:size-4">
        {icon}
      </span>
      <span className="min-w-0 flex-1">{children}</span>
    </li>
  );
}

/**
 * After a crash, says calmly what Taalcut recovered (P1-D5): a library restored
 * from a backup, agent tasks that stopped partway, background jobs picked up
 * again. Offers to resume the tasks, the details, or just carrying on. Shows
 * nothing when there is nothing to tell. The report is read at launch and
 * again on `recovery.changed` (main re-offers a run an agent-process crash cut
 * off); a report that arrives while the prompt is open joins it, never a
 * second dialog. Only the middle scrolls: the title and the buttons stay in
 * view however long the details are, and the main button has the focus.
 */
export function RecoveryPrompt() {
  const { recovery } = useServices();
  const [, conversationsChanged] = useConversationsRevision();
  const [, runsResumed] = useRunsResumed();
  const { t } = useLingui();
  const navigate = useNavigate();
  const [report, setReport] = useState<RecoveryReport | null>(null);
  const [cause, setCause] = useState<Cause>('launch');
  const [open, setOpen] = useState(false);
  const [details, setDetails] = useState(false);
  const [resuming, setResuming] = useState(false);
  const [error, setError] = useState<TaalcutError | null>(null);
  /** The report the open prompt shows; null when it is closed. */
  const showing = useRef<RecoveryReport | null>(null);
  /** The button that answers the prompt: Resume when there is a task, else Got it. */
  const primary = useRef<HTMLButtonElement>(null);

  const offer = useCallback((fresh: RecoveryReport, why: Cause) => {
    if (!fresh.needsAttention) return;
    const shown = showing.current;
    const next = shown ? mergeReports(shown, fresh) : fresh;
    showing.current = next;
    setReport(next);
    if (shown) return;
    setCause(why);
    setDetails(false);
    setError(null);
    setOpen(true);
  }, []);

  useEffect(() => {
    let live = true;
    void recovery.report().then((result) => {
      if (live && result.ok) offer(result.value, 'launch');
    });
    return () => {
      live = false;
    };
  }, [recovery, offer]);

  // Main re-offers runs mid-session (the agent process restarted): read its report again.
  useBackendEvents(['recovery.changed'], () => {
    void recovery.report().then((result) => {
      if (result.ok) offer(result.value, 'agent-restarted');
    });
  });

  if (!report) return null;
  const backup = report.restoredFromBackup;
  const backupDate = backup ? <Moment at={backup.restoredFrom.createdAt} /> : null;
  const runs = report.unfinishedRuns;
  const queued = report.reclaimedJobs.filter((job) => job.state === 'queued').length;
  const failed = report.reclaimedJobs.filter((job) => job.state === 'failed').length;

  const close = () => {
    showing.current = null;
    setOpen(false);
  };
  const dismiss = () => {
    close();
    void recovery.dismiss();
  };

  const resume = async () => {
    setResuming(true);
    setError(null);
    const result = await recovery.resumeRuns(runs.map((run) => run.runId));
    setResuming(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    close();
    runsResumed();
    conversationsChanged();
    // Success is silent where it shows: the chat opens and the run carries on in it.
    // With no chat to open, the only sign is this toast (DESIGN.md, "Toasts").
    const conversationId = runs.find((run) => run.conversationId)?.conversationId;
    if (conversationId) void navigate({ to: '/chat/$conversationId', params: { conversationId } });
    else toast({ tone: 'success', title: t`Picking up where it left off` });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? setOpen(true) : dismiss())}>
      <DialogContent
        data-slot="recovery-prompt"
        className="flex max-h-[85vh] max-w-xl flex-col"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          primary.current?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>
            {cause === 'agent-restarted' ? (
              <Trans>The agent restarted</Trans>
            ) : (
              <Trans>Taalcut is back</Trans>
            )}
          </DialogTitle>
          <DialogDescription>
            {cause === 'agent-restarted' ? (
              <Trans>
                It stopped unexpectedly and has started again. Everything you saved is still here.
              </Trans>
            ) : backup ? (
              <Trans>It closed before it could finish. Here is what it recovered.</Trans>
            ) : (
              <Trans>It closed before it could finish. Everything you saved is still here.</Trans>
            )}
          </DialogDescription>
        </DialogHeader>
        <div
          data-slot="recovery-body"
          className="scrollbar-thin -mx-6 flex min-h-0 flex-col gap-4 overflow-y-auto px-6"
        >
          <ul className="m-0 flex list-none flex-col gap-3 p-0">
            {backup ? (
              <Item icon={<Glyph icon={CONCEPT_ICONS.backup} />}>
                {backup.reason === 'missing' ? (
                  <Trans>
                    Taalcut couldn't find your library file, so it put back the copy from {backupDate}.
                    Changes made after that copy aren't in it.
                  </Trans>
                ) : (
                  <Trans>
                    Your library file was damaged, so Taalcut put back the copy from {backupDate}. Changes
                    made after that copy aren't in it.
                  </Trans>
                )}
              </Item>
            ) : null}
            {runs.length > 0 ? (
              <Item icon={<AiMarkIcon />}>
                <Plural
                  value={runs.length}
                  one="One agent task stopped partway. It can pick up where it left off."
                  other="# agent tasks stopped partway. They can pick up where they left off."
                />
              </Item>
            ) : null}
            {queued > 0 ? (
              <Item icon={<Glyph icon={CONCEPT_ICONS.waiting} />}>
                <Plural
                  value={queued}
                  one="One background job will continue on its own."
                  other="# background jobs will continue on their own."
                />
              </Item>
            ) : null}
            {failed > 0 ? (
              <Item icon={<Glyph icon={CONCEPT_ICONS.warning} />}>
                <Plural
                  value={failed}
                  one="One background job couldn't restart. You can start it again when you're ready."
                  other="# background jobs couldn't restart. You can start them again when you're ready."
                />
              </Item>
            ) : null}
          </ul>
          {details ? <RecoveryDetails report={report} /> : null}
          {error ? <ErrorCard error={error} onRetry={() => void resume()} /> : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setDetails((shown) => !shown)} aria-expanded={details}>
            {details ? t`Hide details` : t`View details`}
          </Button>
          <Button ref={runs.length > 0 ? undefined : primary} onClick={dismiss}>
            {runs.length > 0 ? t`Not now` : t`Got it`}
          </Button>
          {runs.length > 0 ? (
            <Button
              ref={primary}
              variant="primary"
              icon={VERB_ICONS.play}
              loading={resuming}
              onClick={() => void resume()}
            >
              <Plural value={runs.length} one="Resume the task" other="Resume the tasks" />
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
