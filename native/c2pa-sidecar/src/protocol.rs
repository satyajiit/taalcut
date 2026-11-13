// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

//! JSON-lines framing (mac helper SPEC, "Protocol v1"): request parsing, responses, the ready line.

use serde_json::{json, Value};

pub const PROTOCOL: u32 = 1;
/// The c2pa crate this binary is built on; the TypeScript side checks it from the ready line.
pub const C2PA_VERSION: &str = "0.91.2";

/// An error a request answers with. `message` is developer text: never a path, never user content.
#[derive(Debug)]
pub struct SidecarError {
    pub code: &'static str,
    pub message: String,
    pub retryable: bool,
}

impl SidecarError {
    pub fn new(code: &'static str, message: impl Into<String>) -> Self {
        Self { code, message: truncate(&message.into(), 300), retryable: false }
    }

    pub fn retryable(code: &'static str, message: impl Into<String>) -> Self {
        Self { retryable: true, ..Self::new(code, message) }
    }
}

pub enum Incoming {
    Request { id: String, method: String, params: Value },
    Cancel,
}

/// A request line, or the error to answer it with when its id is readable (else `None`: drop the line).
pub fn parse(line: &str) -> Result<Incoming, Option<(String, SidecarError)>> {
    let value: Value = serde_json::from_str(line).map_err(|_| None)?;
    let id = value.get("id").and_then(Value::as_str).filter(|id| !id.is_empty() && id.len() <= 64);
    match value.get("type").and_then(Value::as_str) {
        Some("cancel") => Ok(Incoming::Cancel),
        Some("request") => {
            let id = id.ok_or(None)?.to_string();
            let Some(method) = value.get("method").and_then(Value::as_str) else {
                return Err(Some((id, SidecarError::new("helper.bad_request", "no method"))));
            };
            let params = value.get("params").cloned().unwrap_or(Value::Object(Default::default()));
            Ok(Incoming::Request { id, method: method.to_string(), params })
        }
        _ => Err(None),
    }
}

pub fn response(id: &str, result: Result<Value, SidecarError>) -> String {
    match result {
        Ok(result) => json!({ "type": "response", "id": id, "ok": true, "result": result }).to_string(),
        Err(error) => json!({
            "type": "response",
            "id": id,
            "ok": false,
            "error": { "code": error.code, "message": error.message, "retryable": error.retryable },
        })
        .to_string(),
    }
}

pub fn version_value() -> Value {
    json!({ "version": env!("CARGO_PKG_VERSION"), "protocol": PROTOCOL, "c2pa": C2PA_VERSION })
}

pub fn version_line() -> String {
    version_value().to_string()
}

pub fn ready_line() -> String {
    json!({
        "type": "ready",
        "protocol": PROTOCOL,
        "version": env!("CARGO_PKG_VERSION"),
        "services": ["c2pa"],
        "c2pa": C2PA_VERSION,
        "signer": "test",
    })
    .to_string()
}

/// At most `max` characters of untrusted text (manifest strings, method names).
pub fn truncate(text: &str, max: usize) -> String {
    text.chars().take(max).collect()
}

/// A string parameter, or `helper.bad_request`.
pub fn string_param<'a>(params: &'a Value, name: &str) -> Result<&'a str, SidecarError> {
    params
        .get(name)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| SidecarError::new("helper.bad_request", format!("missing '{name}'")))
}

/// An SDK error's variant name only: its Display text can carry details from the file or a path.
pub fn sdk_error_name(error: &c2pa::Error) -> String {
    let debug = format!("{error:?}");
    debug.split(|c: char| !c.is_ascii_alphanumeric()).next().unwrap_or("Error").to_string()
}
