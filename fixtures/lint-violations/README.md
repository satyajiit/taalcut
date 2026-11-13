# Lint violation fixtures

These files each break one architecture rule. They stay in this folder so `pnpm lint` stays green:

- ESLint ignores `fixtures/lint-violations/**`
- dependency-cruiser excludes `^fixtures/lint-violations/`
- `scripts/check-spdx.mjs` skips `^fixtures/lint-violations/`

`node scripts/check-lint-fixtures.mjs` copies each fixture to a path the real config covers, runs ESLint, dependency-cruiser, or the SPDX check, asserts the failure, and deletes the copy.

| Fixture                                 | Copied to                                                                      | Rule                                                                 |
| --------------------------------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------- |
| `max-lines/over-400.ts`                 | `packages/core/src/__lint_fixture_max_lines.ts`                                | ESLint `max-lines`                                                   |
| `deep-import/deep.ts`                   | `packages/agent/src/__lint_fixture_deep.ts`                                    | ESLint `no-restricted-imports`, dependency-cruiser `public-api-only` |
| `deep-import/hub-deep.ts`               | `packages/agent/src/__lint_fixture_hub_deep.ts`                                | The same two rules for a file behind core's `@taalcut/core/hub` entry |
| `deep-import/hub-entry.ts`              | `packages/agent/src/__lint_fixture_hub_entry.ts`                               | None: the control; `@taalcut/core/hub` itself passes both tools      |
| `import-cycle/cycle-a.ts`, `cycle-b.ts` | `packages/tools/src/__lint_fixture_cycle_a.ts` and `__lint_fixture_cycle_b.ts` | dependency-cruiser `no-circular`                                     |
| `layering/layer.ts`                     | `packages/core/src/__lint_fixture_layer.ts`                                    | dependency-cruiser `layering-core`                                   |
| `provider-sdk/sdk.ts`                   | `packages/agent/src/__lint_fixture_sdk.ts`                                     | ESLint `no-restricted-imports`                                       |
| `node-builtin/node.ts`                  | `apps/renderer/src/__lint_fixture_node.ts`                                     | dependency-cruiser `sandboxed-code-has-no-node`                      |
| `hardcoded-string/string.tsx`           | `apps/renderer/src/__lint_fixture_string.tsx`                                  | ESLint `lingui/no-unlocalized-strings`                               |
| `electron-launch/launch.ts`             | `apps/desktop/e2e/__lint_fixture_launch.ts`                                    | ESLint `no-restricted-imports`, `no-restricted-syntax`               |
| `missing-spdx/no-header.ts`             | a temp file outside the repo                                                   | `scripts/check-spdx.mjs`                                             |

Relative imports are written for the copy destination, not for this folder. The cycle files import `./__lint_fixture_cycle_a` and `./__lint_fixture_cycle_b`, which exist only after the copy.
