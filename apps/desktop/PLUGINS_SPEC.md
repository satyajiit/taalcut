# Plugin composition (PLUGINS-1)

Main binds `PluginServiceToken` once using the existing settings store and safeStorage
vault. Providers are trusted, injected definitions; Postiz is the first. Runtime state
and data are namespaced by plugin and credentials stay in main. Local-only is checked
against persisted privacy settings before remote activity, including connection tests.

The renderer gets metadata through `plugins` and credential presence through
`pluginsSetup`. Credential import reads the system clipboard in main, writes directly
to the vault and clears it after success only if the clipboard is still unchanged.
Neither RPC output nor commands carry the key. Unknown plugins never read the clipboard.

The agent utility receives the privileged service RPC without any vault API. Its plugin
tools run through existing approval, consent, privacy and audit machinery. Human-only
commands control configuration, access, activation and disconnect. The AI may request
setup and return the dedicated `/settings/plugins/$pluginId` route.

Postiz supports hosted and self-hosted instances, including Tailscale hostnames and
private addresses. API and MCP targets are pinned to the chosen instance. Redirects
cannot forward credentials. Self-hosted instances without MCP retain REST capabilities.
Local-only command events immediately suspend live streams and active requests; a later
call reconnects only when persisted privacy settings permit it.

Acceptance: router tests exercise real RPC and prove credentials never return to windows;
runtime tests cover independent state, permission enforcement and target validation;
utility tests prove the plugin module and commands are present in actual composition.

Manual read-only check: the existing Tailscale Postiz deployment authenticated, returned
its MCP catalogue and served channel listing through the new runtime. The temporary
runtime used memory-only settings; no live content was created, changed or deleted.
