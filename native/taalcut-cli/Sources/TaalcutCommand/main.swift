// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation
import TaalcutCLI

// This file is the process entry. A file named main.swift cannot also use @main.
Foundation.exit(await TaalcutCommand.run(CommandLine.arguments))
