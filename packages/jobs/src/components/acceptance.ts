// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/**
 * A licence the person accepts in the app before the component downloads (LNX1-TRM): `licence.acceptance`. Its owner
 * licenses the component to the person under its own terms; Taalcut only downloads and installs it on their computer
 * (NVIDIA's CUDA runtime and cuDNN, `cuda-runtime-13`). Generic: a Windows CUDA or TensorRT component states the same.
 *
 * Older builds ignore the field (the manifest's objects aren't strict) and would not ask. That is acceptable because
 * the only component that states it is reached through `variants`, which builds before LNX1-CMP don't read, and only
 * LNX1 builds select linux-x64 artifacts.
 */
import { z } from 'zod';

/** An https page with no credentials in it. */
function isHttpsPage(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}

const LicenceDocument = z.object({
  title: z
    .string()
    .min(1)
    .max(120)
    .describe('The document\'s own title, e.g. "CUDA Toolkit End User License Agreement". Shown as is.'),
  url: z
    .url()
    .refine(isHttpsPage, { message: "Use the owner's official https:// URL, without credentials." })
    .describe("The owner's official page with the text, opened in the system browser."),
});

export const LicenceAcceptanceSchema = z
  .object({
    owner: z
      .string()
      .min(1)
      .max(120)
      .describe('Who makes and owns the component and licenses it to the person, e.g. "NVIDIA Corporation".'),
    termsVersion: z
      .string()
      .min(1)
      .max(64)
      .regex(/^[0-9A-Za-z][0-9A-Za-z.+_-]*$/)
      .describe(
        'Which terms the person accepts, e.g. a date. A new value asks again; an acceptance of another one does not count.',
      ),
    documents: z
      .array(LicenceDocument)
      .min(1)
      .max(8)
      .describe('Each licence text the person accepts, linked from the card that asks.'),
  })
  .describe(
    'Terms the person accepts in the app before this component downloads (LNX1-TRM). Until they have, the component and everything that depends on it stay out of the download, and an install is refused (jobs.terms_not_accepted). Older builds ignore it.',
  );

export type LicenceAcceptance = z.output<typeof LicenceAcceptanceSchema>;
