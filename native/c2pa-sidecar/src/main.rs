// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

//! taalcut-c2pa: Taalcut's Content Credentials sidecar (render SPEC P3.3).
//!
//! Speaks the mac helper's JSON-lines protocol v1 on stdio: a `ready` line first, then exactly one
//! `response` per `request`. Requests run one at a time; signing a short-form export takes well under a
//! second, so a `cancel` line is accepted and ignored. Every path must sit under a `--allow-root`.

mod paths;
mod protocol;
mod read;
mod settings;
mod sign;
mod signer;

use std::io::{self, BufRead, Write};

use paths::AllowedRoots;
use protocol::{Incoming, SidecarError};

/// The protocol's frame limit (mac helper SPEC, "Framing").
const MAX_LINE_BYTES: usize = 4 * 1024 * 1024;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.iter().any(|arg| arg == "--version") {
        println!("{}", protocol::version_line());
        return;
    }
    let roots = match AllowedRoots::from_args(&args) {
        Ok(roots) => roots,
        Err(message) => {
            eprintln!("[c2pa] {message}");
            std::process::exit(2);
        }
    };
    let context = match settings::reading_context() {
        Ok(context) => context,
        Err(error) => {
            eprintln!("[c2pa] settings: {error}");
            std::process::exit(3);
        }
    };
    let stdout = io::stdout();
    let mut out = stdout.lock();
    if writeln!(out, "{}", protocol::ready_line()).and_then(|_| out.flush()).is_err() {
        return;
    }
    let stdin = io::stdin();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        if line.len() > MAX_LINE_BYTES {
            eprintln!("[c2pa] dropped a line over {MAX_LINE_BYTES} bytes");
            continue;
        }
        let reply = match protocol::parse(&line) {
            Ok(Incoming::Cancel) => continue,
            Ok(Incoming::Request { id, method, params }) => {
                let result = dispatch(&method, &params, &roots, &context);
                protocol::response(&id, result)
            }
            Err(Some((id, error))) => protocol::response(&id, Err(error)),
            Err(None) => {
                eprintln!("[c2pa] dropped a line that isn't a request");
                continue;
            }
        };
        if writeln!(out, "{reply}").and_then(|_| out.flush()).is_err() {
            break;
        }
    }
}

fn dispatch(
    method: &str,
    params: &serde_json::Value,
    roots: &AllowedRoots,
    context: &std::sync::Arc<c2pa::Context>,
) -> Result<serde_json::Value, SidecarError> {
    match method {
        "c2pa.read" => read::handle(params, roots, context),
        "c2pa.sign" => sign::handle(params, roots, context),
        "version" => Ok(protocol::version_value()),
        other => Err(SidecarError::new(
            "helper.unknown_method",
            format!("no method '{}'", protocol::truncate(other, 64)),
        )),
    }
}
