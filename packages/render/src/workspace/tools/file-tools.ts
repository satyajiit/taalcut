// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The workspace's file tools (HFW1 "dsn"): `workspace.list` and `workspace.read` (paged; a file's text is the
 * model's own or Taalcut's brief, and comes back fenced as untrusted), `workspace.new` (a blank scaffold that passes
 * the gate: structure only), `workspace.write` and `workspace.patch` (a find-and-replace list). Every write is one
 * `workspace.writeFiles` over the head the tool read, so it undoes with the turn.
 */
import {
  err,
  NO_TOOL_RETRY,
  NotFoundError,
  ok,
  ulidSchema,
  ValidationError,
  WORKSPACE_COMMANDS,
  workspacePathSchema,
  type AsyncResult,
  type ProjectId,
  type TimelineId,
} from '@taalcut/core';
import { z } from 'zod';
import { brief } from './brief';
import type { WorkspaceToolDeps } from './deps';
import { workspaceManageTools } from './manage-tools';
import { COMPOSITION_NAME, scaffoldHtml, scaffoldPath } from './scaffold';
import { entryLabel, keyOf, LOCAL, READ_RETRY, workspaceTool } from './tool-parts';
import {
  BRIEF_PATH,
  copyText,
  fileAt,
  headOf,
  pagesOf,
  RESERVED_FOLDER,
  stageTexts,
  textOf,
  writablePath,
  writeStaged,
} from './workspace-io';

/** Characters in one page of `workspace.read`. */
export const READ_PAGE_CHARS = 6_500;

const projectId = ulidSchema('Project');
const timelineId = ulidSchema('Timeline');
const revision = z.int().min(0).describe('The workspace revision after the call');
const written = z.object({ path: z.string(), revision, bytes: z.int().nonnegative() });
const placedSchema = z.object({
  compositionId: z.string(),
  version: z.int().min(1),
  name: z.string().meta({ untrusted: 'composition-name' }),
  entry: z.string(),
  itemIds: z.array(z.string()),
  /** The head holds its entry with the same bytes there. */
  inWorkspace: z.boolean(),
});

export { brief };

/** What `read` reads: the brief, a placed composition's entry, or a file at the head. */
async function readSource(
  deps: WorkspaceToolDeps,
  input: {
    projectId: ProjectId;
    path?: string | undefined;
    compositionId?: string | undefined;
    timelineId?: TimelineId | undefined;
  },
): AsyncResult<{ path: string; revision: number; text: string }> {
  const head = await headOf(deps.store, input.projectId);
  if (!head.ok) return head;
  if (input.compositionId) {
    if (!input.timelineId)
      return err(ValidationError({ field: 'timelineId' }, { detail: 'Give the timeline that holds it' }));
    const timeline = await deps.timelines.get(input.timelineId);
    if (!timeline.ok) return timeline;
    const copy = (timeline.value.graphicCompositions ?? [])
      .filter((entry) => entry.id === input.compositionId)
      .sort((a, b) => b.version - a.version)[0];
    if (!copy) return err(NotFoundError({ entity: 'graphicComposition', id: input.compositionId }));
    const text = await copyText(deps.store, input.projectId, copy);
    return text.ok ? ok({ path: copy.entry, revision: head.value.revision, text: text.value }) : text;
  }
  const path = input.path ?? BRIEF_PATH;
  if (path === BRIEF_PATH) {
    if (!input.timelineId) {
      const existing = head.value.files.find((entry) => entry.path === BRIEF_PATH);
      if (existing) {
        const text = await textOf(deps.store, input.projectId, existing);
        return text.ok ? ok({ path, revision: head.value.revision, text: text.value }) : text;
      }
      return err(
        ValidationError(
          { field: 'timelineId' },
          {
            detail:
              'Pass path (e.g. from workspace.files) to read a workspace file, or pass timelineId to generate _taalcut/brief.md.',
          },
        ),
      );
    }
    const text = await brief(deps, input.timelineId);
    if (!text.ok) return text;
    await deps.store.writeReserved?.(input.projectId, BRIEF_PATH, new TextEncoder().encode(text.value));
    return ok({ path, revision: head.value.revision, text: text.value });
  }
  const file = fileAt(head.value, path);
  if (!file.ok) return file;
  const text = await textOf(deps.store, input.projectId, file.value);
  return text.ok ? ok({ path, revision: head.value.revision, text: text.value }) : text;
}

const editSchema = z.object({
  find: z.string().min(1).max(4000).describe('Text in the file, exactly as it is there'),
  replace: z.string().max(16_000),
  all: z.boolean().optional().describe('Replace every match; default: it must match exactly once'),
});

/** The text with each edit applied in turn, or why one can't be. */
function patched(text: string, edits: readonly z.output<typeof editSchema>[]) {
  let out = text;
  for (const [index, edit] of edits.entries()) {
    const count = out.split(edit.find).length - 1;
    if (count === 0 || (count > 1 && !edit.all))
      return err(
        ValidationError(
          { field: `edits.${index}.find` },
          {
            detail:
              count === 0
                ? `Edit ${index + 1}'s find is not in the file: read it again and copy the text exactly`
                : `Edit ${index + 1}'s find is in the file ${count} times: give more of the text, or set all`,
          },
        ),
      );
    out = out.split(edit.find).join(edit.replace);
  }
  return ok(out);
}

export function workspaceFileTools(deps: WorkspaceToolDeps) {
  const list = workspaceTool({
    name: 'workspace.list',
    description:
      "Lists the project's workspace: its files at the head revision, Taalcut's read-only brief " +
      `(${BRIEF_PATH}), and, given a timeline, the compositions its graphics are drawn with (their id, version, ` +
      'entry and the graphics using each).',
    summary: "Lists the workspace's files and the compositions on a timeline.",
    tags: ['workspace', 'files', 'list', 'hyperframes', 'composition'],
    input: z.object({ projectId, timelineId: timelineId.optional() }),
    output: z.object({
      revision,
      files: z.array(z.object({ path: z.string(), bytes: z.int().nonnegative() })),
      brief: z.string(),
      placed: z.array(placedSchema),
    }),
    sideEffect: 'read',
    timeoutMs: 10_000,
    retry: READ_RETRY,
    permission: LOCAL,
    describeCall: (_input, output) => `${output.files.length} files · revision ${output.revision}`,
    run: async (input) => {
      const head = await headOf(deps.store, input.projectId);
      if (!head.ok) return head;
      let placed: z.input<typeof placedSchema>[] = [];
      if (input.timelineId) {
        const timeline = await deps.timelines.get(input.timelineId);
        if (!timeline.ok) return timeline;
        const generated = await brief(deps, input.timelineId);
        if (generated.ok) {
          await deps.store.writeReserved?.(
            input.projectId,
            BRIEF_PATH,
            new TextEncoder().encode(generated.value),
          );
        }
        const users = new Map<string, string[]>();
        for (const track of timeline.value.tracks)
          if (track.kind === 'text')
            for (const item of track.items)
              if (item.type === 'graphic' && item.composition) {
                const key = `${item.composition.id}@${item.composition.hash}`;
                users.set(key, [...(users.get(key) ?? []), item.id]);
              }
        placed = (timeline.value.graphicCompositions ?? []).flatMap((copy) => {
          const itemIds = users.get(`${copy.id}@${copy.hash}`) ?? [];
          if (itemIds.length === 0) return [];
          const entry = copy.files.find((file) => file.path === copy.entry);
          const inWorkspace = head.value.files.some(
            (file) => file.path === copy.entry && file.sha256 === entry?.sha256,
          );
          return [
            {
              compositionId: copy.id,
              version: copy.version,
              name: copy.name,
              entry: copy.entry,
              itemIds,
              inWorkspace,
            },
          ];
        });
      }
      return ok({
        revision: head.value.revision,
        files: head.value.files
          .filter((file) => !file.path.startsWith(RESERVED_FOLDER))
          .map((file) => ({ path: file.path, bytes: file.bytes })),
        brief: BRIEF_PATH,
        placed,
      });
    },
  });

  const read = workspaceTool({
    name: 'workspace.read',
    description:
      'Reads a file of the workspace by its path, page by page (12000 characters a page). ' +
      `${BRIEF_PATH} is Taalcut's brief about the timeline (give timelineId). With compositionId and timelineId it ` +
      "reads a placed composition's entry, as the timeline holds it, even when the workspace no longer has it.",
    summary: 'Reads a workspace file, the brief, or a placed composition, a page at a time.',
    tags: ['workspace', 'file', 'read', 'brief', 'composition'],
    input: z.object({
      projectId,
      path: workspacePathSchema.optional().describe(`Default: ${BRIEF_PATH}`),
      compositionId: ulidSchema('GraphicComposition').optional(),
      timelineId: timelineId.optional(),
      page: z.int().min(1).default(1),
    }),
    output: z.object({
      path: z.string(),
      revision,
      page: z.int().min(1),
      pages: z.int().min(1),
      text: z.string().meta({ untrusted: 'workspace-file' }),
    }),
    sideEffect: 'read',
    timeoutMs: 10_000,
    retry: READ_RETRY,
    permission: LOCAL,
    describeCall: (_input, output) => `${entryLabel(output.path)} · ${output.page}/${output.pages}`,
    run: async (input) => {
      const source = await readSource(deps, input);
      if (!source.ok) return source;
      const pages = pagesOf(source.value.text, READ_PAGE_CHARS);
      if (input.page > pages.length)
        return err(
          ValidationError({ field: 'page' }, { detail: `${source.value.path} has ${pages.length} pages` }),
        );
      return ok({
        path: source.value.path,
        revision: source.value.revision,
        page: input.page,
        pages: pages.length,
        text: pages[input.page - 1] ?? '',
      });
    },
  });

  const create = workspaceTool({
    name: 'workspace.new',
    description:
      'Starts a composition: writes <name>/index.html, a blank HyperFrames sub-composition that passes the gate ' +
      '(the template, a root the size of the canvas with its id and length, no variables, one paused timeline ' +
      'with enter and exit labels, registered once). It holds no design: write the markup, style and motion.',
    summary: 'Starts a blank composition that passes the gate, for you to design.',
    tags: ['workspace', 'new', 'scaffold', 'composition', 'start'],
    input: z.object({
      projectId,
      timelineId: timelineId.optional().describe('Its canvas (default 1080×1920)'),
      name: z
        .string()
        .regex(COMPOSITION_NAME)
        .describe('Folder and composition id: lower case, digits, dashes'),
      seconds: z.number().min(0.5).max(600).default(4),
    }),
    output: written,
    command: WORKSPACE_COMMANDS.writeFiles,
    sideEffect: 'write',
    timeoutMs: 10_000,
    retry: NO_TOOL_RETRY,
    permission: LOCAL,
    idempotencyKey: keyOf('workspace.new'),
    describeCall: (_input, output) => entryLabel(output.path),
    run: async (input, ctx) => {
      const head = await headOf(deps.store, input.projectId);
      if (!head.ok) return head;
      const path = scaffoldPath(input.name);
      if (head.value.files.some((file) => file.path === path))
        return err(
          ValidationError(
            { field: 'name' },
            { detail: `${path} is there already: read it, or pick another name` },
          ),
        );
      let size = { width: 1080, height: 1920 };
      if (input.timelineId) {
        const timeline = await deps.timelines.get(input.timelineId);
        if (!timeline.ok) return timeline;
        size = { width: timeline.value.canvas.width, height: timeline.value.canvas.height };
      }
      const text = scaffoldHtml({ name: input.name, ...size, seconds: input.seconds });
      return writeTexts(deps, ctx.dispatch, input.projectId, head.value.revision, path, text);
    },
  });

  const write = workspaceTool({
    name: 'workspace.write',
    description:
      'Writes a whole file of the workspace (a new one, or over the one there), at most 64 KB. Paths are ' +
      `relative, plain names; ${BRIEF_PATH.split('/')[0]}/ is Taalcut's and read-only. Then workspace.lint it.`,
    summary: 'Writes a whole workspace file.',
    tags: ['workspace', 'write', 'file', 'composition', 'html'],
    input: z.object({ projectId, path: workspacePathSchema, text: z.string().max(64 * 1024) }),
    output: written,
    command: WORKSPACE_COMMANDS.writeFiles,
    sideEffect: 'write',
    timeoutMs: 10_000,
    retry: NO_TOOL_RETRY,
    permission: LOCAL,
    idempotencyKey: keyOf('workspace.write'),
    describeCall: (input) => entryLabel(input.path),
    run: async (input, ctx) => {
      const path = writablePath(input.path);
      if (!path.ok) return path;
      const head = await headOf(deps.store, input.projectId);
      if (!head.ok) return head;
      return writeTexts(deps, ctx.dispatch, input.projectId, head.value.revision, input.path, input.text);
    },
  });

  const patch = workspaceTool({
    name: 'workspace.patch',
    description:
      'Changes a workspace file by find and replace: each find must be in the file exactly once (or set all), ' +
      'and the edits apply in order. Cheaper than writing the whole file for a small change.',
    summary: 'Changes a workspace file by find and replace.',
    tags: ['workspace', 'patch', 'edit', 'replace', 'composition'],
    input: z.object({ projectId, path: workspacePathSchema, edits: z.array(editSchema).min(1).max(20) }),
    output: written,
    command: WORKSPACE_COMMANDS.writeFiles,
    sideEffect: 'write',
    timeoutMs: 10_000,
    retry: NO_TOOL_RETRY,
    permission: LOCAL,
    idempotencyKey: keyOf('workspace.patch'),
    describeCall: (input) => `${entryLabel(input.path)} · ${input.edits.length}`,
    run: async (input, ctx) => {
      const path = writablePath(input.path);
      if (!path.ok) return path;
      const head = await headOf(deps.store, input.projectId);
      if (!head.ok) return head;
      const file = fileAt(head.value, input.path);
      if (!file.ok) return file;
      const text = await textOf(deps.store, input.projectId, file.value);
      if (!text.ok) return text;
      const changed = patched(text.value, input.edits);
      if (!changed.ok) return changed;
      return writeTexts(deps, ctx.dispatch, input.projectId, head.value.revision, input.path, changed.value);
    },
  });

  return { list, read, create, write, patch, ...workspaceManageTools(deps) };
}

/** Stages one text and writes it over `base`. */
async function writeTexts(
  deps: WorkspaceToolDeps,
  dispatch: (payload: unknown) => AsyncResult<unknown>,
  projectId: ProjectId,
  base: number,
  path: string,
  text: string,
) {
  const staged = await stageTexts(deps.store, projectId, [{ path, text }]);
  if (!staged.ok) return staged;
  const revisionAfter = await writeStaged(dispatch, projectId, base, staged.value);
  if (!revisionAfter.ok) return revisionAfter;
  return ok({ path, revision: revisionAfter.value, bytes: staged.value[0]?.bytes ?? 0 });
}
