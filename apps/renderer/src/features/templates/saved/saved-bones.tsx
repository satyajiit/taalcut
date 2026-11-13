// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/* Impeccable · Operate · component: Saved on Instagram's skeleton fixture (UX3, UX4 tpl) · system: DESIGN.md v0.6
 * the collection page's shape: the collections rail as the folder rail draws it (no box, a small heading, three
 *   rows), and beside it the sync line (its words, Sync now), the filter row and the saved reels as framed list
 *   rows (a 9:16 frame, two lines, a button). The capture browser renders it; its bones are "templates-saved" */
export function SavedBones() {
  return (
    <div
      aria-hidden
      className="grid grid-cols-1 items-start gap-8 md:grid-cols-[fit-content(14rem)_minmax(0,1fr)]"
    >
      <div className="flex w-48 flex-col gap-2">
        <span className="tc-bone mx-2.5 block h-3 w-20 rounded-sm bg-hover" />
        {Array.from({ length: 3 }, (_, i) => (
          <span key={i} className="flex h-8 items-center justify-between gap-2.5 px-2.5">
            <span className="tc-bone block h-4 w-28 rounded-sm bg-hover" />
            <span className="tc-bone block h-3.5 w-5 rounded-sm bg-hover" />
          </span>
        ))}
      </div>
      <div className="flex min-w-0 flex-col gap-5">
        <div className="flex items-center justify-between gap-4">
          <span className="tc-bone block h-4 w-64 rounded-sm bg-hover" />
          <span className="tc-bone block h-8 w-28 rounded-md bg-hover" />
        </div>
        <div className="flex items-center justify-between gap-3">
          <span className="tc-bone block h-9 flex-1 rounded-md bg-hover" />
          <span className="tc-bone block h-6 w-40 rounded-pill bg-hover" />
        </div>
        <div className="flex flex-col overflow-hidden rounded-lg border border-rule-subtle bg-raised">
          {Array.from({ length: 4 }, (_, i) => (
            <span
              key={i}
              className="flex items-center gap-4 border-t border-rule-subtle px-3 py-2.5 first:border-t-0"
            >
              <span className="tc-bone block aspect-[9/16] w-11 rounded-sm bg-hover" />
              <span className="flex flex-1 flex-col gap-2">
                <span className="tc-bone block h-4 w-56 rounded-sm bg-hover" />
                <span className="tc-bone block h-3 w-32 rounded-sm bg-hover" />
              </span>
              <span className="tc-bone block h-8 w-28 rounded-md bg-hover" />
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
