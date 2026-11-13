// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** What the area plans share: the public base, Hugging Face pins and the stock sentences of the notices. */

export const PUBLIC_BASE = 'https://components.taalcut.app';

const HF = 'https://huggingface.co';
export const hf = (repo, rev, path) => `${HF}/${repo}/resolve/${rev}/${path}`;
export const UNCHANGED = ['Taalcut hosts these bytes unchanged.'];
export const REPACKED = [
  'Taalcut repacked these upstream files, unchanged, as one tar.zst (tools/components/hosting).',
];
export const SIGNED =
  'Taalcut signed every Mach-O file with its Developer ID (Matterward Labs Private Limited, WW382UC8JD; hardened runtime, secure timestamp) and repacked it as tar.zst. Nothing else changed.';
export const NOTARISED =
  "Apple notarised the signed files (notarytool, Taalcut's Developer ID). A bare executable or an archive can't carry a stapled ticket, so Gatekeeper looks it up online by each file's code directory hash.";
