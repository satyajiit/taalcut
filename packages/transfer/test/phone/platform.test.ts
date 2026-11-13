// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';
import {
  detectPlatform,
  fileInputsFor,
  fingerprint,
  formatBytes,
  lookupDecision,
  pairBody,
  readTokenFromHash,
  resumeUploadUrl,
  // @ts-expect-error phone modules ship as plain JavaScript for the browser.
} from '../../phone/logic.mjs';

const IPHONE =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
const IPAD =
  'Mozilla/5.0 (iPad; CPU OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1';
const ANDROID =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36';
const DESKTOP =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36';
const FILES = '.mov,.mp4,.m4v,.heic,.heif,.jpg,.jpeg,.png,.dng';
const MEDIA = 'video/*,image/*';

describe('detectPlatform', () => {
  it('treats iPhone and iPad as iOS', () => {
    expect(detectPlatform(IPHONE)).toBe('ios');
    expect(detectPlatform(IPAD)).toBe('ios');
  });

  it('treats Android Chrome as android and desktop Chrome as other', () => {
    expect(detectPlatform(ANDROID)).toBe('android');
    expect(detectPlatform(DESKTOP)).toBe('other');
  });
});

describe('fileInputsFor', () => {
  it('gives iOS two pickers and never a capture control', () => {
    const inputs = fileInputsFor('ios');
    expect(inputs).toEqual([
      { id: 'files', accept: FILES, kind: 'files' },
      { id: 'photos', accept: MEDIA, kind: 'photos' },
    ]);
    expect(fileInputsFor(detectPlatform(IPHONE))).toEqual(inputs);
    expect(fileInputsFor(detectPlatform(IPAD))).toEqual(inputs);
    for (const input of inputs) expect(input).not.toHaveProperty('capture');
    expect(JSON.stringify(inputs)).not.toContain('capture');
  });

  it('gives Android and other desktops one picker', () => {
    const one = [{ id: 'any', accept: MEDIA, kind: 'any' }];
    expect(fileInputsFor('android')).toEqual(one);
    expect(fileInputsFor('other')).toEqual(one);
    expect(fileInputsFor(detectPlatform(ANDROID))).toEqual(one);
    expect(fileInputsFor(detectPlatform(DESKTOP))).toEqual(one);
    expect(JSON.stringify(one)).not.toContain('capture');
  });
});

describe('pairing and lookup', () => {
  it('reads the fragment token and drops an empty one', () => {
    expect(readTokenFromHash('#k=abc')).toBe('abc');
    expect(readTokenFromHash('#k=ab%20c')).toBe('ab c');
    expect(readTokenFromHash('#k=')).toBeNull();
    expect(readTokenFromHash('')).toBeNull();
    expect(readTokenFromHash('#x=1')).toBeNull();
  });

  it('sends the token or the setup code, never both', () => {
    expect(pairBody({ token: 't', code: 'ignored', pin: '123456', name: 'iPhone' })).toEqual({
      token: 't',
      pin: '123456',
      device: { name: 'iPhone' },
    });
    expect(pairBody({ code: 'abcnm123', pin: ' 123456 ' })).toEqual({
      code: 'ABCNM123',
      pin: '123456',
      device: {},
    });
  });

  it('fingerprints a file with newlines between the four fields', () => {
    expect(fingerprint({ name: 'a.mov', size: 3, lastModified: 9, type: 'video/quicktime' })).toBe(
      'a.mov\n3\n9\nvideo/quicktime',
    );
  });

  it('resumes an unfinished upload, skips a finished one, and uploads the rest', () => {
    expect(lookupDecision(null)).toBe('upload');
    expect(lookupDecision({ state: 'uploading', uploadId: 'abc' })).toBe('resume');
    expect(lookupDecision({ state: 'paused', uploadId: 'abc' })).toBe('resume');
    expect(lookupDecision({ state: 'uploading' })).toBe('upload');
    for (const state of ['imported', 'duplicate', 'received']) expect(lookupDecision({ state })).toBe('skip');
    for (const state of ['checking', 'importing', 'failed']) expect(lookupDecision({ state })).toBe('upload');
  });

  it('keeps the resume URL on this Mac', () => {
    const origin = 'http://10.0.0.8:9';
    const id = { state: 'uploading', uploadId: 'abc' };
    expect(resumeUploadUrl(id, origin)).toBe(`${origin}/files/abc`);
    expect(resumeUploadUrl({ ...id, url: 'https://evil.example/files/abc' }, origin)).toBe(
      `${origin}/files/abc`,
    );
    expect(resumeUploadUrl({ ...id, url: 'javascript:alert(1)' }, origin)).toBe(`${origin}/files/abc`);
    expect(resumeUploadUrl({ ...id, url: '/uploads/abc' }, origin)).toBe(`${origin}/uploads/abc`);
    expect(resumeUploadUrl({ state: 'imported', uploadId: 'abc' }, origin)).toBeNull();
  });

  it('formats sizes for the page locale', () => {
    expect(formatBytes(0, 'en')).toBe('0 bytes');
    expect(formatBytes(1536, 'en')).toBe('1.5 kB');
  });
});
