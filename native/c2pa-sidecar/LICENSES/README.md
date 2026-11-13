<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# Licences shipped with the `c2pa-sidecar` component

- `taalcut-c2pa` itself: AGPL-3.0-or-later (Taalcut contributors).
- The `c2pa` crate 0.91.2 (Adobe and the Content Authenticity Initiative), statically linked:
  `MIT OR Apache-2.0`. Both texts are here, taken from https://github.com/contentauth/c2pa-rs at tag
  `c2pa-v0.91.2`: `c2pa-LICENSE-MIT`, `c2pa-LICENSE-APACHE`.
- The SDK's ES256 test certificate and key (`../certs/`), MIT OR Apache-2.0 with the SDK.
- The crate's own dependencies are listed with their licences by `cargo tree --edges normal -f '{p} {l}'`
  (the release lane folds them into NOTICE).
