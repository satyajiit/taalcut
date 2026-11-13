<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->

# The test signer (test issuer, not publicly trusted)

`taalcut-c2pa` signs every export with the C2PA SDK's **ES256 test certificate**. It is a TEST issuer, not
publicly trusted: validators report the manifest as `Valid` with `signingCredential.untrusted`, never `Trusted`,
and Inspect says it can't recognise the issuer. A publicly trusted claim-signing certificate now needs the C2PA
conformance programme for the product (render SPEC P3.18-2; PO decision). Nothing here is a secret: the key is
published with the SDK's tests.

| File | Source (contentauth/c2pa-rs, tag `c2pa-v0.91.2`) | sha256 |
| --- | --- | --- |
| `es256.pub` (signing certificate, then the intermediate CA) | https://raw.githubusercontent.com/contentauth/c2pa-rs/c2pa-v0.91.2/sdk/tests/fixtures/certs/es256.pub | `2bf499037fd1fa7d803e3052c7b4ef6a0e67564aa2b805c0d7ae64d25a13c07b` |
| `es256.pem` (its PKCS#8 private key) | https://raw.githubusercontent.com/contentauth/c2pa-rs/c2pa-v0.91.2/sdk/tests/fixtures/certs/es256.pem | `f547ec8dbf24e50b51cf9924e58c250d246ed8844304408a072801fcf70a95d7` |

Subject `CN=C2PA Signer, OU=FOR TESTING_ONLY, O=C2PA Test Signing Cert`, issuer `CN=Intermediate CA, O=C2PA Test
Intermediate Root CA`, valid 2022-06-10 to 2030-08-26 (checked with `openssl x509` on 2026-10-14). Both files
are licensed with the SDK, MIT OR Apache-2.0 (`../LICENSES/`). No time-stamp authority is used: exports are
signed offline.
