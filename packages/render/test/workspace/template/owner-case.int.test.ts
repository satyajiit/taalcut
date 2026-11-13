// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * HFW1 tpl, the owner's case made up end to end: a reel with a one-line incoming message and a one-line reply with
 * read ticks; its template's graphics designed (by the stand-in Designer's hand-written fixtures); a make with words
 * 25–40 % longer. Drawn by the real render (workspace stills, offline), the made bubbles stay one line, sit where
 * the reel's sat, and pop in as the reel's did. `TAALCUT_TPL_STILLS=<dir>` writes the stills there.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { newId, ok, workspaceBlobPath, type GraphicItem, type WorkspaceFrame } from '@taalcut/core';
import { designedGraphic } from '@taalcut/timeline';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { neutralPng } from '../../../src/workspace/frames/still';
import { workspaceFramesOn } from '../../../src/workspace/frames/frames';
import { designTemplateCompositions } from '../../../src/workspace/template/design-template';
import { reelMomentsOf } from '../../../src/workspace/template/reel-frames';
import { testEngine } from '../../support/engine';
import { findTestMedia, mediaContext, tempDir } from '../../support/media';
import { findTestShell } from '../../support/shell';
import { madeUpReel, QUESTION_WORDS, REPLY_WORDS } from './reel-fixture';
import { FIXTURES, standInDesigner } from './stand-in';

const media = await findTestMedia('the owner’s case');
const shell = findTestShell('the owner’s case');
const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const STILLS = process.env.TAALCUT_TPL_STILLS;

// Made-up new words: 36 % and 29 % longer than the reel's.
const NEW_QUESTION = 'Made-up question for you here?';
const NEW_REPLY = 'Sounds very good to me';
/** The first frame (nothing shows yet), the next (part-way into the 0.12 s pop), and settled. */
const MOMENTS = [0, 1 / 30, 1];
const SETTLED = 2;

describe.skipIf(!media.binaries || !shell.path)(
  'the owner’s case, made up (HFW1 tpl)',
  { timeout: 600_000 },
  () => {
    let work: Awaited<ReturnType<typeof tempDir>>;
    const project = newId<'Project'>();

    beforeAll(async () => {
      work = await tempDir('taalcut-owner-case-');
      // The Designer's files, in the project's workspace (where a make puts the template's).
      for (const name of ['incoming-bubble.html', 'reply-bubble.html']) {
        const html = await readFile(join(FIXTURES, name), 'utf8');
        const blob = join(work.dir, workspaceBlobPath(project, sha(html)));
        await mkdir(join(blob, '..'), { recursive: true });
        await writeFile(blob, html);
      }
    });
    afterAll(async () => {
      await work?.dispose();
    });

    it('keeps the bubbles one line, where the reel’s sat, popping in as the reel’s did, with longer words', async () => {
      expect(NEW_QUESTION.length / QUESTION_WORDS.length).toBeGreaterThanOrEqual(1.25);
      expect(NEW_REPLY.length / REPLY_WORDS.length).toBeLessThanOrEqual(1.4);
      const { template, question, reply } = madeUpReel();
      const designed = await designTemplateCompositions(template, {
        projectId: project,
        design: standInDesigner(),
        reelFrames: async (brief) =>
          reelMomentsOf(brief).map((moment) => ({
            ...moment,
            picture: { data: '', mimeType: 'image/jpeg' as const },
          })),
        keep: async () => ok(undefined),
      });
      const withGraphics = { ...template, graphics: { ...template.graphics!, ...designed.graphics } };
      const madeItems = (texts: Record<string, string>) =>
        [question, reply].map((overlay) => {
          const text = texts[overlay.id];
          const item = designedGraphic(
            overlay,
            { text: text ?? overlay.text, rewritten: text !== undefined, template: withGraphics },
            newId<'TimelineItem'>(),
          );
          if (!item) throw new Error('not drawn');
          return item;
        });
      const reelItems = madeItems({});
      const made = madeItems({ [question.id]: NEW_QUESTION, [reply.id]: NEW_REPLY });
      expect(made.map((item) => item.composition?.params)).toEqual([
        { text: NEW_QUESTION },
        { text: NEW_REPLY },
      ]);

      // A made-up shot behind them.
      const footage = neutralPng([0x2a, 0x4d, 0x5a]).toString('base64');
      const engine = testEngine(work.dir, mediaContext(media.binaries!), shell.path!, {
        workspaceRoot: work.dir,
      });
      const draw = async (item: GraphicItem, seconds: number[] = MOMENTS) => {
        const composition = designed.graphics.compositions!.find((copy) => copy.id === item.composition!.id)!;
        const drawn = await workspaceFramesOn(engine.deps, {
          projectId: project,
          entry: composition.entry,
          files: composition.files,
          params: item.composition!.params,
          seconds,
          over: { kind: 'image', mimeType: 'image/png', dataBase64: footage },
          maxDimension: 960,
        });
        if (!drawn.ok) throw new Error(`${drawn.error.code}: ${drawn.error.detail ?? ''}`);
        return drawn.value;
      };
      const px = (frame: WorkspaceFrame | undefined) => {
        const box = frame?.box;
        if (!box) throw new Error('nothing drawn');
        return {
          left: box.x * 1080,
          top: box.y * 1920,
          right: (box.x + box.width) * 1080,
          height: box.height * 1920,
          width: box.width * 1080,
        };
      };
      const names = ['question', 'reply'] as const;
      for (const [index, name] of names.entries()) {
        const before = await draw(reelItems[index]!);
        const after = await draw(made[index]!);
        const reelSettled = px(before.frames[SETTLED]);
        const madeSettled = px(after.frames[SETTLED]);
        // One line: the bubble is as tall as the reel's with its words, and wider for the longer words.
        expect(Math.abs(madeSettled.height - reelSettled.height), name).toBeLessThanOrEqual(2);
        expect(madeSettled.width, name).toBeGreaterThan(reelSettled.width);
        // Where the reel's sat: the same top, and the side it hangs from kept (left for theirs, right for mine).
        expect(Math.abs(madeSettled.top - reelSettled.top), name).toBeLessThanOrEqual(2);
        if (name === 'question') expect(Math.abs(madeSettled.left - 65), name).toBeLessThanOrEqual(8);
        else expect(Math.abs(1080 - madeSettled.right - 65), name).toBeLessThanOrEqual(8);
        // Pops in as the reel's did: nothing on the first frame, part-way grown on the next, by the same share in both.
        for (const drawn of [before, after]) expect(drawn.frames[0]?.box ?? null, name).toBeNull();
        const grown = [before, after].map(
          (drawn) => px(drawn.frames[1]).width / px(drawn.frames[SETTLED]).width,
        );
        for (const share of grown) expect(share, name).toBeLessThan(0.97);
        expect(Math.abs(grown[0]! - grown[1]!), name).toBeLessThanOrEqual(0.02);
        // Settled, the new words pass the render's checks (mid-pop, a scale-in is meant to be under the type floor).
        const settled = await draw(made[index]!, [MOMENTS[SETTLED]!]);
        for (const check of settled.checks.filter((entry) =>
          ['bounds', 'typeFloor', 'contrast'].includes(entry.id),
        ))
          expect(check.status, `${name} ${check.id}: ${check.detail ?? ''}`).not.toBe('fail');
        if (STILLS) {
          await mkdir(STILLS, { recursive: true });
          const save = (label: string, frame: WorkspaceFrame | undefined) =>
            frame
              ? writeFile(join(STILLS, `${name}-${label}.jpg`), Buffer.from(frame.dataBase64, 'base64'))
              : undefined;
          await save('reel-words-settled', before.frames[SETTLED]);
          await save('new-words-settled', after.frames[SETTLED]);
          await save('reel-words-entering', before.frames[1]);
          await save('new-words-entering', after.frames[1]);
        }
      }
    });
  },
);
