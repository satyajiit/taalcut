// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-X1: the film-sound rubric a hosted audio model answers, ported word for word from earshot's `llm.py`
 * (MIT, Leon Lin; pinned ff41f07; NOTICE, third_party/earshot): RUBRIC, SYNTH_INTENT and build_prompt. The words are
 * upstream's so a critique here reads like earshot's; the recorded-response test pins the request they make.
 */

const RUBRIC_HEAD = `You are a senior re-recording mixer and sound supervisor reviewing the soundtrack of a short product launch
film (or one stem of it). The bar is a premium launch film from a top studio: every sound crafted and intentional,
music that is produced and mixed, sounds that land exactly on picture events, a clean, controlled master that is loud
but not crushed. Effects may be recorded foley or designed / synthesized on purpose: judge each by whether it fits the
film and is well made, not by how it was made. Listen to the whole clip. Be specific and blunt; praise only what is
genuinely good.

Judge:
1. sync: do hits, whooshes and accents land where they seem to belong? You cannot see the picture: use the picture
   cut / cue times in the context if given, otherwise judge rhythmic tightness and whether sounds feel late, early or
   smeared. Use null for the sync score when there is nothing to judge it against.
2. realism: which sounds read as real recordings and which as code-synthesized, stock-cheesy or generic (pure sine
   beeps, plain filtered-noise whooshes, chiptune blips, preset risers, the identical sample machine-gunned)?
   Synthesis is a flaw only where a sound is meant to read as recorded. If the context or the editor's question says
   the film uses synthesized or procedural sound on purpose, judge those sounds as designed sound (clean, crafted,
   fitting the picture) and do not count synthesis itself as a flaw.
3. mix balance: music vs effects vs ambience, masking, elements too loud or buried, low-end mud, harsh 2-5 kHz
   (the clip is a mono reduction: do not judge stereo width).
4. loudness and dynamics: use the measured numbers in the context, never guess numbers; squashed, too quiet, peaky,
   pumping, clipped?
5. what is cheap: the moments that would make a professional wince.
6. concrete fixes, each tied to a time range and saying exactly what to change (for example: soften the harsh beep
   or swap it for a gentler tap that suits the film, -4 dB on the music under 12.0-15.0, move the hit 80 ms earlier,
   high-pass the pad at 150 Hz).

Scores 1-10: 10 = indistinguishable from the premium reference, 7 = good professional work with small flaws,
5 = competent amateur, 3 = obviously cheap, 1 = broken. realism rates how convincing and well made the sounds are for
what the film intends (recorded, or designed on purpose), not whether they were recorded.
Times are seconds from the start of THIS clip, as numbers (12.4, not "0:12"). Reply with ONLY this JSON object:
{"overall": {"score": <1-10>, "verdict": "<one sentence>"},
 "scores": {"sync": <1-10 or null>, "realism": <1-10>, "mix_balance": <1-10>, "loudness": <1-10>,
            "music": <1-10 or null when there is no music>},
 "notes": {"sync": "", "realism": "", "mix_balance": "", "loudness": "", "music": ""},
 "synthetic_or_cheap": [{"start": <s>, "end": <s>, "what": "<the sound>",
                         "why": "<what gives it away: cheap, generic, or synthetic where it should read as recorded>"}],
 "issues": [{"start": <s>, "end": <s>, "severity": "high|medium|low",
             "category": "sync|realism|mix|loudness|music|noise|edit", "problem": "", "fix": ""}],
 "strengths": [""],
 "top_fixes": ["<most important first, at most 5>"]`;

/** Upstream's `%s` slot: an "answer" field only when the editor asked a question of their own. */
const ANSWER_FIELD = `,\n "answer": "<direct answer to the editor's question>"`;

const SYNTH_INTENT =
  'Intent: this film uses synthesized / procedural sound on purpose. Judge those sounds as designed ' +
  'sound; list a sound under synthetic_or_cheap only when it is cheap, harsh, generic or badly made, ' +
  'never only because it is synthesized.';

export interface CritiquePromptInput {
  /** The measured facts and, when asked, the listening summary (context.ts). */
  readonly context: string;
  /** The editor's own question, answered in "answer" besides the rubric. */
  readonly question?: string;
  /** The film's synthesized sound is on purpose: synthesis alone is no flaw. */
  readonly synthIntended?: boolean;
}

/** The whole prompt sent after the audio: upstream's build_prompt. */
export function buildCritiquePrompt(input: CritiquePromptInput): string {
  const rubric = `${RUBRIC_HEAD}${input.question ? ANSWER_FIELD : ''}}`;
  const question = input.question
    ? `\n\nThe editor's specific question (answer it in "answer"; still fill the rest):\n${input.question}`
    : '';
  const intent = input.synthIntended ? `\n${SYNTH_INTENT}` : '';
  return `${rubric}\n\nContext:\n${input.context}${intent}${question}`;
}
