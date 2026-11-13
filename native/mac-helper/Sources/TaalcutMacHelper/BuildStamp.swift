// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation

enum BuildStamp {
    static let version = "1.0.0"
    static let protocolVersion = 2
    /// Measured toolchain for this helper (spike 05, Xcode 26.6).
    static let swiftVersion = "6.3.3"
    static let fluidAudioVersion = "0.17.7"
    /// Commit `v0.17.7` resolves to. `build.sh` checks `Package.resolved` against it.
    static let fluidAudioRevision = "503b4bd1bbf7220882de39fe8ae6716aae4132da"
    static let maxLineBytes = 4 * 1024 * 1024
    static let ocrRevision = 3
    static let shutdownSeconds: Double = 5
    /// How often a live OCR request says it is still being worked on (OCR v2, Keepalive.swift).
    static let keepaliveSeconds: Double = 2

    static var versionObject: JSONValue {
        .object([
            "version": .string(version),
            "protocol": .number(Double(protocolVersion)),
            "swift": .string(swiftVersion),
            "fluidAudio": .object([
                "version": .string(fluidAudioVersion),
                "revision": .string(fluidAudioRevision),
            ]),
        ])
    }

    static var osVersion: String {
        let v = ProcessInfo.processInfo.operatingSystemVersion
        return "\(v.majorVersion).\(v.minorVersion).\(v.patchVersion)"
    }

    static var arch: String {
        #if arch(arm64)
        return "arm64"
        #else
        return "x86_64"
        #endif
    }
}
