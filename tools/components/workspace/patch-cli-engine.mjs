// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Port the app's tested drawElement implementation into the CLI's pinned bundled engine. */
import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { extract } from '../hosting/archive.mjs';
import { sha256Hex } from '../hosting/files.mjs';
import { pinned } from '../hosting/pinned.mjs';

const exec = promisify(execFile);
/** The CLI npm release's gitHead; both CLI and engine source versions are 0.8.209 at this commit. */
export const HYPERFRAMES_SOURCE = {
  url: 'https://codeload.github.com/heygen-com/hyperframes/tar.gz/53c975966611e7012b09b6d46707c26511ea077d',
  size: 147182126,
  sha256: 'b56df3f7991dd6b5bc076f49ea1b10bd25a2b663e4c86606db0c7e1745436305',
};

export const CLI_ENGINE = {
  file: 'dist/chunk-IQNS7O4W.js',
  sha256: '5470c96fe2f88060bbbdb4884fab061bdb2fda6bd6ccb0ad71a948e707c8f865',
  patch: 'patches/@hyperframes__engine@0.8.209.patch',
  patchSha256: '4cb81b3c896acbf2348b582dee1eaa4af121b78d04f5841c88007291831c86ed',
  source: {
    url: 'https://registry.npmjs.org/@hyperframes/engine/-/engine-0.8.209.tgz',
    size: 453335,
    sha256: '101ddd425f3b21edda79e0373de6e40dae0cc4d5de6efbd656c13413ee013160',
  },
};

function replaceOnce(text, before, after) {
  if (text.split(before).length !== 2) throw new Error('CLI engine patch anchor changed');
  return text.replace(before, after);
}

/** The known bundle is required: never silently patch a different upstream release. */
export function portDrawElement(bundle, drawElement, frameCapture) {
  if (sha256Hex(bundle) !== CLI_ENGINE.sha256) throw new Error('Unexpected CLI engine bundle SHA256');
  if (/^import\s/m.test(drawElement)) throw new Error('drawElementService is no longer self-contained');
  const start = '// ../engine/src/services/drawElementService.ts\n';
  const end = '// ../engine/src/services/threeDProjection.ts\n';
  const before = bundle.slice(bundle.indexOf(start), bundle.indexOf(end));
  const body = drawElement.replace(/^export /gm, '');
  let changed = replaceOnce(bundle, before, `${start}${body}\n`);
  const recover = 'function isRecoverableDrawElementError(err) {';
  const old = `${recover}\n  return isNoCachedPaintRecordError(err) || isCanvasNotInitializedError(err);\n}`;
  const helperStart = frameCapture.indexOf(recover);
  const helperEnd = frameCapture.indexOf('/**\n * Per-frame deadline', helperStart);
  if (helperStart < 0 || helperEnd < helperStart) throw new Error('Paint recovery helpers changed');
  changed = replaceOnce(changed, old, frameCapture.slice(helperStart, helperEnd).trimEnd());
  for (const variable of ['err', 'captureError', 'error']) {
    changed = replaceOnce(
      changed,
      `const reason = isCanvasNotInitializedError(${variable}) ? "drawElement canvas not initialized" : "No cached paint record";`,
      `const reason = recoverableDrawElementReason(${variable});`,
    );
  }
  return changed;
}

/** Build input, patch and resulting bundle hashes are retained inside the delivered component. */
export async function patchCliEngine({ root, scratch, repo, pinOptions, log }) {
  const packageRoot = join(root, 'node_modules', 'hyperframes');
  const bundleFile = join(packageRoot, CLI_ENGINE.file);
  const bundle = await readFile(bundleFile, 'utf8');
  const patch = await readFile(join(repo, CLI_ENGINE.patch));
  if (sha256Hex(patch) !== CLI_ENGINE.patchSha256)
    throw new Error('Review the changed app engine patch first');
  await extract(await pinned(CLI_ENGINE.source, pinOptions), 'tar.gz', scratch);
  const engine = join(scratch, 'package');
  await exec('/usr/bin/patch', ['-f', '-p1', '-i', join(repo, CLI_ENGINE.patch)], { cwd: engine });
  const drawElement = await readFile(join(engine, 'dist/services/drawElementService.js'), 'utf8');
  const frameCapture = await readFile(join(engine, 'dist/services/frameCapture.js'), 'utf8');
  const changed = portDrawElement(bundle, drawElement, frameCapture);
  await writeFile(bundleFile, changed);
  await exec(process.execPath, ['--check', bundleFile]);
  const provenance = {
    upstreamCli: 'hyperframes@0.8.209',
    file: CLI_ENGINE.file,
    before: CLI_ENGINE.sha256,
    after: sha256Hex(changed),
    engineInput: CLI_ENGINE.source,
    patch: { file: CLI_ENGINE.patch, sha256: CLI_ENGINE.patchSha256 },
    ported: ['drawElementService', 'recoverable drawElement paint timeout classification'],
    scope:
      'Other app engine patches are not applied to the CLI; workspace confinement is enforced by Seatbelt.',
  };
  await writeFile(join(root, 'PATCH-PROVENANCE.json'), `${JSON.stringify(provenance, null, 2)}\n`);
  log(`CLI drawElement port: ${provenance.after}`);
  return provenance;
}
