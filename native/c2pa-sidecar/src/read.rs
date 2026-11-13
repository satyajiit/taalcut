// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

//! `c2pa.read { path }`: a summary of a file's Content Credentials. Every string from the manifest is
//! untrusted and truncated; nothing echoes a path.

use std::{fs::File, path::Path, sync::Arc};

use c2pa::{validation_results::ValidationState, Context, Error, Manifest, Reader};
use serde_json::{json, Value};

use crate::{
    paths::{media_type, AllowedRoots},
    protocol::{sdk_error_name, string_param, truncate, SidecarError},
};

const MAX_LIST: usize = 32;
const MAX_TEXT: usize = 120;

pub fn handle(params: &Value, roots: &AllowedRoots, context: &Arc<Context>) -> Result<Value, SidecarError> {
    let path = roots.existing(string_param(params, "path")?)?;
    summarize(&path, context)
}

pub fn summarize(path: &Path, context: &Arc<Context>) -> Result<Value, SidecarError> {
    let format = media_type(path)?;
    let mut file = File::open(path).map_err(|_| SidecarError::new("c2pa.unreadable", "can't open the file"))?;
    match Reader::from_shared_context(context).with_stream(format, &mut file) {
        Ok(reader) => Ok(summary_of(&reader)),
        Err(Error::JumbfNotFound | Error::ProvenanceMissing | Error::JumbfBoxNotFound) => Ok(absent()),
        Err(Error::IoError(_) | Error::UnsupportedType | Error::FileNotFound(_)) => {
            Err(SidecarError::new("c2pa.unreadable", "can't read the file"))
        }
        // A store that is there but can't be parsed or verified is an invalid manifest, not a read error.
        Err(other) => Ok(json!({
            "state": "invalid",
            "generator": null,
            "issuer": null,
            "digitalSourceTypes": [],
            "actions": [],
            "actionsV2": false,
            "ingredients": 0,
            "ingredientDetails": [],
            "failures": [truncate(&format!("sdk.{}", sdk_error_name(&other)), MAX_TEXT)],
        })),
    }
}

fn absent() -> Value {
    json!({
        "state": "absent",
        "generator": null,
        "issuer": null,
        "digitalSourceTypes": [],
        "actions": [],
        "actionsV2": false,
        "ingredients": 0,
        "ingredientDetails": [],
        "failures": [],
    })
}

fn state_name(state: ValidationState) -> &'static str {
    match state {
        ValidationState::Trusted => "trusted",
        ValidationState::Valid => "valid",
        ValidationState::Invalid => "invalid",
    }
}

fn generator(manifest: &Manifest) -> Option<String> {
    let info = manifest.claim_generator_info.as_ref().and_then(|list| list.first());
    let text = match info {
        Some(info) => match &info.version {
            Some(version) => format!("{} {}", info.name, version),
            None => info.name.clone(),
        },
        None => manifest.claim_generator()?.to_string(),
    };
    Some(truncate(&text, MAX_TEXT))
}

/// Action labels and their digital source types, from every actions assertion of the manifest.
fn actions(manifest: &Manifest) -> (Vec<String>, Vec<String>, bool) {
    let mut labels = Vec::new();
    let mut sources = Vec::new();
    let mut v2 = false;
    for assertion in manifest.assertions() {
        if !assertion.label().starts_with("c2pa.actions") {
            continue;
        }
        v2 |= assertion.label() == "c2pa.actions.v2";
        let Ok(value) = assertion.value() else { continue };
        for action in value.get("actions").and_then(Value::as_array).into_iter().flatten() {
            if let Some(label) = action.get("action").and_then(Value::as_str) {
                labels.push(truncate(label, MAX_TEXT));
            }
            if let Some(source) = action.get("digitalSourceType").and_then(Value::as_str) {
                let source = truncate(source, 200);
                if !sources.contains(&source) {
                    sources.push(source);
                }
            }
        }
    }
    labels.truncate(MAX_LIST);
    sources.truncate(8);
    (labels, sources, v2)
}

/// Failure codes of the active manifest and of its ingredients, de-duplicated.
fn failures(reader: &Reader) -> Vec<String> {
    let mut codes: Vec<String> = Vec::new();
    let mut push = |code: &str| {
        let code = truncate(code, MAX_TEXT);
        if !codes.contains(&code) {
            codes.push(code);
        }
    };
    if let Some(results) = reader.validation_results() {
        for status in results.active_manifest().map(|codes| codes.failure().as_slice()).unwrap_or(&[]) {
            push(status.code());
        }
        for delta in results.ingredient_deltas().map(Vec::as_slice).unwrap_or(&[]) {
            for status in delta.validation_deltas().failure() {
                push(status.code());
            }
        }
    } else if let Some(statuses) = reader.validation_status() {
        for status in statuses {
            push(status.code());
        }
    }
    codes.truncate(MAX_LIST);
    codes
}

/// Each ingredient's relationship and whether it carried its own manifest (titles stay out: untrusted).
fn ingredient_details(manifest: &Manifest) -> Vec<Value> {
    manifest
        .ingredients()
        .iter()
        .take(MAX_LIST)
        .map(|ingredient| {
            let relationship = serde_json::to_value(ingredient.relationship()).unwrap_or(Value::Null);
            json!({ "relationship": relationship, "hasManifest": ingredient.active_manifest().is_some() })
        })
        .collect()
}

fn summary_of(reader: &Reader) -> Value {
    let Some(manifest) = reader.active_manifest() else {
        return absent();
    };
    let (labels, sources, v2) = actions(manifest);
    json!({
        "state": state_name(reader.validation_state()),
        "generator": generator(manifest),
        "issuer": manifest.issuer().map(|issuer| truncate(&issuer, MAX_TEXT)),
        "digitalSourceTypes": sources,
        "actions": labels,
        "actionsV2": v2,
        "ingredients": manifest.ingredients().len(),
        "ingredientDetails": ingredient_details(manifest),
        "failures": failures(reader),
    })
}
