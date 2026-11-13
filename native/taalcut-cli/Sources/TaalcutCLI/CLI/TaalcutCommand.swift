// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation

/// Routes `taalcut <subcommand>`; each subcommand returns the process exit code.
public enum TaalcutCommand {
    public static let usage = """
        usage: taalcut mcp
               taalcut update-guard --pending <path> [--rollback-now] [--install-timeout-ms N] [--health-timeout-ms N] [--poll-ms N]
               taalcut --version
        """

    public static func run(_ arguments: [String]) async -> Int32 {
        let rest = Array(arguments.dropFirst())
        switch rest.first {
        case "mcp":
            guard rest.count == 1 else { return usageError("taalcut mcp takes no arguments; use TAALCUT_MCP_TOKEN") }
            return await McpCommand.run(environment: ProcessInfo.processInfo.environment)
        case "update-guard":
            return GuardCommand.run(Array(rest.dropFirst()))
        case "--version":
            FileHandle.standardOutput.write(Data("taalcut \(BuildStamp.version)\n".utf8))
            return 0
        default:
            return usageError(nil)
        }
    }

    static func usageError(_ message: String?) -> Int32 {
        if let message { FileHandle.standardError.write(Data("taalcut: \(message)\n".utf8)) }
        FileHandle.standardError.write(Data("\(usage)\n".utf8))
        return 2
    }
}
