// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

//! The SDK context every request uses. Nothing here reaches the network: no remote manifests, no OCSP fetch,
//! no timestamp authority (an export is signed offline). Trust is still checked, against an empty trust list,
//! so the test issuer reads as `signingCredential.untrusted` (state `Valid`, never `Trusted`).

use std::sync::Arc;

use c2pa::{Context, Settings};

const SETTINGS: &str = r#"{
  "verify": {
    "remote_manifest_fetch": false,
    "ocsp_fetch": false
  }
}"#;

pub fn reading_context() -> c2pa::Result<Arc<Context>> {
    let settings = Settings::new().with_json(SETTINGS)?;
    Ok(Context::new().with_settings(settings)?.into_shared())
}
