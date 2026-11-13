# @taalcut/hub-worker

Private Cloudflare Worker for hub submissions, ratings and reports (docs/template-hub.md section 4). Never deployed
from this repository; the runbook in docs/template-hub.md covers the account, D1 and secrets.

- `src/index.ts` is the composition root: it checks the configuration (`src/config/env.ts`; a missing or malformed
  secret is 503 `hub.not_configured`), builds each request's dependencies and dispatches to the route modules. The
  per-isolate caches (installation token, pull request states, the hidden list) are made there.
- Hidden templates are the hub repository's `moderation/hidden.json` on `main`, read through the GitHub App and
  cached five minutes (`src/moderation/hidden-ids.ts`). The D1 tables hold no copy.
- Daily caps take a unit with one conditional upsert (`src/store/d1-days.ts`), so concurrent requests can't both
  pass the last slot. Reports also have a global daily cap: install keys cost nothing to make.

`wrangler.jsonc` sets `compatibility_date` `2026-10-13`: the newest date the pinned workerd `1.20261006.1` (wrangler
`4.150.0`, miniflare `5.20261006.2-beta`, `@cloudflare/vitest-plugin` `1.4.1`) runs. It says "the newest date
supported by this server binary is 2026-10-13" for anything later, so the Workers test project boots the very
configuration that deploys, without an override. Raise the date when those pins move.

Tests are offline. The node project runs every route against a real SQLite database (Node's `node:sqlite`, which is
what D1 is) loaded from `migrations/`, a `GitHubPort` fake, and recorded GitHub REST fixtures for the REST client
and the token exchange. The Workers project boots the Worker in Miniflare with D1 and placeholder secrets;
`remoteBindings` is off, so it never contacts Cloudflare, and it sets `fsModuleCache` to false because workerd's
`node:fs` can't read Vitest's host cache file. Vitest stays at `5.0.4`; `@cloudflare/vitest-plugin` `1.4.1` loads
under it.
