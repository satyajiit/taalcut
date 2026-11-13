// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation
import Testing

@testable import TaalcutMacHelper

@Suite struct ConfinementTests {
    @Test func allowsTheRootAndAChildAndRefusesTheRest() throws {
        let root = try TemporaryDirectory()
        let confinement = PathConfinement(roots: [root.url.path])
        #expect(confinement.resolve(root.url.path).isAllowed)
        let child = root.url.appendingPathComponent("frame.png").path
        #expect(confinement.resolve(child).isAllowed)
        let outside = FileManager.default.temporaryDirectory.appendingPathComponent("elsewhere").path
        #expect(code(confinement.resolve(outside)) == "helper.path_not_allowed")
        let dotted = root.url.appendingPathComponent("nested/../../outside.png").path
        #expect(code(confinement.resolve(dotted)) == "helper.path_not_allowed")
        let sibling = root.url.path + "-evil/frame.png"
        #expect(code(confinement.resolve(sibling)) == "helper.path_not_allowed")
        #expect(code(confinement.resolve("")) == "helper.bad_request")
    }

    @Test func symlinkCannotEscape() throws {
        let root = try TemporaryDirectory()
        let outside = try TemporaryDirectory()
        let link = root.url.appendingPathComponent("escape")
        try FileManager.default.createSymbolicLink(at: link, withDestinationURL: outside.url)
        let confinement = PathConfinement(roots: [root.url.path])
        let secret = link.appendingPathComponent("secret.png").path
        #expect(code(confinement.resolve(secret)) == "helper.path_not_allowed")
    }

    @Test func tmpAndPrivateTmpAreTheSameRoot() throws {
        let name = "taalcut-confine-\(UUID().uuidString)"
        let visible = "/tmp/\(name)"
        try FileManager.default.createDirectory(atPath: visible, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(atPath: visible) }
        let confinement = PathConfinement(roots: [visible])
        #expect(confinement.resolve(visible + "/frame.png").isAllowed)
    }
}

private func code(_ result: Result<URL, HelperFailure>) -> String? {
    guard case .failure(let failure) = result else { return nil }
    return failure.code
}

extension Result where Success == URL, Failure == HelperFailure {
    fileprivate var isAllowed: Bool {
        if case .success = self { return true }
        return false
    }
}

private struct TemporaryDirectory {
    let url: URL

    init() throws {
        url = FileManager.default.temporaryDirectory.appendingPathComponent("taalcut-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    }
}
