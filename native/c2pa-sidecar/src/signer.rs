// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

//! The only signer v1 ships: the C2PA SDK's ES256 test certificate (certs/README.md says where it came from).
//! It is a TEST issuer, not publicly trusted: validators report the manifest `Valid` with
//! `signingCredential.untrusted`. A publicly trusted claim-signing certificate needs the C2PA conformance
//! programme (render SPEC P3.18-2).

use c2pa::{create_signer, BoxedSigner, SigningAlg};

const CERT_CHAIN: &[u8] = include_bytes!("../certs/es256.pub");
const PRIVATE_KEY: &[u8] = include_bytes!("../certs/es256.pem");

pub fn test_signer() -> c2pa::Result<BoxedSigner> {
    // No time-stamp authority: signing happens offline at export.
    create_signer::from_keys(CERT_CHAIN, PRIVATE_KEY, SigningAlg::Es256, None)
}
