# Security policy

Do not file a public issue, discussion, or pull request for a vulnerability.

## Reporting

Open a private advisory on GitHub:

https://github.com/satyajiit/taalcut/security/advisories/new

If that form is not available to you, write to <admin@matterwardlabs.com> with `SECURITY` in the subject.

In the report, name the surface, the app version (Settings → About), and the impact. Put reproduction detail only in that report.

## What this covers

Taalcut is a local-first macOS Electron app. Reports about the following are in scope.

- **The Electron app** (`apps/desktop`, `apps/renderer`). The renderer is sandboxed, context isolation is on, and the renderer does not get Node. How the desktop shell is locked down is recorded in [apps/desktop/SECURITY.md](apps/desktop/SECURITY.md).
- **IPC** between the main process, the preload script, the sandboxed renderer, and the utility processes. The only raw channel a page can use is `taalcut:rpc-connect`; main's own port hand-offs to the preload script and to utility processes are not reachable from a page. Later calls go over a port as oRPC, and both sides check them against the zod contracts. A utility process receives its port from main, at fork.
- **The LAN import server** (`packages/transfer`). While a phone-import session is open, it listens on one private or link-local IPv4 address chosen in `packages/transfer/src/network.ts`. It does not bind `0.0.0.0`. `apps/desktop` runs that server in a utility process.
- **The MCP server** (`packages/tools/src/mcp`, hosted by `apps/desktop` in its own utility process). It is
  implemented, off by default, and listens only on `127.0.0.1` while enabled. The `taalcut mcp` stdio shim connects
  to that listener. Requests pass Host/Origin checks and authenticate with a session bearer token; main keeps
  the token in the keychain vault, while the session store contains its hash. Reports about authentication,
  session permissions, approvals, tool execution or unintended network exposure are in scope.
- **The update feed and updater** (`apps/desktop/src/main/update/`). Packaged builds use `electron-updater`'s generic provider and Electron's native autoUpdater. The feed URL is https and is baked in at package time (`apps/desktop/packaging/build-settings.ts`). The channel file is `latest-mac.yml`, or `<channel>-mac.yml` when a channel is baked (`apps/desktop/src/main/update/feed.ts`). An unpackaged dev run does not update. A release build does not take a feed URL from the command line.
- **Signed component manifests** (`tools/components`, checked in `packages/jobs` before a download). The signature is Ed25519 over a canonical payload. Builds pin the release key, whose private half is in the owner's keychain and nowhere in the repository. The development key's private half is committed for tests and is never pinned; a packaged release build refuses to start the component manager if it ever is.

## Supported versions

Security fixes go into the newest release on the [releases page](https://github.com/satyajiit/taalcut/releases). Earlier releases are not patched; development builds made from source are not supported releases.

## Response targets

These are targets, not a contract.

- Acknowledge a report within 3 business days.
- Assess it within 7 days.
- For a high or critical issue, ship a fix or a mitigation within 30 days, or publish an advisory that explains the delay.

## Out of scope

- Social-engineering of maintainers.
- The footage on the reporter's own machine.
- A third-party model provider's own cloud. A bug in Taalcut's use of a provider is in scope. The provider's service is not.
