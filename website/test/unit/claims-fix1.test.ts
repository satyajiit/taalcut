// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { describe, expect, it } from 'vitest';
import { claimViolations } from '#content/claims';

/**
 * The patterns fix round 1 added to the truth ledger, each with a sentence it must catch and one it must let
 * through, so a pattern never grows into a false positive on words the ledger says are true.
 */
const CASES: readonly { readonly name: string; readonly banned: readonly string[]; readonly allowed: readonly string[] }[] = [
  {
    name: 'a reason per pick',
    banned: [
      'Pick: it fills each slot from your camera roll, with a one-line reason for every pick.',
      'The AI picks the clip that fits, says why in one line, and keeps three alternates ready.',
      'Taalcut searches your footage, tells you why in one line, and keeps three alternates.',
      'You see the reason for each pick.',
      'Fills each slot with the clip that fits, with a reason and alternates.',
      'One clip per slot from your footage, each with a reason.',
      'Picks and their reasons',
    ],
    allowed: [
      'Each slot says what it needs. The AI picks the clip that fits and shows how sure it is.',
      'Taalcut shows how sure it is (High, Medium or Low) and offers up to three other shots.',
    ],
  },
  {
    name: 'thinking per chat',
    banned: ['Choose how hard it thinks, per chat.', 'A per-chat thinking level.'],
    allowed: ['You choose how hard it thinks from the chat box.'],
  },
  {
    name: 'VTT captions',
    banned: ['Captions as SRT or VTT files.', 'WebVTT captions'],
    allowed: ['Captions export as an SRT file.'],
  },
  {
    name: 'nothing leaves, sends nothing out',
    banned: ['The Local only switch sends nothing out.', 'Switch on Local only and nothing leaves it at all.'],
    allowed: [
      'Nothing of yours leaves your computer. Update checks still send the app’s version and a random ID.',
      'Model downloads send nothing of yours.',
    ],
  },
  {
    name: 'every cut, every beat',
    banned: [
      'Taalcut finds every cut and music beat.',
      'Paste a link. Taalcut finds every cut and beat.',
      'It reads every beat of the song.',
    ],
    allowed: [
      'Taalcut finds the cuts and music beats, the on-screen text and when it shows.',
      'Every cut checked. The template keeps your fix.',
      'Vietnam, walking away on every beat',
    ],
  },
  {
    name: 'llama.cpp or vLLM as your own server',
    banned: [
      'Your own server: Ollama, LM Studio, llama.cpp or vLLM.',
      'Yes, under Advanced in Settings › Accounts: Ollama, LM Studio, llama.cpp or vLLM.',
      'Point Taalcut at a vLLM server.',
    ],
    allowed: [
      'Can run here: Qwen3.5 4B through llama.cpp on computers with 16 GB of memory or more.',
      'If you already run Ollama or LM Studio, add it in Settings › Accounts › Servers.',
    ],
  },
  {
    name: 'is free software',
    banned: ['Taalcut is free software under the AGPL-3.0-or-later licence.'],
    allowed: ['Taalcut is free. Its code is under the AGPL-3.0-or-later licence and opens with the beta.'],
  },
  {
    name: '"Supported" as a platform badge',
    banned: ['Supported', 'macOS is supported', 'Ubuntu, officially supported'],
    allowed: [
      'You get a .deb for x64 when the beta opens for Ubuntu.',
      'Windows comes after 1.0.',
      // The platform status id is data, not a badge.
      'supported',
    ],
  },
  {
    name: 'encryption, outside the keychain',
    banned: ['Encrypted transfer from your phone.', 'End-to-end encryption'],
    allowed: [
      'Kept encrypted with a key in your computer’s keychain.',
      'Taalcut keeps it encrypted with a key in your computer’s keychain, and never shows it back.',
    ],
  },
];

describe('the fix-1 claims', () => {
  for (const c of CASES) {
    it(`catch ${c.name}`, () => {
      for (const bad of c.banned) expect(claimViolations(bad), bad).not.toEqual([]);
    });

    it(`let the true sentence through: ${c.name}`, () => {
      for (const good of c.allowed) expect(claimViolations(good), good).toEqual([]);
    });
  }
});
