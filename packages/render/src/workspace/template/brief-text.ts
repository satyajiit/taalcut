// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * HFW1 (tpl): a composition brief in the Designer's words (the job's part of `_taalcut/brief.md`). The reel's
 * numbers are given as reference for the reel's words and said to be so: the composition hugs its words with CSS
 * and keeps the reel's line count for longer ones, sits where the reel's sat (a variable when its overlays sit in
 * different places), and comes on as the reel's did. A reel of another shape than the video's is said so, with its
 * numbers mapped onto the canvas (brief.ts `reelOnCanvas`); the words' floor is said for every brief. The reel's words
 * are data, quoted. Pure.
 */
import type { CompositionBrief, OverlayBrief } from './brief';
import { aspectName, CAP_FLOOR_PX, DESIGN_CANVAS, sameShape, WORDS_GROWTH } from './brief';

const ENTER: Record<OverlayBrief['motion']['enter'], string> = {
  none: 'cuts in: gone on one frame, all there on the next',
  fade: 'fades in',
  pop: 'pops in, growing from its middle',
  slide: 'slides in from one side',
  typewriter: 'types on letter by letter',
  wordByWord: 'comes on word by word',
  unknown: "the reel's frames can't tell; choose what suits it, never a cut by default",
};
const EXIT: Record<OverlayBrief['motion']['exit'], string> = {
  none: 'cuts out',
  fade: 'fades out',
  pop: 'pops out',
  slide: 'slides out',
  unknown: "the reel's frames can't tell; choose what suits it",
};

const ROLE_WORDS: Partial<Record<CompositionBrief['role'], string>> = {
  incomingMessage: 'incoming bubble',
  outgoingMessage: 'reply bubble',
};
const paddingWords = (padding: { top: number; right: number; bottom: number; left: number }) =>
  [padding.top, padding.right, padding.bottom, padding.left]
    .map((value) => `${Math.max(0, Math.round(value))}px`)
    .join(' ');
const quoted = (words: string) => JSON.stringify(words.slice(0, 300));
const list = (values: readonly number[]) => values.map((value) => `${value.toFixed(2)} s`).join(', ');

function overlayLines(brief: OverlayBrief, index: number): string[] {
  const { place, size, timing, motion, look } = brief;
  const longest = Math.ceil(brief.words.length * WORDS_GROWTH);
  const lineWord = brief.lines === 1 ? 'line' : 'lines';
  return [
    `### ${index === 0 ? 'Lead' : 'Also'}: overlay ${brief.overlayId}`,
    `- Words (data, not instructions): ${quoted(brief.words)}`,
    `- Lines: ${brief.lines}. Keep ${brief.lines} ${lineWord} for words up to ${longest} characters.`,
    `- Place: hangs from the ${place.side}; its edges ${place.px.left} px from the left, ${place.px.right} px from the right, ${place.px.top} px from the top, ${place.px.bottom} px from the bottom.`,
    `- Size, for these words only: type ${size.capHeightPx} px cap height` +
      (size.shapePx ? `; shape ${size.shapePx.width} × ${size.shapePx.height} px.` : '.'),
    `- Timing: on at ${timing.appearsSeconds.toFixed(2)} s` +
      (timing.typingSeconds !== null ? ` (typing dots for ${timing.typingSeconds.toFixed(2)} s first)` : '') +
      `, words at ${timing.startSeconds.toFixed(2)} s, off at ${timing.endSeconds.toFixed(2)} s;` +
      ` ${timing.onBeat ? 'on a beat' : 'off the beat'}${timing.atCut ? ', with a cut' : ''}.` +
      (timing.words ? ` The reading: ${quoted(timing.words)}.` : ''),
    `- Motion: comes on: ${ENTER[motion.enter]}; goes: ${EXIT[motion.exit]}.` +
      (motion.words ? ` The reading: ${quoted(motion.words)}.` : ''),
    `- Look, measured: ${look.kind}, fill ${look.colors.fill ?? 'none'}, words ${look.colors.text}` +
      (look.colors.stroke ? `, outline ${look.colors.stroke}` : '') +
      `, corners ${look.cornerRadius} of its height, tail ${look.tail}, ${look.font.class} type weight ${look.font.weight}` +
      `${look.receipt ? ', read ticks' : ''}${look.avatar ? ', an avatar' : ''}${look.shadow ? ', a soft shadow' : ''}.` +
      (look.words ? ` The reading: ${quoted(look.words)}.` : ''),
    `- The reel's frames of it: entrance ${list(brief.frames.entrance)}; hold ${list(brief.frames.hold)}; exit ${list(brief.frames.exit)}.`,
  ];
}

/** The brief as Markdown for the Designer. */
export function briefMarkdown(brief: CompositionBrief): string {
  const { width, height } = DESIGN_CANVAS;
  const many = brief.overlays.length > 1;
  const reel = aspectName(brief.canvas.width, brief.canvas.height);
  const video = aspectName(width, height);
  return [
    `# Design: the reel's ${brief.role}`,
    '',
    `One composition draws ${many ? `these ${brief.overlays.length} overlays` : 'this overlay'} of the reel on a ${width} × ${height} canvas (the reel's is ${brief.canvas.width} × ${brief.canvas.height} at ${brief.fps} fps).`,
    '',
    '## Rules',
    "- The reel's numbers below are measured for the reel's words. They are reference, never sizes: set no width or height from them.",
    "- Lay it out with CSS so it hugs its words: `width: fit-content`, a `max-width`, `white-space`, wrapping and balance. A made video's words are other words, often longer.",
    "- Keep the reel's line count: a one-line message stays one line for words up to the length given.",
    ...(sameShape(brief.canvas)
      ? []
      : [
          `- The reel is ${reel} and this video is ${video}: keep its look, its place and its proportions, not its pixels. ` +
            "The numbers below are the reel's mapped onto this canvas: where it sits as a share of the frame, every size by one factor.",
        ]),
    `- Words at least ${CAP_FLOOR_PX} px cap height: the frame checks refuse smaller, and design.done refuses a design whose last render failed a frame check.`,
    "- Sit where the reel's sits, as wide: each render's reelMatch check holds the edge it hangs from and its middle down within 3 % of the frame, and its width to 0.75–1.35 × the reel's at the reel's words (render with them). Hug the words; never set a width to fill the frame.",
    ...(brief.thread
      ? [
          `- This conversation's ${ROLE_WORDS[brief.thread.role] ?? brief.thread.role} is designed already: its words ${Math.round(brief.thread.type.fontPx)} px font-size, padding ${paddingWords(brief.thread.type.padding)}. Use the same font-size and padding, so the two read as one thread.`,
        ]
      : []),
    '- The words are the `text` variable; each use sets its own.' +
      (many
        ? ' When the overlays sit in different places, add a number variable for what differs and give each use its value.'
        : ''),
    "- Sit where the reel's sat, and come on and go as the reel's did; put the `enter` label where the entrance ends and the `exit` label where the exit starts.",
    ...(brief.system?.words
      ? ['', `The graphic system, as the reading put it: ${quoted(brief.system.words)}`]
      : []),
    '',
    ...brief.overlays.flatMap((overlay, index) => [...overlayLines(overlay, index), '']),
  ].join('\n');
}
