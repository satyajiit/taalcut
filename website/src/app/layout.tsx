// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import type { ReactNode } from 'react';
import { AnalyticsBoot } from '#components/chrome/analytics';
import { SiteFooter } from '#components/chrome/site-footer';
import { SiteHeader } from '#components/chrome/site-header';
import { ThemeProvider } from '#components/chrome/theme-provider';
import { EntryRef } from '#components/premium/entry-ref';
import { JsonLd } from '#components/ui/json-ld';
import { SITE } from '#content/site';
import { organizationJsonLd, websiteJsonLd } from '#lib/jsonld';
import { rootMetadata } from '#lib/seo';
import './globals.css';

const onest = localFont({
  src: '../../node_modules/@fontsource-variable/onest/files/onest-latin-wght-normal.woff2',
  variable: '--font-onest',
  weight: '100 900',
  display: 'swap',
  adjustFontFallback: 'Arial',
});

const jetbrains = localFont({
  src: '../../node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2',
  variable: '--font-jetbrains',
  weight: '100 800',
  display: 'swap',
  preload: false,
});

/** For the few Hindi words the site shows (marked lang="hi"), as DESIGN.md pairs Onest with Noto Sans Devanagari. */
const devanagari = localFont({
  src: '../../node_modules/@fontsource-variable/noto-sans-devanagari/files/noto-sans-devanagari-devanagari-wght-normal.woff2',
  variable: '--font-devanagari',
  weight: '100 900',
  display: 'swap',
  preload: false,
});

export const metadata: Metadata = rootMetadata();

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: SITE.themeColor.light },
    { media: '(prefers-color-scheme: dark)', color: SITE.themeColor.dark },
  ],
  colorScheme: 'light dark',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${onest.variable} ${jetbrains.variable} ${devanagari.variable}`} suppressHydrationWarning>
      <body className="min-h-dvh bg-canvas text-ink">
        <ThemeProvider>
          <a href="#main" className="skip-link rounded-md bg-inverse px-3 py-2 type-label-sm text-on-inverse">
            Skip to content
          </a>
          <SiteHeader />
          <main id="main" tabIndex={-1} className="outline-none">
            {children}
          </main>
          <SiteFooter />
          <AnalyticsBoot />
          <EntryRef />
        </ThemeProvider>
        <JsonLd data={[organizationJsonLd(), websiteJsonLd()]} />
      </body>
    </html>
  );
}
