# page-mascot

Upstream repository: <https://github.com/nilbuild/page-mascot>

The licence file in this directory is the upstream `LICENSE` at commit `76a44ed9180063bf4852b9dd724b656f4a828ac7` (committed 2026-09-15), stored unchanged: the MIT licence, copyright (c) 2026 Kamran Ahmed.

## How Taalcut uses it

One file, the `Mascot` React component, is the sprite stage under Kaatu, Taalcut's beaver (`packages/ui/src/brand/`): it stacks Kaatu's six sheets, shows the frame it is given, and reports where the pointer is and when it is poked. Kaatu's player (which frame when: moods, in-between turns, blinks, antics, pokes) is Taalcut's own code in `packages/ui/src/brand/`. It is not an npm dependency: `packages/ui` depends on this directory as `@taalcut-vendor/page-mascot`, the same way it uses React Bits.

The drawing pipeline (page-mascot's skill and Python scripts) is not vendored. Kaatu's sheets were drawn with Codex's built-in image tool from prompts adapted from page-mascot's, and are built with `design/mascot/build.py`, which follows page-mascot's approach (line every frame up on the part that never changes) for any number of sheets. The drawn sheets, the prompts and the rebuild steps are in `design/mascot/`; the built atlases ship in `packages/ui/src/brand/`.

## Working on the vendored code

The original is in `upstream/mascot.tsx`, unchanged; `src/mascot.tsx` is the adapted copy, and `package.json` lists every change (`upstream.changes`). pnpm copies this package into `node_modules` (it is injected, not linked), so after editing anything in `src/` run `pnpm install --frozen-lockfile` to sync the copy the app builds from.
