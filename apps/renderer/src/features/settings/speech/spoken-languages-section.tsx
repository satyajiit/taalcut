// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · section: Settings › General › Languages you speak (LIB1-LANG) · genre: atmospheric studio app (chrome
 *   modern-minimal) · system: DESIGN.md v0.7 + UX4 (the kit's PageSection)
 * after Language, since the two are read together: Taalcut's own words, then the words in your clips. What the
 *   languages do in one line, and what an Indian one brings with it, before anything downloads; the editor under
 *   it (spoken-languages-editor.tsx)
 * states: the editor's own */
import { Trans } from '@lingui/react/macro';
import { PageSection } from '@taalcut/ui';
import { SETTINGS_ICONS } from '../settings-icons';
import { SpokenLanguagesEditor } from './spoken-languages-editor';

/** The anchor ⌘K and a clip's language picker open. */
export const SPOKEN_LANGUAGES_ANCHOR = 'spoken-languages';

export function SpokenLanguagesSection() {
  return (
    <PageSection
      title={<Trans>Languages you speak</Trans>}
      icon={SETTINGS_ICONS.spokenLanguages}
      description={
        <Trans>
          Taalcut listens for these first when it works out which language a clip is in, and never names one
          it can’t hear. With an Indian language here, it downloads a language identifier for Odia and other
          Indian languages.
        </Trans>
      }
    >
      <div id={SPOKEN_LANGUAGES_ANCHOR} className="scroll-mt-24">
        <SpokenLanguagesEditor />
      </div>
    </PageSection>
  );
}
