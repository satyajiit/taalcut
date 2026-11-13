// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import {
  callRpc,
  coverExportResultSchema,
  dispatchReceiptSchema,
  newId,
  NotFoundError,
  ok,
  err,
  type ApprovalDecision,
  type AsyncResult,
  type FixAction,
  type RunId,
} from '@taalcut/core';
import type { CardActions, DecideOutcome } from '@taalcut/ui';
import { useNavigate } from '@tanstack/react-router';
import { useMemo } from 'react';
import { useBackend } from '../backend/backend';
import { fixCommand } from '../backend/fix-command';
import { openFeedback } from '../features/feedback/feedback-state';
import { reelOfFix } from '../features/renders/reel-to-fetch';
import { useExportSurvey } from '../features/feedback/use-export-survey';
import { useServices } from '../services/provider';
import { currentProject } from '../shell/current-project';
import { phase3CardActions } from './card-actions-phase3';
import { navigateCardLink } from './card-links';
import { useEditTurn } from './edit-turn';
import { useOpenExternal } from './open-external';
import { useVoiceCapture } from '../features/voice/use-voice-capture';
import { addStarterTemplate } from './starter-actions';
import { RUN_FINISHED } from './transcript';

declare global {
  interface Window {
    /** The preload's file bridge (desktop lane): a dropped file's path on this Mac. */
    taalcutFiles?: { pathFor(file: File): string | null };
  }
}

/**
 * What a domain card's buttons do anywhere in the app (chat, /dev/kit): a
 * slot edit or an added folder is a command on the bus from 'ui' (one
 * idempotency key per press), undoable with ⌘Z or the toast's Undo, which is
 * the same undo; links become routes; pausing an import is scheduling, not a
 * command. "Ask about this slot" stays off until the composer takes chips.
 */
export function useAppCardActions(): CardActions {
  const backend = useBackend();
  const navigate = useNavigate();
  const survey = useExportSurvey();
  const openLink = useOpenExternal();
  const voiceCapture = useVoiceCapture();
  const editTurn = useEditTurn();
  return useMemo<CardActions>(
    () => ({
      exportCover: async (input) => {
        const result = await callRpc(
          backend.commands.dispatch({
            name: 'render.exportCover',
            payload: input,
            source: 'ui',
            idempotencyKey: newId(),
          }),
        );
        return result.ok
          ? ok(coverExportResultSchema.parse(dispatchReceiptSchema.parse(result.value).result))
          : result;
      },
      saveExportAs: (fileName) => callRpc(backend.files.saveExportAs({ fileName })),
      dispatch: (name, payload) =>
        callRpc(backend.commands.dispatch({ name, payload, source: 'ui', idempotencyKey: newId() })),
      // A card's Undo is ⌘Z: in the card's project when it names one (a chat card isn't on its project's page),
      // else the open project's history on its page (the editor), app-wide elsewhere.
      undo: (projectId) =>
        callRpc(
          backend.commands.undo({
            projectId: projectId === undefined ? currentProject() : projectId,
            source: 'ui',
          }),
        ),
      addStarter: (starterId) => addStarterTemplate(backend, starterId),
      // BRK1-REV: the review's "Tell Taalcut".
      proposeEdits: (input) => callRpc(backend.templates.proposeEdits(input)),
      navigate: (link) => navigateCardLink(navigate, link),
      pickFolder: () => callRpc(backend.files.pickFolder()),
      reveal: (renderId) => callRpc(backend.files.revealRender({ renderId })),
      pickFile: (purpose) => callRpc(backend.files.pickFile({ purpose })),
      ...(window.taalcutFiles
        ? { pathForFile: (file: File) => window.taalcutFiles?.pathFor(file) ?? null }
        : {}),
      ...(survey ? { survey } : {}),
      report: (error) => openFeedback(error),
      openExternal: openLink,
      // P3-B6: the microphone for a voice consent, streamed to main.
      voiceCapture,
      indexing: {
        pause: () => callRpc(backend.indexing.pause()),
        resume: () => callRpc(backend.indexing.resume()),
        retryFailed: (sourceId) => callRpc(backend.indexing.retryFailed(sourceId ? { sourceId } : {})),
      },
      // Phase 3 (ui-make): the hub's Fork and Share, stock for a gap.
      ...phase3CardActions(backend, navigate),
      // EDT1-CTX: the changes card's Undo all, Redo and rows.
      editTurn,
    }),
    [backend, navigate, survey, openLink, voiceCapture, editTurn],
  );
}

/**
 * What card buttons do in the chat: an error's fix is a command on the bus
 * (one idempotency key per press, so a double click applies once), except
 * getting a template's reel again (REF1: `templates.fetchMedia`, render's fix
 * when the reel's music is gone), which is the templates service's; an
 * approval, consent or cost estimate is answered through the conversation,
 * which streams the run as it carries on. Success is silent: the card shows
 * the answer in place. A failed answer comes back to the card, which keeps it
 * open with the cause and Try again (UX round 1: it used to be a toast while
 * the card settled as if it had gone); one for a run that had already ended
 * is `closed`, and the transcript says so calmly under the run. A consent
 * card's "Always allow" sends `remember`. Domain cards get the app's actions.
 */
export function useChatCardActions(
  runIdForApproval: (approvalId: string) => RunId | undefined,
  answer: (decision: ApprovalDecision) => AsyncResult<void>,
  chat: ChatCardSurface = {},
): CardActions {
  const { commands } = useServices();
  const backend = useBackend();
  const app = useAppCardActions();
  return useMemo<CardActions>(
    () => ({
      ...app,
      // The error line confirms the outcome in place: "…: done", or the new cause and its fix.
      runFix: (fix: FixAction) => {
        const reel = reelOfFix(fix);
        if (reel) return callRpc(backend.templates.fetchMedia({ id: reel }));
        return commands.dispatch({ ...fixCommand(fix), source: 'ui', idempotencyKey: newId() });
      },
      async decide(approvalId, decision, options): AsyncResult<DecideOutcome> {
        const runId = runIdForApproval(approvalId);
        // The card isn't in this chat's runs any more (reloaded under it): nothing can take the answer.
        if (!runId) return err(NotFoundError({ entity: 'approval', id: approvalId }));
        const remember = options?.remember === true;
        const result = await answer({
          runId,
          approvalId,
          decision,
          ...(remember ? { remember } : {}),
          ...(options?.answer ? { answer: options.answer } : {}),
        });
        if (result.ok) return ok('answered');
        // The conversation says so under the run; nothing went wrong.
        return result.error.code === RUN_FINISHED ? ok('closed') : result;
      },
      ...chat,
    }),
    [app, backend, commands, runIdForApproval, answer, chat],
  );
}

/**
 * What only an open chat can do for its cards: start a flow in it, stop a run, the composer (P2-M13), and open its
 * approval's review page (UX4).
 */
export type ChatCardSurface = Pick<
  CardActions,
  'startFlow' | 'stopRun' | 'focusComposer' | 'ask' | 'followUp' | 'busy' | 'review'
>;
