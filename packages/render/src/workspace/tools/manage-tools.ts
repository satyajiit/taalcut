// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * First-class workspace file management and search tools: `workspace.delete` (delete one or more workspace files in an
 * undoable revision), `workspace.move` (rename, move, or copy a workspace file atomically), and `workspace.search`
 * (substring or regular-expression search across workspace UTF-8 files and `_taalcut/brief.md`).
 */
import {
  err,
  NO_TOOL_RETRY,
  ok,
  ulidSchema,
  ValidationError,
  WORKSPACE_COMMANDS,
  WORKSPACE_LIMITS,
  workspacePathSchema,
  type AsyncResult,
} from '@taalcut/core';
import { z } from 'zod';
import { brief } from './brief';
import type { WorkspaceToolDeps } from './deps';
import { keyOf, LOCAL, READ_RETRY, workspaceTool } from './tool-parts';
import { BRIEF_PATH, fileAt, headOf, textOf, writablePath } from './workspace-io';

const projectId = ulidSchema('Project');
const timelineId = ulidSchema('Timeline');
const revision = z.int().min(0).describe('The workspace revision after the call');

const DEFAULT_MAX_MATCHES = 50;

function extractRevision(value: unknown) {
  const rev = (value as { revision?: unknown } | null)?.revision;
  return typeof rev === 'number'
    ? ok(rev)
    : err(ValidationError({ field: 'revision' }, { detail: 'workspace.writeFiles answered no revision' }));
}

function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function compileQuery(query: string, isRegex: boolean, caseSensitive: boolean) {
  if (isRegex && /(\+|\*|\{[0-9,]+\})\s*\)[+*?{]/.test(query)) {
    return err(
      ValidationError(
        { field: 'query' },
        { detail: 'Regular expression contains nested quantifiers; simplify the pattern' },
      ),
    );
  }
  const flags = caseSensitive ? 'g' : 'gi';
  try {
    return ok(new RegExp(isRegex ? query : escapeRegExp(query), flags));
  } catch (cause) {
    return err(
      ValidationError(
        { field: 'query' },
        { detail: `Invalid regular expression: ${cause instanceof Error ? cause.message : String(cause)}` },
      ),
    );
  }
}

export function workspaceManageTools(deps: WorkspaceToolDeps) {
  const del = workspaceTool({
    name: 'workspace.delete',
    description:
      'Deletes one or more files from the workspace at the head revision as an undoable revision, and reports ' +
      'which paths were deleted and which were missing.',
    summary: 'Deletes one or more files from the workspace.',
    tags: ['workspace', 'delete', 'file', 'remove'],
    input: z.object({
      projectId,
      paths: z.array(workspacePathSchema).min(1).max(WORKSPACE_LIMITS.files),
    }),
    output: z.object({
      revision,
      deleted: z.array(z.string()),
      missing: z.array(z.string()),
    }),
    command: WORKSPACE_COMMANDS.writeFiles,
    sideEffect: 'write',
    timeoutMs: 10_000,
    retry: NO_TOOL_RETRY,
    permission: LOCAL,
    idempotencyKey: keyOf('workspace.delete'),
    describeCall: (_input, output) => `${output.deleted.length} deleted · revision ${output.revision}`,
    run: async (input, ctx) => {
      const uniquePaths = [...new Set(input.paths)];
      for (const path of uniquePaths) {
        const checked = writablePath(path);
        if (!checked.ok) return checked;
      }
      const head = await headOf(deps.store, input.projectId);
      if (!head.ok) return head;
      const present = new Set(head.value.files.map((file) => file.path));
      const existing = uniquePaths.filter((path) => present.has(path));
      const missing = uniquePaths.filter((path) => !present.has(path));
      if (existing.length === 0) {
        return ok({ revision: head.value.revision, deleted: [], missing });
      }
      const done = await ctx.dispatch({
        projectId: input.projectId,
        baseRevision: head.value.revision,
        files: existing.map((path) => ({ path, delete: true as const })),
      });
      if (!done.ok) return done;
      const next = extractRevision(done.value);
      if (!next.ok) return next;
      return ok({ revision: next.value, deleted: existing, missing });
    },
  });

  const move = workspaceTool({
    name: 'workspace.move',
    description:
      'Moves, renames, or copies (with copy: true) a file in the workspace as a single atomic revision. Refuses ' +
      'to overwrite an existing target when overwrite is false.',
    summary: 'Moves, renames, or copies a workspace file.',
    tags: ['workspace', 'move', 'rename', 'copy', 'file'],
    input: z.object({
      projectId,
      from: workspacePathSchema,
      to: workspacePathSchema,
      copy: z.boolean().optional(),
      overwrite: z.boolean().optional(),
    }),
    output: z.object({
      revision,
      from: z.string(),
      to: z.string(),
      copied: z.boolean(),
      bytes: z.int().nonnegative(),
    }),
    command: WORKSPACE_COMMANDS.writeFiles,
    sideEffect: 'write',
    timeoutMs: 10_000,
    retry: NO_TOOL_RETRY,
    permission: LOCAL,
    idempotencyKey: keyOf('workspace.move'),
    describeCall: (input) => `${input.from} → ${input.to}`,
    run: async (input, ctx) => {
      const toChecked = writablePath(input.to);
      if (!toChecked.ok) return toChecked;
      if (!input.copy) {
        const fromChecked = writablePath(input.from);
        if (!fromChecked.ok) return fromChecked;
      }
      const head = await headOf(deps.store, input.projectId);
      if (!head.ok) return head;
      const source = fileAt(head.value, input.from);
      if (!source.ok) return source;
      const bytes = deps.store.readFile
        ? await deps.store.readFile(input.projectId, input.from)
        : await deps.store.readBlob(input.projectId, source.value.sha256);
      if (!bytes.ok) return bytes;
      if (input.from === input.to) {
        return ok({
          revision: head.value.revision,
          from: input.from,
          to: input.to,
          copied: Boolean(input.copy),
          bytes: bytes.value.byteLength,
        });
      }
      if (input.overwrite === false && head.value.files.some((file) => file.path === input.to)) {
        return err(
          ValidationError(
            { field: 'to' },
            { detail: `${input.to} is there already: set overwrite: true or pick another path` },
          ),
        );
      }
      const put = await deps.store.putBlob(input.projectId, bytes.value);
      if (!put.ok) return put;
      const files = [
        { path: input.to, sha256: put.value.sha256 },
        ...(input.copy ? [] : [{ path: input.from, delete: true as const }]),
      ];
      const done = await ctx.dispatch({
        projectId: input.projectId,
        baseRevision: head.value.revision,
        files,
      });
      if (!done.ok) return done;
      const next = extractRevision(done.value);
      if (!next.ok) return next;
      return ok({
        revision: next.value,
        from: input.from,
        to: input.to,
        copied: Boolean(input.copy),
        bytes: put.value.bytes,
      });
    },
  });

  const search = workspaceTool({
    name: 'workspace.search',
    description:
      `Searches across all UTF-8 files in the workspace (and ${BRIEF_PATH} when present or given timelineId) ` +
      'for a substring or regular expression, optionally filtered by pathPrefix.',
    summary: 'Searches workspace text files and the brief by substring or regular expression.',
    tags: ['workspace', 'search', 'grep', 'find', 'source'],
    input: z.object({
      projectId,
      query: z.string().min(1).max(500),
      pathPrefix: z.string().max(240).optional(),
      caseSensitive: z.boolean().optional(),
      regex: z.boolean().optional(),
      maxMatches: z.int().min(1).max(200).optional(),
      timelineId: timelineId.optional(),
    }),
    output: z.object({
      revision,
      totalMatches: z.int().nonnegative(),
      truncated: z.boolean(),
      matches: z.array(
        z.object({
          path: z.string(),
          line: z.int().min(1),
          column: z.int().min(1),
          text: z.string().meta({ untrusted: 'workspace-file' }),
        }),
      ),
    }),
    sideEffect: 'read',
    timeoutMs: 10_000,
    retry: READ_RETRY,
    permission: LOCAL,
    describeCall: (input, output) => `${input.query} · ${output.totalMatches} matches`,
    run: async (input) => {
      const pattern = compileQuery(input.query, Boolean(input.regex), input.caseSensitive ?? false);
      if (!pattern.ok) return pattern;
      let fallbackBrief: string | undefined;
      if (input.timelineId) {
        const generated: Awaited<AsyncResult<string>> = await brief(deps, input.timelineId);
        if (!generated.ok) return generated;
        fallbackBrief = generated.value;
        await deps.store.writeReserved?.(
          input.projectId,
          BRIEF_PATH,
          new TextEncoder().encode(generated.value),
        );
      }
      const head = await headOf(deps.store, input.projectId);
      if (!head.ok) return head;
      const prefix = input.pathPrefix ?? '';
      const sources = new Map<string, string>();
      for (const file of [...head.value.files].sort((a, b) => a.path.localeCompare(b.path))) {
        if (prefix && !file.path.startsWith(prefix)) continue;
        if (!prefix.startsWith('assets') && file.path.startsWith('assets/')) continue;
        const text = await textOf(deps.store, input.projectId, file);
        if (text.ok) sources.set(file.path, text.value);
      }
      if (fallbackBrief !== undefined && !sources.has(BRIEF_PATH) && (!prefix || BRIEF_PATH.startsWith(prefix))) {
        sources.set(BRIEF_PATH, fallbackBrief);
      }
      const limit = input.maxMatches ?? DEFAULT_MAX_MATCHES;
      const countCap = Math.max(limit * 10, 500);
      const matches: { path: string; line: number; column: number; text: string }[] = [];
      let totalMatches = 0;
      outer: for (const [path, content] of [...sources.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
        const lines = content.split(/\r?\n/);
        for (const [lineIdx, rawLine] of lines.entries()) {
          const lineText = rawLine.length > 16_384 ? rawLine.slice(0, 16_384) : rawLine;
          pattern.value.lastIndex = 0;
          let match: RegExpExecArray | null;
          while ((match = pattern.value.exec(lineText)) !== null) {
            totalMatches += 1;
            if (matches.length < limit) {
              matches.push({
                path,
                line: lineIdx + 1,
                column: match.index + 1,
                text: lineText.slice(0, 500),
              });
            }
            if (totalMatches >= countCap) break outer;
            if (match[0].length === 0) pattern.value.lastIndex += 1;
          }
        }
      }
      return ok({
        revision: head.value.revision,
        totalMatches,
        truncated: totalMatches > limit,
        matches,
      });
    },
  });

  return { delete: del, move, search };
}
