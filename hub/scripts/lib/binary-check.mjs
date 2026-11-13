// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

const EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.mp4', '.mov', '.wav', '.zip']);

export function binaryExtension(rel) {
  const lower = rel.toLowerCase();
  const dot = lower.lastIndexOf('.');
  if (dot < 0) return false;
  return EXTENSIONS.has(lower.slice(dot));
}

/** JPEG, PNG, WEBP (RIFF), GIF and MP4 (ftyp), including a file renamed to .json. */
export function hasMagic(bytes) {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return true;
  if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return true;
  if (bytes.length >= 4 && bytes.subarray(0, 4).toString('latin1') === 'RIFF') return true;
  if (bytes.length >= 4 && bytes.subarray(0, 4).toString('latin1') === 'GIF8') return true;
  const head = bytes.subarray(0, Math.min(bytes.length, 32));
  return head.includes(Buffer.from('ftyp'));
}

export function hasBom(bytes) {
  return bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
}
