// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation

public enum BuildStamp {
    public static let version = "1.0.0"
    /// The toolchain build.sh insists on (the mac helper's).
    public static let swiftVersion = "6.3.3"
    /// The app that owns the endpoint file and that `taalcut mcp` opens when it isn't running.
    public static let appBundleId = "com.taalcut.app"
}
