// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

//! `--allow-root`: every path a request names is resolved (symlinks included) and refused outside the roots
//! main passes, like the mac helper's `helper.path_not_allowed`.

use std::path::{Path, PathBuf};

use crate::protocol::SidecarError;

pub struct AllowedRoots {
    roots: Vec<PathBuf>,
}

impl AllowedRoots {
    pub fn from_args(args: &[String]) -> Result<Self, String> {
        let mut roots = Vec::new();
        let mut index = 0;
        while index < args.len() {
            match args[index].as_str() {
                "--allow-root" => {
                    let dir = args.get(index + 1).ok_or("--allow-root needs a directory")?;
                    let canonical = std::fs::canonicalize(dir)
                        .map_err(|_| "an --allow-root directory doesn't exist".to_string())?;
                    roots.push(canonical);
                    index += 2;
                }
                "serve" => index += 1,
                _ => return Err("unknown argument".to_string()),
            }
        }
        if roots.is_empty() {
            return Err("at least one --allow-root is required".to_string());
        }
        Ok(Self { roots })
    }

    fn inside(&self, path: &Path) -> bool {
        self.roots.iter().any(|root| path.starts_with(root))
    }

    /// An existing file under a root.
    pub fn existing(&self, path: &str) -> Result<PathBuf, SidecarError> {
        let canonical = std::fs::canonicalize(path)
            .map_err(|_| SidecarError::new("c2pa.unreadable", "file not found"))?;
        if !self.inside(&canonical) {
            return Err(not_allowed());
        }
        Ok(canonical)
    }

    /// A file to write: its folder must exist under a root, and the name must be a plain file name.
    pub fn writable(&self, path: &str) -> Result<PathBuf, SidecarError> {
        let path = Path::new(path);
        let name = path.file_name().ok_or_else(not_allowed)?;
        let parent = path.parent().filter(|parent| !parent.as_os_str().is_empty()).ok_or_else(not_allowed)?;
        let folder = std::fs::canonicalize(parent).map_err(|_| not_allowed())?;
        if !self.inside(&folder) {
            return Err(not_allowed());
        }
        let target = folder.join(name);
        // An existing symlink at the target could point outside the roots.
        if target.symlink_metadata().map(|meta| meta.file_type().is_symlink()).unwrap_or(false) {
            return Err(not_allowed());
        }
        Ok(target)
    }
}

fn not_allowed() -> SidecarError {
    SidecarError::new("helper.path_not_allowed", "path outside every allowed root")
}

/// The MIME type c2pa reads a file as, from its extension (exports are progressive MP4).
pub fn media_type(path: &Path) -> Result<&'static str, SidecarError> {
    let extension = path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())
        .unwrap_or_default();
    match extension.as_str() {
        "mp4" => Ok("video/mp4"),
        "mov" => Ok("video/quicktime"),
        "m4a" => Ok("audio/mp4"),
        "jpg" | "jpeg" => Ok("image/jpeg"),
        "png" => Ok("image/png"),
        "webp" => Ok("image/webp"),
        "heic" => Ok("image/heic"),
        "wav" => Ok("audio/wav"),
        "mp3" => Ok("audio/mpeg"),
        _ => Err(SidecarError::new("c2pa.unreadable", "unsupported file type")),
    }
}
