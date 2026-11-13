// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
import type { JsonLdObject } from '#lib/jsonld';

/** Structured data for search and AI engines. `<` is escaped so text can never close the script element. */
export function JsonLd({ data }: { readonly data: JsonLdObject | readonly JsonLdObject[] }) {
  const json = JSON.stringify(data).replace(/</g, '\\u003c');
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}
