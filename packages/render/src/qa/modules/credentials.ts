// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * contentCredentials (P3-V7) on the delivered bytes: on, the sidecar's read must validate and match the AI
 * inventory; off, the file must carry no manifest at all (Taalcut adds nothing). Runs on every render.
 */
import { hasC2paManifestBox } from '../../credentials';
import { contentCredentialsCheck } from '../checks/credentials';
import { unmeasured } from '../unmeasured';
import type { QaCheckModule } from './module';

const NO_INVENTORY = { parts: [], generated: [], allGenerated: false } as const;

export const credentialsQaModule: QaCheckModule = {
  ids: ['contentCredentials'],
  probeFrames: () => [],
  async run({ run, facts }, wanted) {
    if (!wanted.has('contentCredentials')) return [];
    const started = performance.now();
    const credentials = facts.credentials;
    const add = credentials?.add ?? false;
    // A file QA can't read can't be approved: the check fails with a re-render fix.
    const boxPresent = await hasC2paManifestBox(run.file).catch(() => null);
    if (boxPresent === null) return [unmeasured('contentCredentials', 'file')];
    const read = add && credentials ? await credentials.inspect(run.file) : null;
    return [
      contentCredentialsCheck(
        { add, boxPresent, read, inventory: credentials?.inventory ?? NO_INVENTORY },
        performance.now() - started,
      ),
    ];
  },
};
