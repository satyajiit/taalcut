// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation
import MLX
import MLXServerProtocol

/// taalcut-mlx-server: Taalcut's on-device model server on MLX (Apple silicon). It listens on loopback at once and
/// answers /health 503 while the model loads, 200 once it serves; the app's driver waits for that, as for
/// llama-server. The key every other request must carry comes from the environment, never the command line.

setvbuf(stdout, nil, _IOLBF, 0)
setvbuf(stderr, nil, _IOLBF, 0)

func log(_ line: String) {
    FileHandle.standardError.write(Data("[mlx-server] \(line)\n".utf8))
}

var arguments = Array(CommandLine.arguments.dropFirst())
if arguments == ["--version"] {
    print("taalcut-mlx-server 1.0.0 (mlx-swift-lm 3.32.3)")
    exit(0)
}
// The chat template is long: it comes as `--chat-template <text>` (llama-server's flag) and is kept out of the rest.
var chatTemplate: String?
if let index = arguments.firstIndex(of: "--chat-template"), index + 1 < arguments.count {
    chatTemplate = arguments[index + 1]
    arguments.removeSubrange(index...(index + 1))
}
let options: ServerOptions
do {
    options = try ServerOptions.parse(arguments)
} catch ServerOptions.ParseError.usage(let reason) {
    log(reason)
    FileHandle.standardError.write(Data((ServerOptions.usage + "\n").utf8))
    exit(2)
}
let apiKey = ProcessInfo.processInfo.environment["TAALCUT_MLX_API_KEY"].flatMap { $0.isEmpty ? nil : $0 }

Memory.cacheLimit = options.cacheLimitMB * 1024 * 1024

let state = ServerState()
let routes = Routes(options: options, apiKey: apiKey, state: state)
let server: HTTPServer
do {
    server = try HTTPServer(host: options.host, port: options.port) { request, writer in
        await routes.handle(request, writer: writer)
    }
    try await server.start()
} catch {
    log("can't listen on \(options.host):\(options.port): \(error)")
    exit(3)
}
log("listening on http://\(options.host):\(options.port), loading \(options.alias)")

do {
    let loadStart = Date()
    let engine = try await Engine.load(options: options, chatTemplate: chatTemplate)
    await state.ready(engine)
    let seconds = String(format: "%.1f", Date().timeIntervalSince(loadStart))
    log(
        "model \(options.alias) loaded in \(seconds) s on \(MLX.Device.defaultDevice()), tool calls "
            + "\(await engine.toolCallFormat), context \(options.contextSize)")
} catch {
    log("model load failed: \(error)")
    exit(4)
}

// Serve until the app stops the process (SIGTERM).
signal(SIGTERM) { _ in exit(0) }
while true {
    try await Task.sleep(nanoseconds: 3_600_000_000_000)
}
