# Taalcut template hub

Creators share the structure of a template here. A template is slots, timing, intents and an optional look. It is not the footage, the words on screen, or a link.

Taalcut's Share action sends the document to a small Worker. The Worker opens a pull request. A maintainer reviews it. After it merges, this repository's publish workflow builds a static index and GitHub Pages serves it. You can also export the same JSON and open the pull request yourself. The checks are the same either way.

## Licences

`templates/` is CC0-1.0. See `LICENSE-DATA`.

Scripts, tests and `.github/` are AGPL-3.0-or-later. See `LICENSE`.

## Layout

`templates/<first two characters of the id>/<id>.json` is one template. `moderation/hidden.json` lists templates left out of the index. `schema/` is the JSON Schema of a template and of the index, and the content rules. The Taalcut app generates these files from its own schema (`pnpm --filter @taalcut/templates hub:schema:export`), so the app, the Worker and this CI check the same things. Don't edit them by hand. `scripts/validate.mjs` checks a pull request. `scripts/build-index.mjs` writes `site/v0/` and refuses to publish a template that fails those checks. `scripts/moderate.mjs` hides or restores one id.

## Review

`CODEOWNERS` asks `@taalcut/maintainers` to review every change. The `validate` workflow runs the validator and schema from the base branch, never from the pull request. The pull request checklist is the maintainer's.

## Hide and restore

One label does it. A report issue carries `hub:<hubId>`. Adding `hidden` appends that id to `moderation/hidden.json`, commits, and publishes the index again. Removing `hidden` restores it the same way. A template nobody reported can be hidden or restored with the `moderate` workflow's `hubId` and `action` inputs.

The Worker then refuses new ratings for that id and drops it from the ratings aggregate. Copies people already forked stay in their libraries. Those copies are CC0.

## Develop

```
npm install
npm test
node scripts/validate.mjs
node scripts/build-index.mjs --now 0
```

`ajv` and `ajv-formats` are the only runtime dependencies, pinned in `package.json`.
