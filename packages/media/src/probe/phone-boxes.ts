// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * What phones write into a `moov` that ffprobe's tags miss (LIB1-OEM; the tag table is
 * docs/media/phone-metadata.md). Read from real files:
 * - the video track's own `keys`: Apple's `com.apple.quicktime.camera.lens_model` and the 35 mm focal length;
 * - `udta/auth`, the 3GPP author box, where Samsung's camera writes the phone's name ("Galaxy Example");
 * - `udta/smta/mdln`, Samsung's model number ("SM-X000Z");
 * - `udta/©mak` and `©mod`, QuickTime's make and model, which some Android phones write.
 */
import { childBoxes, findBox, metaKeys, plainText, quickTimeText, threeGppText, type Box } from './boxes';

export interface PhoneBoxes {
  /** The movie's `meta` keys (ffprobe has these too, as format tags). */
  readonly movieKeys: Readonly<Record<string, string>>;
  /** The first video track's `meta` keys. */
  readonly videoKeys: Readonly<Record<string, string>>;
  /** `udta/auth`: who or what wrote the file, as the 3GPP author. */
  readonly author?: string;
  /** `udta/smta` is there: Samsung's own atom. */
  readonly samsungAtom: boolean;
  /** `udta/smta/mdln`: Samsung's model number. */
  readonly samsungModel?: string;
  /** `udta/©mak` and `©mod`. */
  readonly make?: string;
  readonly model?: string;
}

function handlerOf(buf: Buffer, track: Box): string | undefined {
  const media = findBox(buf, track, 'mdia');
  const handler = media && findBox(buf, media, 'hdlr');
  if (!handler || handler.end - handler.body < 12) return undefined;
  return buf.toString('latin1', handler.body + 8, handler.body + 12);
}

function userData(buf: Buffer, udta: Box | undefined): Omit<PhoneBoxes, 'movieKeys' | 'videoKeys'> {
  if (!udta) return { samsungAtom: false };
  const boxes = childBoxes(buf, udta.body, udta.end);
  const box = (type: string) => boxes.find((b) => b.type === type);
  const auth = box('auth');
  const smta = box('smta');
  // smta is a full box: four bytes of version and flags before its children.
  const mdln = smta ? childBoxes(buf, smta.body + 4, smta.end).find((b) => b.type === 'mdln') : undefined;
  const make = box('©mak');
  const model = box('©mod');
  const author = auth ? threeGppText(buf, auth) : undefined;
  const samsungModel = mdln ? plainText(buf, mdln) : undefined;
  const makeText = make ? quickTimeText(buf, make) : undefined;
  const modelText = model ? quickTimeText(buf, model) : undefined;
  return {
    samsungAtom: smta !== undefined,
    ...(author ? { author } : {}),
    ...(samsungModel ? { samsungModel } : {}),
    ...(makeText ? { make: makeText } : {}),
    ...(modelText ? { model: modelText } : {}),
  };
}

/** Reads a `moov` box (header included). Never throws: a box it can't read is left out. */
export function phoneBoxesOf(movie: Buffer): PhoneBoxes {
  const top = childBoxes(movie).find((box) => box.type === 'moov');
  if (!top) return { movieKeys: {}, videoKeys: {}, samsungAtom: false };
  const children = childBoxes(movie, top.body, top.end);
  const meta = children.find((box) => box.type === 'meta');
  const video = children.find((box) => box.type === 'trak' && handlerOf(movie, box) === 'vide');
  const videoMeta = video && findBox(movie, video, 'meta');
  return {
    movieKeys: meta ? metaKeys(movie, meta) : {},
    videoKeys: videoMeta ? metaKeys(movie, videoMeta) : {},
    ...userData(
      movie,
      children.find((box) => box.type === 'udta'),
    ),
  };
}
