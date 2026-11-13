// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * The verifier against real codesign and ditto, with bundles built to lie:
 * names and executables whose newlines add a TeamIdentifier line to
 * codesign's output (review 4, §5). The running app is the only fake: it
 * claims a team, so a forged team would be accepted if it were believed.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDownloadVerifier, runExec, type Exec } from '../src/main/update/verify-download';

const TEAM = 'ABCDE12345';
const RUNNING = '/Applications/Probe Running.app';

function plist(executable: string, version: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleExecutable</key><string>${executable}</string>
<key>CFBundleIdentifier</key><string>com.probe.update</string>
<key>CFBundlePackageType</key><string>APPL</string>
<key>CFBundleShortVersionString</key><string>${version}</string>
</dict></plist>
`;
}

// Ad-hoc signing and two codesign runs per case; a loaded machine can take seconds to fork.
describe.skipIf(process.platform !== 'darwin')(
  'createDownloadVerifier with real codesign',
  { timeout: 60_000 },
  () => {
    let root: string;
    beforeAll(() => {
      root = mkdtempSync(join(tmpdir(), 'taalcut-forged-update-'));
    });
    afterAll(() => rmSync(root, { recursive: true, force: true }));

    /** An ad-hoc signed bundle `name`, zipped as electron-builder does (ditto --keepParent). */
    function forgedUpdate(name: string, executable = 'Probe'): string {
      const folder = mkdtempSync(join(root, 'case-'));
      const app = join(folder, name);
      mkdirSync(join(app, 'Contents', 'MacOS'), { recursive: true });
      writeFileSync(join(app, 'Contents', 'MacOS', executable), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
      writeFileSync(join(app, 'Contents', 'Info.plist'), plist(executable, '9.9.9'));
      execFileSync('/usr/bin/codesign', ['--force', '--sign', '-', app]);
      const zip = join(folder, 'update.zip');
      execFileSync('/usr/bin/ditto', ['-c', '-k', '--keepParent', app, zip]);
      return zip;
    }

    /** Real tools, except that the running app answers as if signed by TEAM; optionally forges the candidate's codesign -dv too. */
    function verifier(forgeCandidateTeam = false) {
      const exec: Exec = async (command, args) => {
        const target = String(args.at(-1));
        if (target.startsWith(RUNNING)) {
          if (command.endsWith('plutil')) {
            return {
              stdout: args[1] === 'CFBundleIdentifier' ? 'com.probe.update\n' : '1.0.0\n',
              stderr: '',
            };
          }
          return {
            stdout: '',
            stderr: `Executable=${RUNNING}/Contents/MacOS/Probe\nTeamIdentifier=${TEAM}\n`,
          };
        }
        if (forgeCandidateTeam && command.endsWith('codesign') && args[0] === '-dv') {
          return {
            stdout: '',
            stderr: `Executable=${target}/Contents/MacOS/Probe\nTeamIdentifier=${TEAM}\n`,
          };
        }
        return runExec(command, args);
      };
      return createDownloadVerifier({
        runningApp: RUNNING,
        runningVersion: '1.0.0',
        exec,
        scratchRoot: root,
      });
    }

    it('refuses a bundle whose name carries a TeamIdentifier line', async () => {
      const zip = forgedUpdate(`Evil\nTeamIdentifier=${TEAM}\nX.app`);
      expect(await verifier()(zip)).toMatchObject({
        ok: false,
        error: { code: 'desktop.update_untrusted_signer', params: { team: 'unverified', expected: TEAM } },
      });
    });

    it('refuses a Taalcut.app whose executable name carries a TeamIdentifier line', async () => {
      const zip = forgedUpdate('Taalcut.app', `Probe\nTeamIdentifier=${TEAM}`);
      expect(await verifier()(zip)).toMatchObject({
        ok: false,
        error: { code: 'desktop.update_unreadable', detail: 'codesign reported 2 TeamIdentifier lines' },
      });
    });

    it("refuses an ad-hoc Taalcut.app even when codesign's text claims our team: the requirement decides", async () => {
      const zip = forgedUpdate('Taalcut.app');
      expect(await verifier()(zip)).toMatchObject({
        error: { code: 'desktop.update_untrusted_signer', params: { team: 'none', expected: TEAM } },
      });
      expect(await verifier(true)(zip)).toMatchObject({
        ok: false,
        error: { code: 'desktop.update_untrusted_signer', params: { team: 'unverified', expected: TEAM } },
      });
    });
  },
);
