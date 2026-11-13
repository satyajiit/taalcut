// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation

/// `taalcut mcp`: reads its token and URL from the environment and pipes stdin to Taalcut until stdin ends.
public enum McpCommand {
    public static func run(environment: [String: String]) async -> Int32 {
        let log = StderrLog(prefix: "taalcut mcp")
        let home = FileManager.default.homeDirectoryForCurrentUser
        let parsed = ShimEnvironment.parse(environment, home: home)
        guard case .success(let shimEnvironment) = parsed else {
            if case .failure(let problem) = parsed { log.write(problem.description) }
            return 2
        }
        let shim = makeShim(shimEnvironment, opener: BackgroundAppOpener(), sink: StdoutSink(), log: log)
        await shim.run(FileHandle.standardInput.bytes.lines)
        return 0
    }

    static func makeShim(
        _ environment: ShimEnvironment,
        opener: AppOpener,
        locatorOptions: EndpointLocator.Options = .init(),
        transport: HttpTransport = URLSessionTransport(),
        sink: LineSink,
        log: DiagnosticLog
    ) -> McpShim {
        let locator = EndpointLocator(
            explicit: environment.explicitURL,
            file: environment.endpointFile,
            opener: opener,
            options: locatorOptions,
            log: log
        )
        return McpShim(token: environment.token, locator: locator, transport: transport, sink: sink, log: log)
    }
}
