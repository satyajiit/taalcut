// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Hallmark · component: release notes · genre: atmospheric studio app (chrome modern-minimal) · system: DESIGN.md v0.3
 * the release's own words as text: paragraphs at text-md and bullets in a plain list (ink-3 markers), bold at 600.
 *   Never HTML: every run is a text node, so a tag in the notes shows as the characters it is.
 * states: n/a (text; empty notes render nothing and the dialog says so)
 */
import { parseReleaseNotes, type NoteRun } from './release-notes-parse';

function Runs({ runs }: { runs: readonly NoteRun[] }) {
  return runs.map((run, index) =>
    run.bold ? (
      <strong key={index} className="font-semibold text-ink">
        {run.text}
      </strong>
    ) : (
      <span key={index}>{run.text}</span>
    ),
  );
}

/** The update's notes in the app's language (main picks the language; English when one is missing). */
export function ReleaseNotes({ notes, className }: { notes: string; className?: string }) {
  const blocks = parseReleaseNotes(notes);
  return (
    // The release's own words, already in the app's language (English when the release has none): data shown as
    // written, never a catalogue string.
    <div data-slot="release-notes" data-user-content className={className}>
      {blocks.map((block, index) =>
        block.kind === 'paragraph' ? (
          <p key={index} className="m-0 max-w-[65ch] text-md text-ink-2">
            <Runs runs={block.runs} />
          </p>
        ) : (
          <ul
            key={index}
            className="m-0 flex max-w-[65ch] list-disc flex-col gap-1.5 ps-5 text-md text-ink-2 marker:text-ink-3"
          >
            {block.items.map((item, at) => (
              <li key={at}>
                <Runs runs={item} />
              </li>
            ))}
          </ul>
        ),
      )}
    </div>
  );
}
