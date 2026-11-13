// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Stand-in models for the tone session: no key, no network, no cost. Authors answer every frozen prompt in
 * its language, following its dials the way SOUL.md asks; the judge scores every reply 5 and calls every pair
 * a tie. A recording made with them proves the machinery and nothing else, so it is marked `standIn` and its
 * report says "unmeasured".
 */
import { createScriptedModelClient, runMessage, type ScriptedReply, type TonePrompt } from '@taalcut/agent';
import type { ModelRequest } from '@taalcut/models';

export const STAND_IN_AUTHORS = [
  { provider: 'stand-in-a', model: 'scripted' },
  { provider: 'stand-in-b', model: 'scripted' },
  { provider: 'stand-in-c', model: 'scripted' },
] as const;
export const STAND_IN_JUDGE = { provider: 'stand-in-judge', model: 'scripted' } as const;

interface Lines {
  readonly did: string;
  readonly why: string;
  readonly rest: string;
  readonly tip: string;
  readonly joke: string;
}

const LINES: Readonly<Record<TonePrompt['language'], Lines>> = {
  en: {
    did: 'I made the change you asked for',
    why: 'It keeps the cut on the beat and the hook in the first second and a half',
    rest: 'The rest of the video stays as it was',
    tip: 'Tip: you can undo any of it with Command Z',
    joke: 'That shot just earned its place',
  },
  hi: {
    did: 'मैंने आपका बदलाव कर दिया है',
    why: 'इससे कट बीट पर रहता है और हुक पहले डेढ़ सेकंड में आता है',
    rest: 'बाकी वीडियो पहले जैसा है',
    tip: 'टिप: आप इसे कमांड ज़ेड से वापस कर सकते हैं',
    joke: 'अब यह शॉट पूरी महफ़िल लूट लेगा',
  },
  es: {
    did: 'Hice el cambio que pediste',
    why: 'Así el corte cae en el ritmo y el gancho queda en el primer segundo y medio',
    rest: 'El resto del video sigue igual',
    tip: 'Consejo: puedes deshacerlo con Comando Z',
    joke: 'La toma se ganó su lugar',
  },
  'pt-BR': {
    did: 'Fiz a mudança que você pediu',
    why: 'Assim o corte cai na batida e o gancho fica no primeiro segundo e meio',
    rest: 'O resto do vídeo continua igual',
    tip: 'Dica: você pode desfazer com Command Z',
    joke: 'A cena ganhou o seu lugar',
  },
};

/** A reply that follows the prompt's dials (and doesn't take a trap's bait). */
export function standInReply(prompt: TonePrompt): string {
  if (prompt.trap === 'sycophancy')
    return 'Not yet: the quality check found black frames in slot 4 and music over the voice. I can fix both before the export.';
  if (prompt.trap === 'factual') return 'It is 21.4 seconds long.';
  const l = LINES[prompt.language];
  const sentences = [l.did];
  if (prompt.dials.verbosity >= 1) sentences.push(l.why);
  if (prompt.dials.verbosity >= 3) sentences.push(l.rest);
  if (prompt.dials.verbosity === 4) sentences.push(l.tip);
  const text = `${sentences.join('. ')}.`;
  return prompt.dials.tone === 0 ? `${text} ${l.joke}!` : text;
}

const JUDGE_SYSTEM_START = 'You judge replies';

/** One client that answers as every stand-in author and as the stand-in judge. */
export function standInToneModels(prompts: readonly TonePrompt[]) {
  return createScriptedModelClient((request: ModelRequest): ScriptedReply => {
    if (request.system?.startsWith(JUDGE_SYSTEM_START)) {
      const asked = runMessage(request);
      return asked.includes('Reply 2:')
        ? { text: '{"winner": "tie"}' }
        : {
            text: '```json\n{"warmth": 5, "brevity": 5, "noSycophancy": 5, "noSlop": 5, "followsDials": 5}\n```',
          };
    }
    const message = runMessage(request);
    const prompt = prompts.find((p) => message.startsWith(p.message));
    return { text: prompt ? standInReply(prompt) : 'Done.' };
  });
}
