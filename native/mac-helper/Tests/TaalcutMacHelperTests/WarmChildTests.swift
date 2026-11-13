// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation
import Testing

@testable import TaalcutMacHelper

private func refused(_ arguments: [String]) -> Bool {
    if case .failure = parseArguments(arguments) { return true }
    return false
}

/// FIX-OCRCOLD: the warm-up's steps in a child process of the build.
@Suite struct WarmChildTests {
    @Test func parsesTheStepCommand() {
        guard case .success(.warmStep(let script, let legacy)) = parseArguments(["bin", "ocr-warm-step", "latin"])
        else { Issue.record("ocr-warm-step latin did not parse"); return }
        #expect(script == "latin")
        #expect(!legacy)
        #expect(refused(["bin", "ocr-warm-step", "latin", "--nope"]))
        #expect(refused(["bin", "ocr-warm-step"]))
    }

    @Test func readsTheChildsLine() {
        #expect(WarmChild.parse(Data("{\"lines\":3}\n".utf8)) == .success(3))
        guard case .failure(let failure) = WarmChild.parse(Data("{\"error\":\"ocr.language_unsupported\"}".utf8))
        else { Issue.record("an error line read as a success"); return }
        #expect(failure.code == "ocr.language_unsupported")
        guard case .failure(let silent) = WarmChild.parse(Data()) else {
            Issue.record("no line read as a success"); return
        }
        #expect(silent.code == "ocr.failed")
    }

    @Test func aStepThisOsDoesNotListIsRefused() async {
        let (line, status) = await WarmChild.runStep(script: "klingon", forceLegacy: false)
        #expect(status == 2)
        #expect(line.key("error")?.string == "bad_request")
    }
}
