# React Bits

Upstream repository: <https://github.com/DavidHDev/react-bits>

The licence file in this directory is the upstream `LICENSE.md` at commit `e2eb04d89d5be5a633dba7b2d4adfd274e053767`, committed 2026-10-12. It was fetched from that commit and stored unchanged. Copyright (c) 2026 David Haz.

The upstream file's own title is "MIT + Commons Clause License Condition v1.0". The body is David Haz's wording. It is not the OSI MIT licence, and it is not the OSI MIT licence with the commonsclause.com text pasted underneath. Taalcut's own notes call the same terms "MIT + Commons Clause". Do not "correct" this copy into either of those other texts. If upstream changes the wording, replace this file from a named commit and record the new SHA here.

## How Taalcut uses it

React Bits is used inside the Taalcut app. It is not published as its own package, and it is not redistributed as a standalone component kit. When the components are vendored, this licence file stays next to that code. The copy in this directory is the licence record for that use.

That limit is the project's rule for this dependency. The legal wording that applies is the upstream file beside this README, not a paraphrase.

## Working on the vendored code

The originals sit in `upstream/<Component>/` unchanged; `src/` holds the adapted copies, and `package.json` lists every change (`upstream.changes`). pnpm copies this package into `node_modules` (it is injected, not linked), so after editing anything in `src/` run `pnpm install --frozen-lockfile` to sync the copy the app builds from.
