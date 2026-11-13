// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

//! `c2pa.sign { input, output, manifest, ingredients }`: signs a progressive MP4 into a new file with the test
//! signer. The SDK writes the `uuid` manifest box after `ftyp` and the `c2pa.hash.bmff` hard binding; Taalcut
//! never builds the box itself. Sources that carry their own manifest come in as ingredients read from their
//! files, so their stores travel with the export. Answers with the read summary of the signed file.

use std::{
    fs::{self, File, OpenOptions},
    path::PathBuf,
    sync::Arc,
};

use c2pa::{Builder, Context};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::{
    paths::{media_type, AllowedRoots},
    protocol::{sdk_error_name, SidecarError},
    read, signer,
};

const RELATIONSHIPS: [&str; 3] = ["parentOf", "componentOf", "inputTo"];
const MAX_INGREDIENTS: usize = 64;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SignRequest {
    input: String,
    output: String,
    manifest: Value,
    #[serde(default)]
    ingredients: Vec<IngredientFile>,
}

/// A source file whose own Content Credentials join the export as an ingredient.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct IngredientFile {
    path: String,
    /// 'clip 3', 'voiceover', 'music': never a file name.
    title: String,
    relationship: String,
    /// What the manifest's actions name it by (`parameters.ingredientIds`).
    #[serde(default)]
    label: Option<String>,
}

fn bad_request(message: &str) -> SidecarError {
    SidecarError::new("helper.bad_request", message)
}

fn valid_label(label: &str) -> bool {
    !label.is_empty()
        && label.len() <= 64
        && label.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}

fn check(ingredient: &IngredientFile) -> Result<(), SidecarError> {
    if !RELATIONSHIPS.contains(&ingredient.relationship.as_str()) {
        return Err(bad_request("unknown ingredient relationship"));
    }
    let title = ingredient.title.trim();
    if title.is_empty() || title.chars().count() > 120 {
        return Err(bad_request("ingredient title must be 1 to 120 characters"));
    }
    if ingredient.label.as_deref().is_some_and(|label| !valid_label(label)) {
        return Err(bad_request("bad ingredient label"));
    }
    Ok(())
}

fn builder_for(request: &SignRequest, roots: &AllowedRoots, context: &Arc<Context>) -> Result<Builder, SidecarError> {
    if !request.manifest.is_object() {
        return Err(SidecarError::new("c2pa.invalid_manifest", "the manifest must be an object"));
    }
    let mut builder = Builder::from_shared_context(context)
        .with_definition(request.manifest.to_string())
        .map_err(|error| SidecarError::new("c2pa.invalid_manifest", sdk_error_name(&error)))?;
    if request.ingredients.len() > MAX_INGREDIENTS {
        return Err(bad_request("too many ingredients"));
    }
    for ingredient in &request.ingredients {
        check(ingredient)?;
        let path = roots.existing(&ingredient.path)?;
        let format = media_type(&path)?;
        let mut file = File::open(&path).map_err(|_| SidecarError::new("c2pa.unreadable", "can't open an ingredient"))?;
        let mut definition = json!({ "title": ingredient.title.trim(), "relationship": ingredient.relationship });
        if let Some(label) = &ingredient.label {
            definition["label"] = json!(label);
        }
        builder
            .add_ingredient_from_stream(definition.to_string(), format, &mut file)
            .map_err(|error| SidecarError::new("c2pa.unreadable", format!("ingredient: {}", sdk_error_name(&error))))?;
    }
    Ok(builder)
}

pub fn handle(params: &Value, roots: &AllowedRoots, context: &Arc<Context>) -> Result<Value, SidecarError> {
    let request: SignRequest =
        serde_json::from_value(params.clone()).map_err(|_| bad_request("bad sign request"))?;
    let input = roots.existing(&request.input)?;
    let output = roots.writable(&request.output)?;
    if input == output {
        return Err(bad_request("output must be a new file"));
    }
    let format = media_type(&input)?;
    let mut builder = builder_for(&request, roots, context)?;
    let signer = signer::test_signer().map_err(|error| SidecarError::new("c2pa.sign_failed", sdk_error_name(&error)))?;
    let part = PathBuf::from(format!("{}.part", output.display()));
    let signed = (|| -> Result<(), SidecarError> {
        let mut source = File::open(&input).map_err(|_| SidecarError::new("c2pa.unreadable", "can't open the input"))?;
        let mut dest = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(true)
            .open(&part)
            .map_err(|_| SidecarError::retryable("c2pa.sign_failed", "can't write the output"))?;
        builder
            .sign(signer.as_ref(), format, &mut source, &mut dest)
            .map_err(|error| SidecarError::new("c2pa.sign_failed", sdk_error_name(&error)))?;
        dest.sync_all().map_err(|_| SidecarError::retryable("c2pa.sign_failed", "can't flush the output"))?;
        Ok(())
    })();
    if let Err(error) = signed {
        let _ = fs::remove_file(&part);
        return Err(error);
    }
    fs::rename(&part, &output).map_err(|_| SidecarError::retryable("c2pa.sign_failed", "can't move the output into place"))?;
    read::summarize(&output, context)
}
