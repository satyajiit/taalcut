// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Runs after `next build` (the `build` script). Hashes every inline script that runs in the deployed out/**\/*.html
 * and writes firebase.json (at the website root, where Firebase deploys from) from firebase/firebase.template.json with the Content-Security-Policy in its
 * headers, one policy per page (website/SPEC.md › Hosting). The logic is in src/lib/firebase/hosting-csp.ts, which
 * has the tests; Node runs that TypeScript as is (type stripping).
 *
 * Without Firebase config it warns: the contact form shows its closed state, and the policy allows no Firebase host.
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIREBASE_SETUP, MEASUREMENT_ID } from '../src/lib/firebase/config.ts';
import { isDeployed, pageHashes, pagePath, withCsp } from '../src/lib/firebase/hosting-csp.ts';

const site = fileURLToPath(new URL('..', import.meta.url));
const out = join(site, 'out');
const templatePath = join(site, 'firebase', 'firebase.template.json');
// Firebase deploys from the folder that holds firebase.json and refuses a `public` outside it, so the generated
// config sits at the website root and the template's paths (written from firebase/) are rebased onto it.
const configPath = join(site, 'firebase.json');

if (!existsSync(out)) {
  console.error('csp: no out/ to read. Run `next build` first.');
  process.exit(1);
}

function htmlFiles(dir) {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return htmlFiles(full);
    return name.endsWith('.html') ? [full] : [];
  });
}

// Only what Hosting deploys: the template's `ignore` leaves out Next's /404/ and /_not-found/ copies.
const pages = htmlFiles(out)
  .filter((file) => isDeployed(relative(site, file)))
  .sort()
  .map((file) => ({ path: pagePath(relative(site, file)), hashes: pageHashes(readFileSync(file, 'utf8')) }));

if (FIREBASE_SETUP.mode === 'closed') {
  console.warn(
    `csp: warning: no Firebase config (${FIREBASE_SETUP.missing.join(', ')} unset). The contact form shows its ` +
      'closed state, visits are not counted, and the policy allows no Firebase host. Never deploy this build.',
  );
} else if (FIREBASE_SETUP.mode === 'emulator') {
  console.warn('csp: warning: an emulator build (NEXT_PUBLIC_FIREBASE_EMULATOR). Never deploy it.');
}

const template = JSON.parse(readFileSync(templatePath, 'utf8'));
const fromTemplate = (path) => relative(site, join(site, 'firebase', path));
const csp = withCsp(template, pages, { firebase: FIREBASE_SETUP.mode === 'live', analytics: MEASUREMENT_ID !== null });
const config = {
  ...csp,
  hosting: { ...csp.hosting, public: fromTemplate(csp.hosting.public) },
  firestore: {
    ...csp.firestore,
    rules: fromTemplate(csp.firestore.rules),
    indexes: fromTemplate(csp.firestore.indexes),
  },
};
writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

const hashes = new Set(pages.flatMap((p) => p.hashes));
console.log(
  `csp: ${pages.length} HTML files, ${hashes.size} inline script hashes, analytics ${MEASUREMENT_ID ? 'on' : 'off'} → ${relative(site, configPath)}`,
);
