// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Testing

@testable import TaalcutMacHelper

@Test func zeroAndOneStayNumbersAndBooleansStayBooleans() {
    let parsed = JSONValue.parse(line: #"{"n":0,"one":1,"t":true,"f":false}"#)
    #expect(parsed?.key("n")?.number == 0)
    #expect(parsed?.key("one")?.number == 1)
    #expect(parsed?.key("n")?.bool == nil)
    #expect(parsed?.key("t")?.bool == true)
    #expect(parsed?.key("f")?.bool == false)
}
