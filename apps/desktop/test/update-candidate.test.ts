// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import { describe, expect, it } from 'vitest';
import { checkCandidate, compareVersions } from '../src/main/update/candidate';

describe('compareVersions', () => {
  it.each([
    ['0.0.2', '0.0.1', 1],
    ['0.1.0', '0.0.9', 1],
    ['1.0.0', '0.99.99', 1],
    ['10.0.0', '9.0.0', 1],
    ['0.0.1', '0.0.1', 0],
    ['1.0.0+build.7', '1.0.0', 0],
    ['1.0.0-rc.1', '1.0.0', -1],
    ['1.0.0-rc.2', '1.0.0-rc.10', -1],
    ['1.0.0-beta', '1.0.0-alpha', 1],
    ['1.0.0-alpha', '1.0.0-alpha.1', -1],
    ['1.0.0-1', '1.0.0-alpha', -1],
    ['0.0.0-alpha.1', '0.0.0-alpha.2', -1],
    ['0.0.0-internal.3', '0.0.0-internal.4', -1],
    ['0.0.0-alpha.2', '0.0.0-alpha.2', 0],
    ['1.0.0-alpha.9', '1.0.0', -1],
  ])('%s vs %s → %i', (a, b, sign) => {
    expect(Math.sign(compareVersions(a, b) ?? Number.NaN)).toBe(sign);
  });

  it('is undefined for anything but a version', () => {
    expect(compareVersions('latest', '1.0.0')).toBeUndefined();
    expect(compareVersions('1.0', '1.0.0')).toBeUndefined();
  });
});

describe('checkCandidate', () => {
  const running = { version: '0.0.1', team: 'WW382UC8JD' };

  it('accepts a strictly newer bundle signed by the same team', () => {
    expect(checkCandidate(running, { version: '0.0.2', team: 'WW382UC8JD' })).toEqual({
      ok: true,
      value: { version: '0.0.2', team: 'WW382UC8JD' },
    });
  });

  it('refuses the same, an older or an unreadable version: no rollback', () => {
    for (const version of ['0.0.1', '0.0.0', '0.0.2-rc.1x', 'garbage', '0.0.0-alpha.1']) {
      const verdict = checkCandidate({ ...running, version: '0.0.2' }, { version, team: 'WW382UC8JD' });
      expect(verdict).toMatchObject({
        ok: false,
        error: { code: 'desktop.update_not_newer', params: { version, running: '0.0.2' } },
      });
    }
    const same = checkCandidate(
      { version: '0.0.0-alpha.2', team: 'WW382UC8JD' },
      { version: '0.0.0-alpha.2', team: 'WW382UC8JD' },
    );
    expect(same).toMatchObject({
      ok: false,
      error: {
        code: 'desktop.update_not_newer',
        params: { version: '0.0.0-alpha.2', running: '0.0.0-alpha.2' },
      },
    });
    const olderBuild = checkCandidate(
      { version: '0.0.0-internal.4', team: 'WW382UC8JD' },
      { version: '0.0.0-internal.3', team: 'WW382UC8JD' },
    );
    expect(olderBuild).toMatchObject({ ok: false, error: { code: 'desktop.update_not_newer' } });
  });

  it("refuses another team's signature, an ad-hoc one, and anything when the running app has no team", () => {
    const verdict = (candidateTeam: string | undefined, runningTeam: string | undefined) =>
      checkCandidate({ version: '0.0.1', team: runningTeam }, { version: '0.0.2', team: candidateTeam });
    expect(verdict('ABCDE12345', 'WW382UC8JD')).toMatchObject({
      ok: false,
      error: {
        code: 'desktop.update_untrusted_signer',
        params: { team: 'ABCDE12345', expected: 'WW382UC8JD' },
      },
    });
    expect(verdict(undefined, 'WW382UC8JD')).toMatchObject({ error: { params: { team: 'none' } } });
    expect(verdict(undefined, undefined)).toMatchObject({
      error: { code: 'desktop.update_untrusted_signer', params: { team: 'none', expected: 'none' } },
    });
  });
});
