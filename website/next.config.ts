// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import type { NextConfig } from 'next';

/**
 * A fully static site: `next build` exports every route to `out/`, which Firebase Hosting serves with the headers in
 * firebase.json. No server, no image optimiser (the media pipeline makes every size ahead of time).
 */
const config: NextConfig = {
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  reactStrictMode: true,
  poweredByHeader: false,
  typedRoutes: true,
};

export default config;
