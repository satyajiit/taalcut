// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: a download's error line · genre: atmospheric studio app (chrome modern-minimal) · system:
 *   DESIGN.md v0.3 · states: ErrorLine's own, in this platform's words (UX3-IDX: "isn't available for Linux yet")
 */
import { ErrorLine, useHostPlatform, type ErrorLineProps } from '@taalcut/ui';
import { downloadErrorOn } from './download-messages';

/** ErrorLine for the component manager's errors, which name the Mac on a Mac and the system elsewhere. */
export function DownloadErrorLine({ error, ...props }: ErrorLineProps) {
  const platform = useHostPlatform();
  return <ErrorLine error={downloadErrorOn(error, platform)} {...props} />;
}
