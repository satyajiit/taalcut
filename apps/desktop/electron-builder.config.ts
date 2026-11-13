// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * Entry for `electron-builder --config electron-builder.config.ts`; the
 * settings live in packaging/builder-config.ts.
 *
 *   default:  signed ad-hoc ("-"), not notarised (CI, contributors)
 *   release:  TAALCUT_MAC_IDENTITY="Developer ID Application: Matterward Labs
 *             Private Limited (WW382UC8JD)" signs everything with that identity;
 *             the app and DMG are notarised when the keychain profile
 *             taalcut-notary exists (packaging/notarize.ts)
 *   linux:    the .deb (packaging/linux.ts); nothing is signed, and the
 *             keychain check below is a Mac's (it runs `security`)
 */
import { builderConfig } from './packaging/builder-config';
import { AD_HOC, assertAdHocIsSafe, macIdentity } from './packaging/signing';

if (process.platform === 'darwin' && macIdentity(process.env) === AD_HOC) assertAdHocIsSafe(process.env);

export default builderConfig(process.env, import.meta.dirname);
