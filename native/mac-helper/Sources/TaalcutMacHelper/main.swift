// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation

// This file is the process entry. A file named main.swift cannot also use @main.
// Before anything compiles: this build's own cache of compiled models (CacheScope.swift).
CacheScope.apply()
let arguments = CommandLine.arguments
if case .success(.serve(let config)) = parseArguments(arguments),
   !config.services.intersection([.devices, .photos]).isEmpty {
    Foundation.exit(runDevicesServe(arguments))
}
Foundation.exit(await HelperCommand.run(arguments))
