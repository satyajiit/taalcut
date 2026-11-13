// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import type {
  AssetId,
  CoverImageInput,
  CardOf,
  CastId,
  ChatStart,
  EditTarget,
  FixAction,
  HubTemplateId,
  Id,
  McpSessionId,
  ProjectId,
  QuestionAnswer,
  RenderId,
  Result,
  TemplateProposals,
  TemplateProposeEditsInput,
  RunId,
  SelectionChip,
  StockResult,
  TaalcutError,
  TemplateFolderId,
  TemplateId,
  TimelineId,
  TimelineItemId,
} from '@taalcut/core';
import type { FixOutcome } from '../feedback/error-card';
import type { CardVoiceCapture } from '../media/media-types';
import { createContext, useContext, type ReactNode } from 'react';

export type ApprovalDecision = 'approve' | 'deny';

/**
 * How an answer went when it didn't fail (UX round 1): `answered` (the run took it; the card settles when the
 * agent re-sends it) or `closed` (the run had already ended: the chat says so under it and the card expires, so
 * the card shows no error).
 */
export type DecideOutcome = 'answered' | 'closed';

/**
 * Settings pages a card can open. Phase 3 adds accounts, brand kits, the agent, external agents and About;
 * LRN1-MEM adds memory.
 */
export type CardSettingsSection =
  | 'usage'
  | 'privacy'
  | 'models'
  | 'sources'
  | 'accounts'
  | 'brand'
  | 'agents'
  | 'external-agents'
  | 'about'
  | 'memory';

/** Editor panels a card can open (Phase 3). */
export type CardEditorPanel = 'cleanup' | 'pacing' | 'gaps';

/** Where a card's link goes; the app turns it into a route. */
export type CardLink =
  | { readonly to: 'template'; readonly templateId: TemplateId }
  | { readonly to: 'library'; readonly filter?: 'failed' }
  | { readonly to: 'phone' | 'renders' }
  | {
      readonly to: 'settings';
      readonly section: CardSettingsSection;
      /** With 'external-agents': the session to open (an approval card's requester). */
      readonly sessionId?: McpSessionId;
    }
  // Make (P2-M7, P2-M11): the editor at a timeline, optionally with a clip selected or the export dialog open.
  | {
      readonly to: 'timeline';
      readonly projectId: ProjectId;
      readonly timelineId?: TimelineId;
      readonly clipId?: TimelineItemId;
      /** Open the export dialog over it (the export card's More options). */
      readonly exportDialog?: boolean;
      /** P3-V3: the compare view for a cast's variants. */
      readonly compare?: CastId;
      readonly panel?: CardEditorPanel;
    }
  // Phase 3: the template hub (P3-B12) and the template library (P3-V14).
  | { readonly to: 'hub'; readonly hubId?: HubTemplateId; readonly query?: string }
  | { readonly to: 'templates'; readonly folderId?: TemplateFolderId };

/** What main's file dialog is for (core's FILE_PICK_PURPOSES). */
export type CardPickPurpose = 'reference' | 'music' | 'brandImage' | 'templateFile';

/** The template hub from a card (P3-B12). */
export interface CardHub {
  /** Makes the template id, dispatches hub.fork, resolves with the new template. */
  fork(input: {
    readonly hubId: HubTemplateId;
    readonly version: number;
    readonly sha256: string;
  }): Promise<Result<{ readonly templateId: TemplateId }>>;
  /** Opens the Share dialog for a template (the agent's hub.openShare lands here too). */
  openShare(templateId: TemplateId, version?: number): void;
}

/** Stock media from a card (P3-V18). */
export interface CardStock {
  /** library.importStock, wait for its job, then timeline.fillGap. Resolves when the gap is filled. */
  use(input: {
    readonly item: StockResult;
    readonly projectId: ProjectId;
    readonly timelineId: TimelineId;
    readonly gapId: TimelineItemId;
  }): Promise<Result<{ readonly assetId: AssetId }>>;
}

/** Indexing is scheduling, not a change to anything: pause and resume aren't commands (core's indexingContract). */
export interface CardIndexing {
  pause(): Promise<Result<unknown>>;
  resume(): Promise<Result<unknown>>;
  retryFailed(sourceId?: Id<'Source'>): Promise<Result<unknown>>;
}

/**
 * What a card's buttons do. Cards are data from the agent; the app decides
 * what pressing their buttons means (usually a command on the bus) and
 * provides it here. Without a provider, buttons that need an action are hidden.
 */
export interface CardActions {
  exportCover?(input: Omit<CoverImageInput, 'cover'>): Promise<Result<{ fileName: string }>>;
  saveExportAs?(fileName: string): Promise<Result<unknown>>;
  /**
   * An error card's fix: dispatch `fix.command` with `fix.payload` and return
   * the result. The card confirms it (a toast, or a follow-up error card).
   */
  runFix?: (fix: FixAction) => FixOutcome | Promise<FixOutcome>;
  /**
   * An approval, consent, cost or budget card's answer. `remember`: a consent card's "Always allow";
   * `answer`: a skill's question answered with the approval (the cast board's "How many videos?").
   * Resolves once the answer is in, with how it went: a failure keeps the card open with its cause and Try again
   * (UX round 1; it used to resolve either way, so cards settled into success after a failed answer).
   */
  decide?: (
    approvalId: string,
    decision: ApprovalDecision,
    options?: { readonly remember?: boolean; readonly answer?: QuestionAnswer },
  ) => Promise<Result<DecideOutcome>>;
  /** A bus command from a card: source 'ui', one idempotency key per press, undoable from ⌘Z. */
  dispatch?: (name: string, payload: unknown) => Promise<Result<unknown>>;
  /**
   * Undo the last change (the Undo on a card's toast): the same as ⌘Z. `projectId` names the history when the card
   * knows its project (a chat card isn't on its project's page, where ⌘Z's project is set); without it, the page's.
   */
  undo?: (projectId?: ProjectId | null) => Promise<Result<unknown>>;
  navigate?: (to: CardLink) => void;
  /**
   * UX4: opens the one approval's review page (the video first, Export under it). Only a chat can: the page is
   * under its conversation. Without it the summary card offers the editor's export dialog instead.
   */
  review?: (card: CardOf<'exportApproval'>) => void;
  /**
   * BRK1 "Tell Taalcut" (templates.proposeEdits): proposed edits to a template as data, nothing applied. The review
   * dispatches each one the person accepts as a normal command.
   */
  proposeEdits?: (input: TemplateProposeEditsInput) => Promise<Result<TemplateProposals>>;
  /** Puts text and chips into the composer, unsent ("Ask about this slot"). */
  ask?: (text: string, selections: readonly SelectionChip[]) => void;
  /** Main's folder dialog; null when cancelled. */
  pickFolder?: () => Promise<Result<{ readonly path: string } | null>>;
  /** A dropped file's path on this Mac (the preload's file bridge); null when it has none. */
  pathForFile?: (file: File) => string | null;
  /** Main's file dialog for a reference, a track, a brand image or a template file; null when cancelled. */
  pickFile?: (purpose: CardPickPurpose) => Promise<Result<{ readonly path: string } | null>>;
  /**
   * An opening choice: chat.send with `start`, the choice's sentence shown as the user's message (P2-M13).
   * The app holds a reel link for the reference warning card first.
   */
  startFlow?: (start: ChatStart, text: string) => Promise<Result<unknown>>;
  /**
   * P3-B3: forks a bundled starter into the person's templates (`template.addStarter` under a new id the host
   * mints); the template flow then starts at the id it answers.
   */
  addStarter?: (starterId: string) => Promise<Result<{ readonly templateId: TemplateId }>>;
  /** "Just describe it": puts the cursor in the composer. */
  focusComposer?: () => void;
  /** Stops a run by id (a cost card's Stop). */
  stopRun?: (runId: RunId) => Promise<Result<unknown>>;
  /** The export survey ("Would you post this?"), when telemetry is on (P2-X7). */
  survey?: CardSurvey;
  /** "Report this" on an error: opens Send feedback with the error named. */
  report?: (error: TaalcutError) => void;
  indexing?: CardIndexing;
  /** Make (P2-M11): shows a finished render's file in Finder (main's files.revealRender). */
  reveal?: (renderId: RenderId) => Promise<Result<unknown>>;
  /** P3-B12: fork from the hub, open Share. */
  hub?: CardHub;
  /** P3-V18: use a stock result for a gap. */
  stock?: CardStock;
  /** P3-B6: the microphone for a voice consent (the renderer records; main keeps the file). */
  voiceCapture?: CardVoiceCapture;
  /**
   * P3-B6, P3-B7: sends `text` and chips to the run as the person's next message; what it asks for may cost money,
   * so the agent shows its cost card first. Without it the cards put the words in the composer (`ask`).
   */
  followUp?: (runId: RunId, text: string, selections: readonly SelectionChip[]) => Promise<Result<unknown>>;
  /** G8: a provider's billing page (a rateLimit card's Add credit), through main's allow-listed shell.open. */
  openExternal?: (url: string) => void;
  /** A run is going in this chat: the cards that would start another wait (the opening choices). */
  busy?: boolean;
  /** Show developer detail (error codes, tool ids). Off for users. */
  developerMode?: boolean;
  /** EDT1: the changes card's turn in the editor's history, and its rows' jumps. Without it the card only lists. */
  editTurn?: CardEditTurn;
}

/**
 * Where an AI turn's changes stand in the project's history (EDT1-CTX): `applied`, its group is the next undo;
 * `undone`, it is the next redo; `later`, other changes came after it, so it can't be taken back on its own;
 * `unknown`, still reading.
 */
export type EditTurnStatus = 'applied' | 'undone' | 'later' | 'unknown';

/** What the changes card does: undo and redo its turn whole, open a row's item in the editor. */
export interface CardEditTurn {
  /** The turn's status, kept current as the history changes. A hook: call it on every render. */
  useStatus(projectId: ProjectId, group: string): EditTurnStatus;
  undo(projectId: ProjectId, group: string): Promise<Result<unknown>>;
  redo(projectId: ProjectId, group: string): Promise<Result<unknown>>;
  /** Selects the target in the editor and puts the playhead at `at` seconds, when given. */
  open(projectId: ProjectId, target: EditTarget, at: number | null): void;
  /**
   * HFW1-UI: a design row's View files: the editor's Files tab on that graphic's design (the editor opens on its
   * video first). Without it the row has no View files.
   */
  openFiles?(projectId: ProjectId, target: EditTarget): void;
}

/** The one-question survey after an export: asked once per render, only with telemetry on. */
export interface CardSurvey {
  /** Already answered (or dismissed) for this render: don't ask again. */
  asked(renderId: RenderId): boolean;
  answer(renderId: RenderId, answer: SurveyAnswer): Promise<Result<unknown>>;
}

export type SurveyAnswer = 'yes' | 'maybe' | 'no';

const CardActionsContext = createContext<CardActions>({});

export function CardActionsProvider({ value, children }: { value: CardActions; children: ReactNode }) {
  return <CardActionsContext.Provider value={value}>{children}</CardActionsContext.Provider>;
}

export function useCardActions(): CardActions {
  return useContext(CardActionsContext);
}
