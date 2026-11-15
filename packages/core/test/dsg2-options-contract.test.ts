// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * DSG2's contract: the set of designs a graphic comes with, placing a set and choosing from it, the motion graphic
 * card naming its options, and a small picture read from the workspace's files. Made-up designs only.
 */
import { describe, expect, it } from 'vitest';
import {
  err,
  GRAPHIC_OPTION_COUNT,
  GRAPHIC_OPTION_IDEA_MAX,
  GRAPHIC_OPTION_STILL_BYTES,
  graphicItemSchema,
  graphicOptionsSchema,
  GRAPHICS_COMMANDS,
  graphicsCommandPayloads,
  newId,
  NotFoundError,
  ok,
  optionInUse,
  parseCard,
  RationalTime,
  WORKSPACE_IMAGE_BYTES,
  WORKSPACE_LIMITS,
  workspaceFilesOver,
  workspaceFileTextSchema,
  workspaceImageType,
  type ProjectId,
  type WorkspaceStore,
} from '../src';
import { at } from './helpers/documents';
import { COMPOSITION, sha } from './helpers/hfw1';

const projectId = newId<'Project'>();
const timelineId = newId<'Timeline'>();
const design = (index: number) => ({
  ...COMPOSITION,
  id: newId<'GraphicComposition'>(),
  hash: sha(String(index)),
});
const [A, B, C] = [design(1), design(2), design(3)];
const option = (composition: { id: string }, idea: string) => ({ compositionId: composition.id, idea });
const set = (designs: unknown[]) => ({
  set: newId<'GraphicOptionSet'>(),
  request: 'a title that says leave',
  createdAt: 1,
  designs,
});

describe('DSG2: a graphic’s designs (contract)', () => {
  it('a set is one to three designs, each composition once, each with its idea', () => {
    expect(GRAPHIC_OPTION_COUNT).toBe(3);
    const three = [option(A, 'A poster'), option(B, 'A whisper'), option(C, 'A tag')];
    expect(graphicOptionsSchema.safeParse(set(three)).success).toBe(true);
    expect(graphicOptionsSchema.safeParse(set(three.slice(0, 2))).success).toBe(true);
    // The first design placed starts the set; the others join it as they are ready.
    expect(graphicOptionsSchema.safeParse(set(three.slice(0, 1))).success).toBe(true);
    expect(graphicOptionsSchema.safeParse(set([])).success).toBe(false);
    expect(graphicOptionsSchema.safeParse(set([...three, option(design(4), 'A fourth')])).success).toBe(
      false,
    );
    expect(graphicOptionsSchema.safeParse(set([three[0], three[0], three[2]])).success).toBe(false);
    expect(graphicOptionsSchema.safeParse(set([option(A, ' '), three[1]])).success).toBe(false);
    const long = option(A, 'x'.repeat(GRAPHIC_OPTION_IDEA_MAX + 1));
    expect(graphicOptionsSchema.safeParse(set([long, three[1]])).success).toBe(false);
  });

  it('an option keeps a still by its sha256: a JPEG or a PNG of a bounded size', () => {
    const still = { sha256: sha('a'), bytes: 24_000, mimeType: 'image/jpeg' };
    const withStill = (value: unknown) =>
      set([{ ...option(A, 'A poster'), still: value }, option(B, 'A whisper')]);
    expect(graphicOptionsSchema.safeParse(withStill(still)).success).toBe(true);
    expect(graphicOptionsSchema.safeParse(withStill({ ...still, mimeType: 'image/gif' })).success).toBe(
      false,
    );
    // Kept with the workspace's files, so no larger than one of them.
    expect(GRAPHIC_OPTION_STILL_BYTES).toBe(WORKSPACE_LIMITS.fileBytes);
    expect(
      graphicOptionsSchema.safeParse(withStill({ ...still, bytes: WORKSPACE_LIMITS.fileBytes + 1 })).success,
    ).toBe(false);
    expect(graphicOptionsSchema.safeParse(withStill({ ...still, sha256: 'not-a-sha' })).success).toBe(false);
  });

  it('a graphic carries its set, and the one whose composition it is drawn with is in use', () => {
    const item = {
      type: 'graphic',
      id: newId<'TimelineItem'>(),
      anchor: { kind: 'time', at: at(30) },
      start: at(30),
      duration: at(90),
      placement: { box: { x: 0, y: 0, width: 1, height: 1 } },
      styleKey: 'composition',
      language: null,
      origin: 'agent',
      composition: { id: B.id, hash: B.hash, params: { message: 'Leave' } },
    };
    const plain = graphicItemSchema.parse(item);
    expect(plain.options).toBeUndefined();
    expect(optionInUse(plain)).toBeUndefined();
    const offered = graphicItemSchema.parse({
      ...item,
      options: set([option(A, 'A poster'), option(B, 'A whisper')]),
    });
    expect(optionInUse(offered)?.idea).toBe('A whisper');
    // Redesigned since: drawn with a composition that is none of its options.
    const moved = { ...offered, composition: { ...offered.composition, id: C.id } };
    expect(optionInUse(moved)).toBeUndefined();
  });
});

describe('DSG2: placing a set and choosing from it (contract)', () => {
  const place = graphicsCommandPayloads[GRAPHICS_COMMANDS.placeOptions];
  const choose = graphicsCommandPayloads[GRAPHICS_COMMANDS.chooseOption];
  const designs = [A, B, C].map((composition, index) => ({ composition, idea: `Idea ${index + 1}` }));
  const base = { projectId, timelineId, designs, request: 'a title', createdAt: 1 };
  const anchor = { kind: 'time', at: at(30) };
  const itemId = newId<'TimelineItem'>();

  it('names them', () => {
    expect(GRAPHICS_COMMANDS.placeOptions).toBe('graphics.placeOptions');
    expect(GRAPHICS_COMMANDS.chooseOption).toBe('graphics.chooseOption');
  });

  it('places one to three designs that passed the gate, each once', () => {
    expect(place.safeParse({ ...base, anchor, params: { message: 'Leave' } }).success).toBe(true);
    expect(place.safeParse({ ...base, anchor, designs: designs.slice(0, 1) }).success).toBe(true);
    expect(place.safeParse({ ...base, anchor, designs: [] }).success).toBe(false);
    const four = [...designs, { composition: design(4), idea: 'Idea 4' }];
    expect(place.safeParse({ ...base, anchor, designs: four }).success).toBe(false);
    expect(place.safeParse({ ...base, anchor, designs: [designs[0], designs[0]] }).success).toBe(false);
    const failed = { composition: { ...A, gate: { ...A.gate, passed: false } }, idea: 'Idea 1' };
    expect(place.safeParse({ ...base, anchor, designs: [failed, designs[1]] }).success).toBe(false);
    expect(place.safeParse({ ...base, anchor, designs: [{ ...designs[0], idea: '' }] }).success).toBe(false);
  });

  it('is a new graphic (anchor) or ones already there (itemIds), never both and never neither', () => {
    expect(place.safeParse({ ...base, itemIds: [itemId] }).success).toBe(true);
    expect(place.safeParse({ ...base, anchor, itemIds: [itemId] }).success).toBe(false);
    expect(place.safeParse(base).success).toBe(false);
    expect(place.safeParse({ ...base, itemIds: [itemId, itemId] }).success).toBe(false);
    expect(
      place.safeParse({ ...base, anchor, duration: RationalTime.of(601, { num: 1, den: 1 }) }).success,
    ).toBe(false);
    // A later design joins the set of graphics already there, never a new graphic's.
    expect(place.safeParse({ ...base, itemIds: [itemId], join: true }).success).toBe(true);
    expect(place.safeParse({ ...base, anchor, join: true }).success).toBe(false);
  });

  it('chooses one design for a graphic by its composition', () => {
    expect(choose.safeParse({ projectId, timelineId, itemId, compositionId: B.id }).success).toBe(true);
    expect(choose.safeParse({ projectId, timelineId, itemId }).success).toBe(false);
    expect(choose.safeParse({ projectId, timelineId, itemId, compositionId: 'second' }).success).toBe(false);
  });
});

describe('DSG2: the motion graphic card’s options (contract)', () => {
  const card = {
    type: 'motionGraphic',
    id: 'tool:1',
    version: 1,
    projectId,
    timelineId,
    itemId: newId<'TimelineItem'>(),
    composition: { id: A.id, name: 'Poster headline' },
    start: RationalTime.of(120, { num: 30, den: 1 }),
    duration: RationalTime.of(90, { num: 30, den: 1 }),
    unmatched: [],
  };
  const options = [A, B, C].map((composition, index) => ({
    compositionId: composition.id,
    name: `Design ${index + 1}`,
    idea: `Idea ${index + 1}`,
  }));

  it('names two or three options, and an older card has none', () => {
    const parsed = parseCard({ ...card, options });
    expect(parsed.ok && parsed.value.type === 'motionGraphic' && parsed.value.options?.length).toBe(3);
    expect(parseCard(card).ok).toBe(true);
    expect(parseCard({ ...card, options: options.slice(0, 2) }).ok).toBe(true);
    expect(parseCard({ ...card, options: options.slice(0, 1) }).ok).toBe(false);
    expect(
      parseCard({ ...card, options: [...options, { ...options[0], compositionId: design(4).id }] }).ok,
    ).toBe(false);
    expect(parseCard({ ...card, options: [{ ...options[0], name: ' ' }, options[1]] }).ok).toBe(false);
  });
});

describe('DSG2: a picture among the workspace’s files (contract)', () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0]);
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1]);
  const storeOf = (blobs: Record<string, Uint8Array>): WorkspaceStore =>
    ({
      putBlob: () => Promise.resolve(err(NotFoundError())),
      readBlob: (_project: ProjectId, sha256: string) =>
        Promise.resolve(
          blobs[sha256] ? ok(blobs[sha256]) : err(NotFoundError({ entity: 'workspaceBlob', id: sha256 })),
        ),
      head: () => Promise.resolve(ok(null)),
      revision: () => Promise.resolve(err(NotFoundError({ entity: 'workspaceRevision' }))),
    }) as unknown as WorkspaceStore;

  it('tells a JPEG and a PNG by their first bytes', () => {
    expect(workspaceImageType(jpeg)).toBe('image/jpeg');
    expect(workspaceImageType(png)).toBe('image/png');
    expect(workspaceImageType(new TextEncoder().encode('<svg onload="x"/>'))).toBeNull();
    expect(workspaceImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2]))).toBeNull();
    expect(WORKSPACE_IMAGE_BYTES).toBe(WORKSPACE_LIMITS.fileBytes);
  });

  it('reads one back as base64 beside no text, and any other file as before', async () => {
    const css = new TextEncoder().encode('.bubble { color: red }');
    const other = new Uint8Array([0, 1, 2, 3]);
    const files = workspaceFilesOver(
      storeOf({ [sha('a')]: jpeg, [sha('b')]: png, [sha('c')]: css, [sha('d')]: other }),
    );
    const picture = await files.read({ projectId, sha256: sha('a') });
    expect(picture).toEqual(
      ok({
        sha256: sha('a'),
        bytes: jpeg.byteLength,
        text: null,
        image: { mimeType: 'image/jpeg', dataBase64: '/9j/4AECAwA=' },
      }),
    );
    expect(picture.ok && workspaceFileTextSchema.safeParse(picture.value).success).toBe(true);
    const second = await files.read({ projectId, sha256: sha('b') });
    expect(second.ok && second.value.image?.mimeType).toBe('image/png');
    expect(await files.read({ projectId, sha256: sha('c') })).toEqual(
      ok({ sha256: sha('c'), bytes: css.byteLength, text: '.bubble { color: red }' }),
    );
    const binary = await files.read({ projectId, sha256: sha('d') });
    expect(binary).toEqual(ok({ sha256: sha('d'), bytes: 4, text: null }));
  });
});
