// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation

/// A model folder for the model-present tests: `$variable` when it is set, else `relative` to this package's folder
/// (native/mac-helper).
func testModelsDirectory(variable: String, relative: String) -> URL {
    if let override = ProcessInfo.processInfo.environment[variable], !override.isEmpty {
        return URL(fileURLWithPath: override)
    }
    return URL(fileURLWithPath: #filePath)
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .appendingPathComponent(relative, isDirectory: true)
        .standardizedFileURL
}
