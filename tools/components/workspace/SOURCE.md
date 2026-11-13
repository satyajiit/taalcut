# Workspace CLI corresponding source

Component `hyperframes-cli/0.8.209-1` uses upstream HyperFrames 0.8.209. Its npm release identifies commit
`53c975966611e7012b09b6d46707c26511ea077d` in `heygen-com/hyperframes`. The hosted repository archive contains
the preferred TypeScript sources for both CLI and engine, their manifests, build scripts and `bun.lock`.
Both package manifests at that commit declare 0.8.209. The separately hosted engine npm archive is the exact
emitted-JavaScript input used by Taalcut's patching recipe; it is not the only source offered.

The generated component notice links these immutable archives and their SHA-256 hashes. The Taalcut source
archive contains this directory, `hyperframes-cli.lock.json`, the exact app engine patch, packing helpers,
licences and the section 7 additional permission. The lock records every upstream npm tarball by URL, size and
SHA-256, including the CLI package. No npm lifecycle script runs during Taalcut's component build.

To reproduce the distributed component from the Taalcut source archive, use Node 24 on macOS arm64, the system
`tar` and `patch` tools, and zstd 1.5.7, then run from the extracted repository-shaped source root:

```sh
node tools/components/workspace/pack.mjs --component hyperframes-cli --out ./out --platform darwin-arm64
```

The recipe downloads and checks the locked packages, applies the exact hash-pinned app patch to the engine
input, and ports the complete self-contained drawElement service plus paint-timeout classification into the
known-hash CLI bundle. A changed input or patch fails before packing. It syntax-checks the result, runs the CLI's
version command, preserves upstream notices and records input/output hashes in `PATCH-PROVENANCE.json`.
It adds the source-available loopback preload and command shims. The resulting unsigned development archive can
be tested without Taalcut's private signing credentials. To distribute a Developer ID build, supply your own
`TAALCUT_MAC_IDENTITY` and use the normal Apple notarization workflow; timestamps change signed archive hashes.

To change the upstream TypeScript itself, extract the pinned upstream repository archive and use its documented
`bun install --frozen-lockfile` and `bun run build` workflow. The engine's build runs TypeScript and the repository's
relative-import rewrite; the CLI's build runs its font build, tsup, runtime build and copy scripts. Update the
reviewed input hashes and patch for your resulting package before repacking. The unmodified published packages
remain the inputs for reproducing Taalcut's recorded revision.

Only drawElement capture and recoverable paint timeouts are ported from the app engine. Its separate browser,
process-tracking and encoder patches are not silently applied to this CLI. Taalcut runs the CLI inside the
workspace Seatbelt profile; frame correctness and that sandbox route are verified with real renders.

Upstream HyperFrames and its original code retain Apache-2.0 and their existing notices. Taalcut additions use
AGPL-3.0-or-later with `LICENSE-EXCEPTIONS.md`. The unchanged vendored GSAP 3.15.0 files retain their copyright
headers and GSAP Standard License; that library is not relicensed by Taalcut.
