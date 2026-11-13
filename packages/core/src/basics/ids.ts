// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Entity ids are ULIDs (sortable by creation time, 26 characters), branded per
 * entity so a ProjectId can't be passed where a JobId is expected.
 */
import { decodeTime, monotonicFactory } from 'ulid';
import { ValidationError } from './errors';
import { isId, type Id } from './id-schema';
import { err, ok, type Result } from './result';

export { idSchema, isId, ULID_PATTERN, ulidSchema, type Id } from './id-schema';

export type ProjectId = Id<'Project'>;
export type ShortsRunId = Id<'ShortsRun'>;
export type ShortCandidateId = Id<'ShortCandidate'>;
export type ConversationId = Id<'Conversation'>;
export type MessageId = Id<'Message'>;
export type ToolRunId = Id<'ToolRun'>;
export type CommandId = Id<'Command'>;
export type JobId = Id<'Job'>;
export type RunId = Id<'AgentRun'>;
export type SpanId = Id<'Span'>;
export type ArtifactId = Id<'Artifact'>;
export type SourceId = Id<'Source'>;
export type ImportDraftId = Id<'ImportDraft'>;
export type ImportSessionId = Id<'ImportSession'>;
export type CaptureGroupId = Id<'CaptureGroup'>;
export type AssetId = Id<'Asset'>;
/** Where an asset's original file lives on a disk (ADR 0001). */
export type AssetLocationId = Id<'AssetLocation'>;
export type ShotId = Id<'Shot'>;
export type ModelProfileId = Id<'ModelProfile'>;
export type CloudCallId = Id<'CloudCall'>;
/** A recorded "I understand" for a card and terms version. */
export type AcknowledgementId = Id<'Acknowledgement'>;
export type TemplateId = Id<'Template'>;
/** A template slot. Stable across versions: a merge keeps the first slot's id. */
export type SlotId = Id<'TemplateSlot'>;
export type TextOverlayId = Id<'TextOverlay'>;
/** A look: fonts, colours, caption style. Kept apart from a template's structure. */
export type StyleId = Id<'Style'>;
/** A scratch folder for one breakdown or analysis (P2-T2). */
export type ExperimentId = Id<'Experiment'>;
export type TimelineId = Id<'Timeline'>;
/** A clip, gap, transition or text item, or a marker. Stable across edits. */
export type TimelineItemId = Id<'TimelineItem'>;
/** One casting run; its variants share it. */
export type CastId = Id<'Cast'>;
/** One caption cue on a timeline's caption track. */
export type CaptionCueId = Id<'CaptionCue'>;
/** One render of a timeline: an export (P2-M11). */
export type RenderId = Id<'Render'>;
/** A live preview of a timeline in one window. Not persisted. */
export type PreviewSessionId = Id<'PreviewSession'>;
/** One run of a flow (a fixed order of skills, P2-M12) across the runs of a conversation. */
export type FlowId = Id<'Flow'>;
/** This install, for telemetry only; a new one each time telemetry is turned on. */
export type InstallId = Id<'Install'>;
/** One app session, for telemetry only. */
export type TelemetrySessionId = Id<'TelemetrySession'>;
/** A saved snapshot of a timeline (P2-X3); a render's `timelineRevision` is the live counter. */
export type TimelineVersionId = Id<'TimelineVersion'>;
/** One opening of the phone import screen: one listener, one QR, one PIN. */
export type TransferSessionId = Id<'TransferSession'>;
/** A paired phone or tablet. */
export type TransferDeviceId = Id<'TransferDevice'>;
/** One file upload (also its tus upload id). */
export type TransferUploadId = Id<'TransferUpload'>;
/** A phone that scanned the QR asking to pair, until a person allows or denies it on the computer (UX3). */
export type TransferApprovalId = Id<'TransferApproval'>;
/** One USB import run from one device (P3-B4, P3-B5). */
export type DeviceImportRunId = Id<'DeviceImportRun'>;
/** One external-agent connection: a bearer token with a level (MCP, P3-V4). */
export type McpSessionId = Id<'McpSession'>;
/** A folder in the template library (P3-V14). */
export type TemplateFolderId = Id<'TemplateFolder'>;
/** A template in the hub, kept across the author's updates (P3-B12). */
export type HubTemplateId = Id<'HubTemplate'>;
/** One submission to the hub Worker. */
export type HubSubmissionId = Id<'HubSubmission'>;
/** One stock import, for its job and its inverse (P3-V18). */
export type StockImportId = Id<'StockImport'>;
/** A speaker's recorded consent to clone their voice (P3-B6). */
export type VoiceConsentId = Id<'VoiceConsent'>;
/** One microphone capture in main, before it becomes a consent. */
export type VoiceCaptureId = Id<'VoiceCapture'>;
/** A timeline's voiceover (P3-B6). */
export type VoiceoverId = Id<'Voiceover'>;
/** One line of a voiceover. */
export type VoiceLineId = Id<'VoiceLine'>;
/** A batch of renders in one queue (P3-V16). */
export type RenderBatchId = Id<'RenderBatch'>;
/** One remembered preference, decision or learned fact (PRD §6.3 MemoryItem, LRN1-MEM). */
export type MemoryId = Id<'MemoryItem'>;
/** A comment on a timeline: a note on a clip, a line of text or a stretch of time (EDT1-CMT). */
export type TimelineCommentId = Id<'TimelineComment'>;

const nextUlid = monotonicFactory();

/** A new id, strictly increasing within this process. */
export function newId<Entity extends string>(): Id<Entity> {
  return nextUlid() as Id<Entity>;
}

/** Validates untrusted input (IPC, database, URL) as an id. */
export function parseId<Entity extends string>(value: unknown): Result<Id<Entity>> {
  return isId(value)
    ? ok(value as Id<Entity>)
    : err(ValidationError({ field: 'id' }, { detail: 'Expected a ULID' })); // never the input: it may be a secret
}

/** Milliseconds since the epoch at which the id was made. */
export function idTime(id: Id<string>): number {
  return decodeTime(id);
}
