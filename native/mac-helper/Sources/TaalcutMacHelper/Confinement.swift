// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation

/// Request paths must resolve, symlinks included, inside one of the repeated
/// `--allow-root` directories. A prefix match without a path boundary
/// (`/tmp/root-evil` against `/tmp/root`) is a miss.
struct PathConfinement: Sendable {
    private let roots: [String]

    init(roots: [String]) {
        self.roots = roots.map(Self.realPath)
    }

    var isEmpty: Bool { roots.isEmpty }

    func resolve(_ path: String) -> Result<URL, HelperFailure> {
        if path.isEmpty {
            return .failure(.badRequest("path is empty"))
        }
        let resolved = Self.realPath(path)
        guard roots.contains(where: { Self.contains(root: $0, path: resolved) }) else {
            return .failure(.pathNotAllowed)
        }
        return .success(URL(fileURLWithPath: resolved))
    }

    /// Resolve symlinks in the longest path prefix that exists. A missing final
    /// component must not hide a symlink in a parent (`root/escape/secret.png`).
    private static func realPath(_ path: String) -> String {
        var cursor = URL(fileURLWithPath: path).standardizedFileURL
        var missing: [String] = []
        while cursor.path != "/" && !linkExists(cursor.path) {
            missing.append(cursor.lastPathComponent)
            cursor.deleteLastPathComponent()
        }
        let base = cursor.resolvingSymlinksInPath()
        let resolved = missing.reversed().reduce(base) { $0.appendingPathComponent($1) }
        return resolved.standardizedFileURL.path
    }

    private static func linkExists(_ path: String) -> Bool {
        var info = stat()
        return lstat(path, &info) == 0
    }

    private static func contains(root: String, path: String) -> Bool {
        if path == root { return true }
        let prefix = root.hasSuffix("/") ? root : root + "/"
        return path.hasPrefix(prefix)
    }
}
