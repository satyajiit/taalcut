// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * `workspace.docs` (HFW1 "dsn"): HyperFrames' own agent skill, pinned (docs/docs.lock.json: heygen-com/hyperframes
 * v0.8.209, Apache-2.0, in NOTICE) and bundled as reference the Designer reads a page at a time, never pasted
 * whole into a prompt. With no topic it lists the topics; a topic is one of the skill's files. The docs are written
 * for HyperFrames' CLI and Studio: the note on every page says what stands in for them here.
 */
import { err, ok, ValidationError } from '@taalcut/core';
import { z } from 'zod';
import bundle from '../docs/docs.bundle.json';
import { EDITING_GUIDES } from './editing-guides';
import { resolveTaalcutDocTopic, TAALCUT_DOCS } from './taalcut-docs';
import { LOCAL, workspaceTool } from './tool-parts';

/** Characters in one page of a topic. */
export const DOCS_PAGE_CHARS = 6_500;
const MAX_DOCS_PAGE_JSON_BYTES = 6_600;

const SKILL_ROOT = 'skills/hyperframes/';

/** A topic's id from its file: SKILL.md is `hyperframes`, references/types/vertical.md is `types/vertical`. */
export const topicOf = (path: string) =>
  path === `${SKILL_ROOT}SKILL.md`
    ? 'hyperframes'
    : path.replace(`${SKILL_ROOT}references/`, '').replace(/\.md$/, '');

export const DOCS_TOPICS: readonly { readonly topic: string; readonly text: string }[] = [
  ...bundle.files.map((file) => ({ topic: topicOf(file.path), text: file.text })),
  ...TAALCUT_DOCS,
  ...EDITING_GUIDES,
];

/** What stands in here for what the docs assume (their CLI, Studio, a project's root and registry). */
export const DOCS_NOTE =
  'HyperFrames docs, pinned (Apache-2.0), plus built-in Taalcut topics (taalcut/sandbox-workspace, taalcut/three-3d, ' +
  'taalcut/choreography, taalcut/impeccable-craft, taalcut/hallmark-thumbnails, taalcut/tone-audio). In Taalcut you ' +
  'manage workspace files directly with ' +
  'workspace.list, workspace.read, workspace.new, workspace.write, workspace.patch, workspace.delete, ' +
  'workspace.move and workspace.search; where HyperFrames says `npx hyperframes check`, use workspace.lint; ' +
  'for snapshots, workspace.render or workspace.renderOver. Taalcut gates every overlay file: one paused timeline, ' +
  'tweens only, the bundled fonts, assets/<sha256>. To build a full video or standalone motion scene in the sandbox ' +
  'shell, call workspace.open, run `hyperframes`, `node`, `python3`, `chrome-headless-shell --no-sandbox` or ' +
  '`ffmpeg -c:v h264_videotoolbox` on macOS (`-require_sw 1` only as an explicit CPU fallback) via workspace.exec (which automatically checks out and syncs `work/` with the workspace ' +
  'head), inspect `work/`, `inputs/`, and `out/` with workspace.files, and import rendered `out/` MP4/WAV/PNG media ' +
  'into the library with workspace.importMedia for timeline.insertClip or timeline.swapClip.';

/** The topic's first heading or sentence, for the index. */
function headline(text: string): string {
  const description = /^description:\s*(.+)$/m.exec(text)?.[1];
  const heading = /^#\s+(.+)$/m.exec(text)?.[1];
  return (description ?? heading ?? '').slice(0, 160);
}

const jsonBytes = (value: string) => Buffer.byteLength(JSON.stringify(value), 'utf8');

function pagesOf(text: string, pageChars = DOCS_PAGE_CHARS): string[] {
  const pages: string[] = [];
  let rest = text;
  while (rest.length > pageChars || jsonBytes(rest) > MAX_DOCS_PAGE_JSON_BYTES) {
    let cap = Math.min(rest.length, pageChars);
    while (cap > 256 && jsonBytes(rest.slice(0, cap)) > MAX_DOCS_PAGE_JSON_BYTES) {
      cap = Math.floor(cap * 0.9);
    }
    // Cut at a heading or a blank line near the end of the page, so a section stays whole where it can.
    const window = rest.slice(0, cap);
    const cut = Math.max(window.lastIndexOf('\n## '), window.lastIndexOf('\n\n'));
    const at = cut > cap / 2 ? cut + 1 : cap;
    pages.push(rest.slice(0, at));
    rest = rest.slice(at);
  }
  pages.push(rest);
  return pages;
}

/** Short recipe pages leave room for the selected editing schema on local models. */
const guidePageChars = (topic: string) =>
  EDITING_GUIDES.some((guide) => guide.topic === topic) ? 1_600 : undefined;

export function workspaceDocsTool() {
  return workspaceTool({
    name: 'workspace.docs',
    description:
      'Reads bundled Taalcut editing guides and pinned HyperFrames docs: with no topic, the list of topics; with a topic, ' +
      'that page of it. Start with hyperframes (the contract), then format, motion, overlays, captions, look or ' +
      'types/vertical as the job needs.',
    summary: 'Reads Taalcut editing guides and HyperFrames composition docs.',
    tags: ['workspace', 'editing', 'guides', 'docs', 'hyperframes', 'reference', 'gsap', 'motion', 'help'],
    input: z.object({
      topic: z.string().max(40).optional(),
      page: z.int().min(1).default(1),
    }),
    output: z.object({
      note: z.string(),
      topics: z.array(z.object({ topic: z.string(), about: z.string(), pages: z.int().min(1) })).optional(),
      topic: z.string().optional(),
      page: z.int().min(1).optional(),
      pages: z.int().min(1).optional(),
      text: z.string().meta({ untrusted: 'hyperframes-docs' }).optional(),
    }),
    sideEffect: 'read',
    cache: true,
    timeoutMs: 5_000,
    retry: { maxAttempts: 1, initialDelayMs: 0 },
    permission: LOCAL,
    describeCall: (input, output) =>
      output.topic ? `${output.topic} · ${output.page}/${output.pages}` : input.topic,
    run: async (input) => {
      if (!input.topic)
        return ok({
          note: DOCS_NOTE,
          topics: DOCS_TOPICS.map((entry) => ({
            topic: entry.topic,
            about: headline(entry.text),
            pages: pagesOf(entry.text, guidePageChars(entry.topic)).length,
          })),
        });
      const targetTopic = resolveTaalcutDocTopic(input.topic);
      const found = DOCS_TOPICS.find((entry) => entry.topic === targetTopic);
      if (!found)
        return err(
          ValidationError(
            { field: 'topic' },
            {
              detail: `No topic ${input.topic}: one of ${DOCS_TOPICS.map((entry) => entry.topic).join(', ')}`,
            },
          ),
        );
      const pages = pagesOf(found.text, guidePageChars(found.topic));
      if (input.page > pages.length)
        return err(
          ValidationError({ field: 'page' }, { detail: `${input.topic} has ${pages.length} pages` }),
        );
      return ok({
        note: guidePageChars(found.topic)
          ? 'Built-in Taalcut editing guide. Read relevant pages before acting; user choices and tool permissions still apply.'
          : DOCS_NOTE,
        topic: found.topic,
        page: input.page,
        pages: pages.length,
        text: pages[input.page - 1] ?? '',
      });
    },
  });
}
