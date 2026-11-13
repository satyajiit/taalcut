# Contributing to Taalcut

Taalcut is an AGPL-3.0-or-later desktop app. Set up, run the checks, keep commits small, and contribute under the same terms as the files you change. No CLA signature is required.

## Setup

You need Node 24 (`>=24.11`) and pnpm 11.22.0.

```sh
pnpm install --frozen-lockfile
pnpm check
```

`pnpm check` is typecheck, lint (with the `NOTICE` check), test, the catalogue check (`pnpm i18n:check`), and the tests for `scripts/`. Run it before you open a pull request. `pnpm --filter @taalcut/<package> test` runs one package's tests, and `pnpm dev` starts the app from source.

### On Linux

Ubuntu 22.04 or 24.04 on x64. Two steps a Mac doesn't need:

```sh
tools/ffmpeg/build-linux.sh                              # the LGPL FFmpeg, into tools/ffmpeg/dist/linux-x64 (Docker)
sudo apps/desktop/scripts/linux/install-apparmor-dev.sh  # once per machine, Ubuntu 23.10 and later
```

`build-linux.sh` builds FFmpeg from the pinned sources in a pinned Ubuntu 22.04 container (Docker, no network inside it; about ten minutes the first time, most of it building the toolchain image, then under two minutes on 12 cores) and lays it out the way the app and the tests look for it; it refuses a tarball whose SHA-256 isn't the pin, and media refuses a build that isn't the committed one. Its libraries load the system's `libvulkan1`, `libva2` and `libva-drm2` (an Ubuntu desktop has them; `sudo apt install libvulkan1 libva2 libva-drm2` otherwise). Without the build the FFmpeg suites skip and say so. [tools/ffmpeg/README.md](tools/ffmpeg/README.md#linux-x64) has the details. The AppArmor profile lets a checkout's Electron and the headless Chrome HyperFrames renders with keep their sandbox: Ubuntu 23.10 and later refuse unprivileged user namespaces to programs without a profile, and `pnpm dev` stops with that command until it is installed. Suites that need a Mac (`say`, VideoToolbox, `sips`, Core ML) skip on Linux and say why in their names. `pnpm package:linux` builds the `.deb` and checks it. The release is the macOS build; Linux is for development.

## Where things are

`apps/desktop` (Electron main, preload and utility processes; it wires everything together) · `apps/renderer` (the sandboxed React interface) · `packages/*` (one domain each) · `tools/evals` (the evaluation runner) · `tools/ffmpeg` (the LGPL FFmpeg build) · `tools/components` (download manifests) · `third_party/` (vendored code under its own licence) · `website/` (taalcut.app).

Packages are consumed as TypeScript source: each `package.json` exports `./src/index.ts`. There is no build step between packages; Vite and tsdown bundle the apps.

## Rules the checks enforce

1. **Public API only.** Import another package as `@taalcut/<name>`, never a path inside it. Each package's `src/index.ts` is its whole public surface.
2. **Layering.** `core` imports no Taalcut package, and every other package imports only the ones below it. No cycles. The allowed edges are in `.dependency-cruiser.cjs`.
3. **No file over 400 lines**, tests included. Split by responsibility, not by line count.
4. **Models only through `@taalcut/models`.** No other package imports a provider SDK.
5. **Electron only in `apps/desktop`.** Packages stay framework-free so they run in utility processes and plain Vitest. The renderer and `packages/ui` never import Node built-ins.
6. **Every user-facing string goes through Lingui** in `apps/renderer` and `packages/ui` (`<Trans>`, `t`, `msg`). Format dates, numbers, durations and sizes with `Intl`, never by hand.
7. **Every source file starts with the SPDX header** (below).
8. **Coverage of at least 80%** on `core`, `agent` and `tools`.

## How the code is written

- **Errors are values.** A function that can fail in a way its caller should handle returns `Result<T>` or `AsyncResult<T>` from `@taalcut/core`. Throw only for bugs.
- **Ids are branded ULIDs**, and media time is `RationalTime` (a value and a rate). Never store media timing as float seconds.
- **Every state change is a command** on the command bus. Buttons, shortcuts and the AI dispatch the same typed command, which is what gives undo, redo and the audit log.
- **AI tools wrap commands or read-only queries.** Each tool declares its schema, cost class, side-effect level, timeout and retry policy, and registers itself from its own package.
- **The GPU comes first** for decode, encode, filters, inference and drawing; the CPU is the fallback.
- **Nothing for the user to install.** Every runtime, model and binary ships inside the app or is downloaded by its component manager, checksummed.
- **Secrets stay in the OS keychain**, in the main process. Tokens never reach the renderer, the database or the logs.
- **Tests are Vitest**, in `<package>/test/` or beside the file as `*.test.ts`. AI tests replay recorded responses, so the checks run offline and cost nothing.
- **Formatting is Prettier** (`singleQuote`, width 110). Comments say why, in plain English.

## Sending a change

1. For anything larger than a fix, open an issue or a discussion first, so the work is wanted before you do it.
2. Branch from `main` in your fork, keep the change to one thing, and add or update the tests that show it.
3. Run `pnpm check`. A pull request with a failing check waits until it passes.
4. Open the pull request and fill in its template. Say what you tested by hand, and on which Mac, when the change touches media, models or packaging.

Changes to `packages/core` ripple through every package, so keep them small and in their own commit.

## SPDX header

Every source file starts with these two lines:

```ts
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors
```

`pnpm fix:spdx` adds them. `pnpm lint` includes the header check, so a file without the header fails the check. Markdown is not a source extension the checker looks at, so docs like this one do not get a header.

## UI strings and the string freeze

Taalcut supports English and uses it for automatic language selection, regardless of the Mac's language.
Contributors can explicitly select Hindi, Spanish or Brazilian Portuguese in the welcome or Settings → General →
Language. These incomplete translations carry **Draft translation** labels and remain available for review;
**Automatic · English** restores the default. Promotion requires completeness and native review of both
renderer and main catalogues; retaining the drafts is not a supported-language claim.

Every UI string for the renderer and `packages/ui` lives in one catalogue, `apps/renderer/src/locales/<locale>/messages.po`. `pnpm i18n:check` fails when:

- code has a string the catalogues do not (run `pnpm --filter @taalcut/renderer i18n:extract` and commit every `messages.po` it changes);
- a message has broken ICU syntax or misses a plural category CLDR requires for its locale (es and pt-BR need `many`);
- a translation's placeholders or `<0>` tags differ from the English source;
- a locale marked `signed-off` in `locales/status.json` has an untranslated message (`draft` and `in-review` only warn), or a translation still flagged `#, fuzzy` (a draft no native speaker has approved);
- a frozen English string changed or went away.

The released copy is frozen in `locales/frozen-ids.json`. **Adding a new string is fine**: extract and commit, nothing else. **Rewording or removing a frozen string** fails the check until you run `pnpm i18n:unfreeze` and commit `frozen-ids.json` in the same commit as the copy change. Unfreeze rewrites the whole manifest from the English catalogue, so it also freezes your new strings; review its diff, and say in the commit body why the copy changed (translators lose that string's translations).

The Mac's own words (the app menu, notifications, the macOS permission prompts) live in main's catalogue, `apps/desktop/src/main/i18n/locales/<locale>/messages.po`; `pnpm --filter @taalcut/desktop i18n:extract` updates and compiles it, and `i18n:check` checks it the same way.

Translations go out with `pnpm i18n:handoff <locale> --out <dir>` (both catalogues, the locale's glossary and a README for translators) and come back with `pnpm i18n:import --locale <locale> --from <dir>`. A draft translation carries gettext's `fuzzy` flag ("Needs work" in Poedit) until a native speaker approves it; the reviewer clears the flag, and the import takes the translation, the flag and the translator's `#` comments back.

Reviewers see each string in place: `TAALCUT_I18N_SCREENS=<dir> pnpm --filter @taalcut/renderer exec playwright test e2e/locales.spec.ts` saves every route in every app language, light and dark (`<dir>/<locale>/<theme>/<route>.png`). The same spec fails when text doesn't fit at 1024 × 720 or at the window's minimum (960 × 600), when English is left where a language has its own words, or when Hindi misses Noto Sans Devanagari. Fix what doesn't fit in the layout, never by shortening the English.

## Commits

Keep each commit to one logical change. Use a message like:

```text
Short summary of the change

Optional body: why the change was made, in plain sentences.
```

Commit messages carry **no AI attribution**: no `Co-Authored-By` lines naming an AI model or tool (Claude, GPT, Grok, Copilot or any other), no "Generated with" lines, and no AI tool as the author. Commits are authored by the human who owns the change.

## Contribution licence

Contributions are accepted under the same terms as the files they change: Taalcut's
original code uses AGPL-3.0-or-later with the [library combination permission](LICENSE-EXCEPTIONS.md).
You keep ownership of your contribution. Submit only work you have the right to license under those terms;
retain upstream attribution and licences for third-party work. Identify material with a different licence
in the pull request so it can be reviewed before inclusion.

[CLA.md](CLA.md) is an inactive draft for a possible future dual-licensing programme. No CLA signature is
required or collected. Submitting a contribution
under this policy does not grant a separate right to relicense it commercially. A later change of policy
must be explicit and does not retroactively change contributors' rights.

English is the supported language. Hindi, Spanish and Brazilian Portuguese remain draft catalogues;
translation and native review contributions are welcome through the handoff/import workflow above. Do not
mark a language signed off until both the renderer and native catalogues meet their checks and review.

## Name, logo, and React Bits

The name and the logo are not covered by the AGPL. Read [TRADEMARKS.md](TRADEMARKS.md) before you use either. The policy does not claim a trademark registration or completed clearance search.

React Bits is used inside the app and is not shipped as a component kit. The terms and the commit they were copied from are in [third_party/react-bits/README.md](third_party/react-bits/README.md).

The mascot's sprite stage comes from page-mascot (MIT), vendored the same way: see [third_party/page-mascot/README.md](third_party/page-mascot/README.md).

`pnpm notice` regenerates `NOTICE`. `pnpm licence:scan` still runs the allowlist and writes the same file. Run either when dependencies change. The scan's allowlist lives with that script, not in this file.
