// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/** Trusted entry point copied into the isolated session; every project script stays inside its OS sandbox. */
export const CREATION_PROJECT_BOOTSTRAP = `
const fs = require('node:fs');
const cp = require('node:child_process');
const path = require('node:path');
const settings = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const ports = process.env.TAALCUT_SHELL_PORTS.split(',').map(Number);
const port = ports[1];
const registry = 'http://127.0.0.1:' + ports[0];
const env = { ...process.env, PORT: String(port), HOST: '127.0.0.1', HOSTNAME: '127.0.0.1',
  npm_config_offline: 'false', npm_config_registry: registry, npm_config_audit: 'false',
  npm_config_fund: 'false', npm_config_update_notifier: 'false', npm_config_ignore_scripts: 'true',
  npm_config_manage_package_manager_versions: 'false', COREPACK_ENABLE_NETWORK: '0',
  NEXT_TELEMETRY_DISABLED: '1', ASTRO_TELEMETRY_DISABLED: '1', CI: 'true' };
function run(args, extra = {}) {
  const result = cp.spawnSync(process.execPath, [settings.cli, ...args], { env: {...env, ...extra}, stdio: 'inherit' });
  if (result.error || result.status !== 0) process.exit(result.status || 1);
}
if (settings.install) {
  const frozen = settings.manager === 'npm' ? fs.existsSync('package-lock.json') : fs.existsSync('pnpm-lock.yaml');
  run(settings.manager === 'npm' ? [frozen ? 'ci' : 'install', '--registry=' + registry, '--ignore-scripts', '--no-audit', '--no-fund']
    : ['install', '--registry=' + registry, '--ignore-scripts', '--ignore-pnpmfile', '--config.manage-package-manager-versions=false',
      frozen ? '--frozen-lockfile' : '--no-frozen-lockfile']);
}
env.npm_config_offline = 'true';
env.npm_config_ignore_scripts = 'false';
fs.writeFileSync(path.join(settings.control, 'installed'), 'done');
const wait = new Int32Array(new SharedArrayBuffer(4));
while (!fs.existsSync(path.join(settings.control, 'registry-closed'))) Atomics.wait(wait, 0, 0, 25);
if (settings.buildScript) run(['run', settings.buildScript]);
const manifest = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const script = manifest.scripts[settings.script];
const flags = /(?:^|\\s)next(?:\\s|$)/.test(script) ? ['--hostname', '127.0.0.1', '--port', String(port)]
  : /(?:vite|astro|nuxt|webpack)/.test(script) ? ['--host', '127.0.0.1', '--port', String(port)] : [];
run(['run', settings.script, ...(flags.length ? [...(settings.manager === 'npm' ? ['--'] : []), ...flags] : [])]);
`;
