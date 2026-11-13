// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * EAR1-D1: earshot's SFX bank rendered into takes (manifest.sfx-bank.provisional.json, hosted since 2026-11-07).
 * Built by tools/audio-packs/sfx-bank/build-sfx-bank.mjs from upstream earshot at its pinned commit, in the build
 * machine's venv (render_bank.py, Python at build time only), with CLAP embeddings from @taalcut/audio's own
 * runner on the unpacked listen builds; reproducible (two builds give the same sha256). The licence (D22): every
 * sound is rendered by earshot's code, so MIT (earshot's licence), the 15 fitted sounds too (rendered from the
 * models in fit.json); the CC0 1.0 recordings those models were measured from are credited in CREDITS_FIT.md and
 * in the NOTICE.txt the archive carries.
 */

export const SFX_BANK_FILE = 'sfx-bank-0.4.0-ff41f07.2.tar.zst';

export const SFX_BANK = {
  'sfx-bank': {
    file: SFX_BANK_FILE,
    signature: 'none',
    recipe: {
      kind: 'script',
      command: [
        'node',
        'tools/audio-packs/sfx-bank/build-sfx-bank.mjs',
        '--render',
        '--embed',
        '--out',
        '{stage}/sfx-bank',
      ],
    },
    notice: {
      changes: [
        "Rendered for Taalcut from earshot's bank (https://github.com/Leonxlnx/earshot, commit ff41f0788ae56896fd59879ab03858d223c06a53) by tools/audio-packs/sfx-bank (reproducible): every sound's takes measured, audited (a failed take re-rolled; a sound with no clean take withheld), encoded as FLAC with catalogue.json and CLAP embeddings. earshot's licence, the fitted sounds' credits and a NOTICE are inside the archive.",
      ],
      repoTexts: [
        {
          title: 'earshot LICENSE (MIT, Copyright (c) 2026 Leon Lin), third_party/earshot/LICENSE',
          path: 'third_party/earshot/LICENSE',
        },
        {
          title:
            "earshot's credits for the CC0 1.0 recordings its fitted sounds were measured from, third_party/earshot/docs/CREDITS_FIT.md",
          path: 'third_party/earshot/docs/CREDITS_FIT.md',
        },
      ],
      inArtifact: [
        {
          title: 'NOTICE.txt (from the archive): what the sounds are and where they come from',
          path: 'NOTICE.txt',
        },
      ],
    },
  },
};
