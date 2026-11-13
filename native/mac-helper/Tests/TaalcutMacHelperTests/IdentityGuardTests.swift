// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation
import Testing

/// People is past v1.0. Face rectangles for reframe live in `track` and carry no identity.
/// The spec names the private APIs, so this scan covers Swift sources only.
@Suite struct IdentityGuardTests {
    @Test func sourcesDoNotNameIdentityApis() throws {
        let sources = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("Sources", isDirectory: true)
        let needles = [
            "Generate" + "FacePrint" + "Request",
            "face" + "Print",
            "Insight" + "Face",
            "buffalo_" + "l",
            "VNGenerate" + "ImageFeaturePrint" + "Request",
        ]
        let files = try swiftFiles(sources)
        #expect(!files.isEmpty)
        for url in files {
            let text = try String(contentsOf: url, encoding: .utf8)
            for needle in needles {
                #expect(!text.contains(needle), "\(url.lastPathComponent) names \(needle)")
            }
        }
    }
}

private func swiftFiles(_ root: URL) throws -> [URL] {
    guard let enumerator = FileManager.default.enumerator(
        at: root, includingPropertiesForKeys: nil, options: [.skipsHiddenFiles])
    else { return [] }
    var found: [URL] = []
    for case let url as URL in enumerator where url.pathExtension == "swift" {
        found.append(url)
    }
    return found
}
