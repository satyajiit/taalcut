// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * AGT2 eyes: whether the person's frames go to the run's model as pictures. The rule is HFW1-DSN's for the make's
 * frame checks (apps/desktop agent-designer.ts, `designerSeesPictures`), read again for every call: on this Mac
 * (Local only, or no cloud model in the agent's chain), always; to a cloud model, only under the person's standing
 * upload consent for the agent's module covering every cloud provider its chain may call now. Nobody is asked
 * mid-make: without that consent the tool's words say what it found and the frames stay on this Mac. A reel's own
 * frames are a reference's and always go (FIX-CONSENT). The tools stay reads with no network: the pictures are
 * what the agent attaches to their message (ToolSpec `images`), and only to a model that sees images.
 */
import { z } from 'zod';

export interface FootageVerdict {
  /** The person's frames may go to the run's model as pictures. */
  readonly shown: boolean;
  /** Why, in words for the model: "on this Mac", "the person's standing upload consent", "no standing consent". */
  readonly why: string;
}

/** Read for each call, so a consent taken back counts from the next one. */
export type FootagePictures = (signal?: AbortSignal) => Promise<FootageVerdict>;

/** Unwired: nothing of the person's goes. */
export const FOOTAGE_KEPT: FootageVerdict = {
  shown: false,
  why: 'Pictures of the person’s video are not sent here; the words say what is in them.',
};

export const footagePicturesSchema = z.object({
  /** shown: the person's frames are attached as pictures; kept: they stay on this Mac (read the words). */
  footage: z.enum(['shown', 'kept']),
  why: z.string(),
});
export type FootagePicturesOut = z.output<typeof footagePicturesSchema>;

/** The verdict for this call, as the tool's output says it; a rule that throws keeps the frames. */
export async function footageVerdict(
  rule: FootagePictures | undefined,
  signal?: AbortSignal,
): Promise<FootagePicturesOut> {
  const verdict = rule ? await rule(signal).catch(() => FOOTAGE_KEPT) : FOOTAGE_KEPT;
  return { footage: verdict.shown ? 'shown' : 'kept', why: verdict.why };
}
