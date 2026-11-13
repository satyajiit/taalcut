// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import { describe, expect, it } from 'vitest';
import { jobsDebugRouter, jobsDebugSections, toJobsDebugJob } from '../src/utility/debug/jobs-bundle';
import { scanBundle, type ScannableSection } from '../src/main/debug/scan-bundle';

const HOME = '/Users/tester';
const SECRET = 'keychain/value+plant';

function section(text: string, extra: Partial<ScannableSection> = {}): ScannableSection {
  return {
    section: 'logs',
    path: 'main/logs.txt',
    mediaType: 'text/plain',
    text,
    ...extra,
  };
}

function refused(text: string, rule: string, extra: Partial<ScannableSection> = {}) {
  const result = scanBundle([section(text, extra)], { secrets: [SECRET], homeDir: HOME });
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error.code).toBe('desktop.debug_bundle_unsafe');
  expect(result.error.params).toEqual({ section: extra.section ?? 'logs', rule });
  expect(JSON.stringify(result.error)).not.toContain(text.slice(0, 24));
  expect(result.error.detail).toBeUndefined();
}

describe('scanBundle', () => {
  it('refuses a known secret raw, base64 and url-encoded', () => {
    refused(`saw ${SECRET} in the log`, 'known_secret');
    refused(`saw ${Buffer.from(SECRET).toString('base64')}`, 'known_secret');
    refused(`saw ${encodeURIComponent(SECRET)}`, 'known_secret');
  });

  it('refuses api keys, media, home paths and a bad media type', () => {
    refused('token sk-abcdefghijklmnopqrstuvwxyz', 'api_key');
    refused(
      'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_Xg',
      'api_key',
    );
    refused(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]).toString('latin1'), 'media_magic');
    refused('see data:image/png;base64,aaaa', 'data_url');
    refused('A'.repeat(1024), 'base64');
    refused(`${HOME}/Library/Logs/taalcut.log`, 'home_path');
    refused('saved /tmp/clip.mp4', 'media_path');
    refused('{}', 'media_type', { mediaType: 'image/jpeg' });
  });

  it('passes a clean bundle of traces and logs', () => {
    const result = scanBundle(
      [
        section('{"spans":[]}', {
          section: 'traces',
          path: 'agent/traces/run.json',
          mediaType: 'application/json',
        }),
        section('[update] idle\n[utility] ready\n'),
      ],
      { secrets: [SECRET], homeDir: HOME },
    );
    expect(result.ok).toBe(true);
  });
});

describe('jobs sections', () => {
  it('keeps safe job fields and drops paths', () => {
    const job = toJobsDebugJob({
      id: 'job_1',
      kind: 'media.probe',
      state: 'failed',
      updatedAt: 10,
      projectId: 'proj_1',
      attempt: 2,
      priority: 'normal',
      progress: { fraction: 0.5, stageKey: 'jobs.stage.probe' },
      output: { path: `${HOME}/secret.mov` },
      error: { code: 'media.probe_failed', detail: SECRET },
    });
    expect(job.errorCode).toBe('media.probe_failed');
    expect(JSON.stringify(job)).not.toContain(SECRET);
    expect(JSON.stringify(job)).not.toContain(HOME);
    const sections = jobsDebugSections(
      [
        {
          ...job,
          updatedAt: 10,
          output: { path: HOME },
          error: { code: 'media.probe_failed', detail: SECRET },
        },
      ],
      [
        {
          id: 'ffmpeg',
          name: 'FFmpeg',
          version: '1',
          state: 'installed',
          licence: { spdx: 'GPL-3.0-only' },
          installed: { path: `${HOME}/components/ffmpeg` },
        },
      ],
      { includeChatText: false },
      20,
    );
    expect(sections.map((item) => item.path)).toEqual(['jobs/rows.ndjson', 'jobs/components.json']);
    expect(sections[1]?.redactions.paths).toBe(1);
    expect(sections[1]?.text).not.toContain(HOME);
    expect(scanBundle(sections, { secrets: [SECRET], homeDir: HOME }).ok).toBe(true);
    expect(jobsDebugRouter).toBeTypeOf('function');
  });
});
