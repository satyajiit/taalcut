// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The tool contract (PRD 7.2 "Tool registry", R22). A tool is a typed,
 * versioned, permissioned function the agent can call. Domain packages define
 * tools with defineTool() and export them as a ToolModule; the registry,
 * search and executor live in @taalcut/tools.
 *
 * This lives in core because domain packages (media, vision, library, ...)
 * may import nothing but core. Keep it to types and pure helpers.
 */
import type { z } from 'zod';
import type { ProjectId, RunId, ToolRunId } from '../basics/ids';
import type { Card } from '../cards/cards';
import type { AsyncResult } from '../basics/result';
import type { Billed } from '../ports/model-ports';
import type { EditItemTarget, EditorContext } from '../timeline/edit-target';
import type { ArtifactRef, ArtifactStore } from './artifacts';

/** Who pays: runs on this Mac, calls a cloud model on the user's plan, or spends money/credits. */
export const TOOL_COST_CLASSES = ['local', 'cloud', 'paid'] as const;
export type ToolCostClass = (typeof TOOL_COST_CLASSES)[number];

/**
 * What the tool changes. 'read' changes nothing the user owns; 'write' changes
 * project or library state through an undoable command; 'destructive' deletes
 * or overwrites in a way undo may not fully restore; 'external' sends something
 * off the device or to another app (upload, publish, message).
 */
export const TOOL_SIDE_EFFECTS = ['read', 'write', 'destructive', 'external'] as const;
export type ToolSideEffect = (typeof TOOL_SIDE_EFFECTS)[number];

/** These need an approval event in the run log at every autonomy level (PRD 7.2, "Safety"). */
export const APPROVAL_REQUIRED_SIDE_EFFECTS: readonly ToolSideEffect[] = ['destructive', 'external'];

/** These need an approval event in the run log at every autonomy level (PRD 7.2, "Safety"), as do `alwaysAsk` tools. */
export function toolNeedsApproval(tool: {
  readonly sideEffect: ToolSideEffect;
  readonly alwaysAsk?: boolean;
}): boolean {
  return tool.alwaysAsk === true || APPROVAL_REQUIRED_SIDE_EFFECTS.includes(tool.sideEffect);
}

/** Filesystem areas a tool may touch. 'user-selected' means paths the user picked in a dialog. */
export const TOOL_FS_SCOPES = ['library', 'project', 'scratch', 'user-selected', 'app-data'] as const;
export type ToolFsScope = (typeof TOOL_FS_SCOPES)[number];

/** EAR1-I5: kinds of the user's media an upload can name (`ToolPermission.uploads.media`). */
export const UPLOAD_MEDIA_KINDS = ['frames', 'audio'] as const;
export type UploadMediaKind = (typeof UPLOAD_MEDIA_KINDS)[number];

/** What the tool needs beyond its input. Checked against settings (local-only mode, privacy) before it runs. */
export interface ToolPermission {
  readonly filesystem?: { readonly read?: readonly ToolFsScope[]; readonly write?: readonly ToolFsScope[] };
  readonly network?: 'none' | 'lan' | 'internet';
  /** Model modules from @taalcut/models the tool calls, e.g. ['vision']. Drives "what leaves this device" (G9). */
  readonly cloudModules?: readonly string[];
  /**
   * The tool sends the user's media off the device (PRD G9). The first upload
   * always asks with a consent card; later ones may run under a standing
   * consent, each still logged as an approval.
   */
  readonly uploads?: {
    readonly what: 'user-media';
    readonly consent: 'first-use';
    /**
     * EAR1-I5: the kind of media it sends, when its modules' standing consents must not cover it: audio.cloudCritique
     * sends sound through `vision`, whose "Always allow" the person gave for frames. A named kind has a standing
     * consent of its own per module, so its first upload asks even when the module's is given. Omitted: the
     * module's own consent covers it.
     */
    readonly media?: UploadMediaKind;
  };
}

/**
 * Retries apply only to errors marked `retryable` (TaalcutError.retryable).
 * Tools that change state must declare an idempotency key, so a retry can't
 * apply a change twice.
 * Delay before retry n (1-based) is min(maxDelayMs, initialDelayMs * factor^(n-1)), with jitter.
 */
export interface ToolRetryPolicy {
  /** Total attempts including the first. 1 means never retry. */
  readonly maxAttempts: number;
  readonly initialDelayMs: number;
  /** Default 30 000. */
  readonly maxDelayMs?: number;
  /** Default 2. */
  readonly factor?: number;
}

export const NO_TOOL_RETRY: ToolRetryPolicy = { maxAttempts: 1, initialDelayMs: 0 };

/** Shown before an expensive call so the budget can stop and ask (G8). */
export interface ToolCostEstimate {
  readonly usd: number;
  /** Billing mode resolved before approval; tools must not silently switch away from subscription use. */
  readonly billing?: 'apiKey' | 'subscription';
  readonly tokens?: number;
  /**
   * What the provider bills when it isn't tokens (4 images, 1,240 characters, 182 seconds of music), so the cost
   * card says that instead of "0 tokens" (review M8).
   */
  readonly billed?: Billed;
  /** Developer note on how the estimate was made. */
  readonly basis?: string;
}

/** What `refineCost` gets: aborted when the call is cancelled or the gate gives up waiting. */
export interface ToolEstimateContext {
  readonly signal: AbortSignal;
}

/** What a call actually used; tools report it as they go (one report per model call is typical). */
export interface ToolUsage {
  readonly usd?: number;
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly provider?: string;
  readonly model?: string;
}

/** Given to every run of every tool. */
export interface ToolContextBase {
  /** Aborted on timeout and on cancel (stop button). Pass it to anything slow. */
  readonly signal: AbortSignal;
  readonly callId: ToolRunId;
  readonly runId?: RunId;
  /** 1 on the first attempt, 2 on the first retry, and so on. */
  readonly attempt: number;
  /** The estimate authorized for this invocation, preserved across retries and multi-part work. */
  readonly estimate?: ToolCostEstimate;
  /**
   * The call's idempotency key, for keyed calls (ToolSpec.idempotencyKey), so
   * an external tool with no command can pass it on to its service.
   */
  readonly idempotencyKey?: string;
  readonly artifacts: ArtifactStore;
  /**
   * EDT1-OPS: in the run of a message sent from the editor's docked chat, the editor as the person saw it and what
   * their words point at (the run's editor brief). An edit tool checks a change against it: a whole-video change
   * when the person pointed at a clip is refused once, naming the clip. Absent outside such a run.
   */
  readonly editor?: ToolEditorContext;
  reportUsage(usage: ToolUsage): void;
  /** fraction in [0, 1]. Shown on the tool-run card and in the trace. */
  reportProgress(fraction: number, note?: string): void;
}

/** EDT1-OPS: what a docked message's run pointed at, as its tools see it (ToolContextBase.editor). */
export interface ToolEditorContext {
  readonly context: EditorContext;
  readonly targets: readonly EditItemTarget[];
}

/** What a tool's card hooks get (resultCard, approvalCard). */
export interface ToolCardContext {
  readonly runId: RunId;
  readonly toolCallId: ToolRunId;
  readonly projectId: ProjectId | null;
  readonly signal: AbortSignal;
}

/** Context for tools that wrap a command on the command bus (PRD 6.2, V2). */
export interface CommandToolContext extends ToolContextBase {
  /**
   * Dispatches the tool's declared command with source 'agent', so the change
   * gets the same undo entry and audit row as the UI button. A tool can only
   * dispatch the command it declared.
   */
  dispatch(payload: unknown): AsyncResult<unknown>;
}

export type ToolContext<C extends string | undefined = undefined> = C extends string
  ? CommandToolContext
  : ToolContextBase;

/**
 * Everything a tool declares. `I` and `O` are zod schemas for input and
 * output; `C` is the command name for tools that change state.
 *
 * Function members use method syntax on purpose: it keeps a specific tool
 * assignable to AnyTool so modules can hold a plain array of tools.
 */
export interface ToolSpec<
  I extends z.ZodType = z.ZodType,
  O extends z.ZodType = z.ZodType,
  C extends string | undefined = string | undefined,
> {
  /** '<family>.<camelCase>', e.g. 'media.probe'. The family is the owning module's id. */
  readonly name: string;
  /** Semver. Bump major when input or output changes incompatibly. */
  readonly version: string;
  /** What the tool does, when to use it and what it returns. Goes into the model's tool schema. */
  readonly description: string;
  /** One line for the compact catalogue. Default: the description's first sentence. */
  readonly summary?: string;
  /** Routing family (the router picks a family first). Default: the name's prefix. */
  readonly family?: string;
  /** Extra search words, lowercase kebab-case: 'ffprobe', 'metadata'. */
  readonly tags?: readonly string[];
  readonly input: I;
  readonly output: O;
  readonly costClass: ToolCostClass;
  readonly sideEffect: ToolSideEffect;
  readonly timeoutMs: number;
  readonly retry: ToolRetryPolicy;
  readonly permission?: ToolPermission;
  /** The command this tool dispatches. Required for 'write' and 'destructive' tools. */
  readonly command?: C;
  /** Read tools only: cache results by content hash of (tool, version, input). */
  readonly cache?: boolean | { readonly ttlMs: number };
  /** A milestone the default autonomy level ("Only before render") stops before, e.g. render or export. */
  readonly checkpoint?: boolean;
  /**
   * LRN1-MEM: ask the user at every autonomy level, autopilot included, as destructive and external tools do, though
   * the change is local and undoable. For a write whose effect outlives the run (memory.remember: the item steers
   * every later run). Not on read tools.
   */
  readonly alwaysAsk?: boolean;
  /**
   * LRN1-CTX: a successful call stores the work the model gathered for it (a page of slot intents, say), so the
   * step's earlier tool calls and results no longer need to be in the model's prompt: the agent shows them as one
   * line from then on (agent SPEC, "Saved progress"). For a skill's long job done a page at a time, so the prompt
   * stays the same size as the pages grow. Not with `cache` (a cached call doesn't run, so it stores nothing).
   */
  readonly savesProgress?: boolean;
  /**
   * P3-V4: where else the tool is offered besides the built-in agent. Absent: everywhere it is allowed.
   * `mcp: false` keeps it off the MCP server at every level.
   */
  readonly exposure?: { readonly mcp?: boolean };
  /**
   * EDT1-OPS: a call's input mended before it is checked against `input` (AGT1's pattern of repairs before
   * validation), for a field the tool renamed: an older caller (an MCP client, a stored or recorded call, a QA fix)
   * still sends the old name, which the model no longer sees. Pure, from the raw input alone; an input it doesn't
   * know comes back unchanged.
   */
  mendInput?(input: unknown): unknown;
  /**
   * What makes two calls the same action, e.g. the folder path for
   * 'library.addSource'. Repeats with the same key in one run return the first
   * result instead of running again, and the key goes to the command bus so a
   * resumed run can't apply a command twice. Required for tools that change
   * state. Read tools may omit it: they are always safe to retry and are not
   * de-duplicated (use `cache` for that).
   */
  idempotencyKey?(input: z.output<I>): string;
  /**
   * Required for 'cloud' and 'paid' tools: called before the run so the budget can stop and ask. Synchronous
   * and from the input alone, so it is an upper bound where the cost depends on stored state (say so in `basis`).
   */
  estimateCost?(input: z.output<I>): ToolCostEstimate;
  /**
   * Round P3-3: a closer estimate that may read stored state (a timeline's draft characters, a song's length),
   * for tools that also declare `estimateCost`. The budget gate awaits it with the call's signal and uses it in
   * place of the bound when it answers ok; on an error it keeps the bound. Read-only: never spend or change state.
   */
  refineCost?(input: z.output<I>, ctx: ToolEstimateContext): AsyncResult<ToolCostEstimate>;
  /** Short text for the model when the output is large and stored as an artifact. */
  summarize?(output: z.output<O>): string;
  /**
   * HFW1: the pictures a call's output carries (frames it rendered and stored with `ctx.artifacts`, image media
   * types), so they reach a vision-capable model as images and not only as their summaries. The agent attaches only
   * the newest call's images and leaves older ones as their summaries (the design loop's `withoutPictures` rule); a
   * model without vision gets the summaries alone. From the output alone; a throw is ignored.
   */
  images?(output: z.output<O>): readonly ArtifactRef[];
  /**
   * FIX-TOOLGROUPS: what one call was about, for people: shown beside the tool's name in the chat, so eleven
   * "Inspect a clip" rows say which clip each was ("IMG_0412.MOV · 0:48"). Plain words from the input and output:
   * file names (`fileNameOf`, never a path), times as a clock (`callClock`), counts. Never text from inside a file
   * (OCR, transcripts, a vision model's description) or a model's words, and nothing that is not on this Mac
   * already. Undefined when there is nothing worth saying. The executor keeps it to one line of at most
   * TOOL_CALL_SUMMARY_MAX characters (`toolCallSummary`); a throw is ignored.
   */
  describeCall?(input: z.output<I>, output: z.output<O>): string | undefined;
  /**
   * A card for the call's result, shown in place of its tool row (render.export → renderProgress,
   * library.listSources → sourcePicker, library.importStatus → importProgress). Reads only.
   */
  resultCard?(output: z.output<O>, ctx: ToolCardContext): AsyncResult<Card | undefined>;
  /**
   * The decision card for this tool's approval instead of the generic one (render.export →
   * exportApproval). Only on tools that ask: destructive, external or checkpoint. Carries ctx.approvalId.
   */
  approvalCard?(
    input: z.output<I>,
    ctx: ToolCardContext & { readonly approvalId: string },
  ): AsyncResult<Card>;
  run(input: z.output<I>, ctx: ToolContext<C>): AsyncResult<z.input<O>>;
}

/** Any tool, whatever its schemas. What modules and the registry hold. */
export type AnyTool = ToolSpec;
