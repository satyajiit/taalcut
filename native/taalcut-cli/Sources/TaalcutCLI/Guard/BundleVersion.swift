// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation

enum BundleVersion {
    /// CFBundleShortVersionString of an app bundle; nil while it is missing or half-replaced.
    static func of(_ app: URL) -> String? { infoValue(app, "CFBundleShortVersionString") }

    /// CFBundleIdentifier: the guard moves only bundles that are Taalcut.
    static func identifier(of app: URL) -> String? { infoValue(app, "CFBundleIdentifier") }

    private static func infoValue(_ app: URL, _ key: String) -> String? {
        let plist = app.appendingPathComponent("Contents/Info.plist")
        guard let data = try? Data(contentsOf: plist),
            let object = try? PropertyListSerialization.propertyList(from: data, format: nil) as? [String: Any]
        else { return nil }
        return object[key] as? String
    }
}
