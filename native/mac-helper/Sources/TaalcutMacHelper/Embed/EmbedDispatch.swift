// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation

/// The `embed` service's methods: `embed.prepare`, `embed.images`, `embed.texts`. Core ML multifunction models
/// need macOS 15, so on 14 every method answers `embed.unsupported_os` and the vision package keeps ONNX.
protocol EmbedService: Sendable {
    func handle(method: String, params: JSONValue, confinement: PathConfinement) async -> WorkResponse
}

func makeEmbedService(modelsDirectory: URL) -> any EmbedService {
    if #available(macOS 15, *) { return CoreMLEmbedService(engine: EmbedEngine(modelsDirectory: modelsDirectory)) }
    return UnsupportedEmbedService()
}

@available(macOS 15, *)
struct CoreMLEmbedService: EmbedService {
    let engine: EmbedEngine

    func handle(method: String, params: JSONValue, confinement: PathConfinement) async -> WorkResponse {
        switch method {
        case "embed.prepare": return await engine.prepare(params)
        case "embed.images": return await engine.images(params, confinement: confinement)
        case "embed.texts": return await engine.texts(params)
        default: return .fail(.unknownMethod(method))
        }
    }
}

struct UnsupportedEmbedService: EmbedService {
    func handle(method: String, params: JSONValue, confinement: PathConfinement) async -> WorkResponse {
        .fail(.failed("embed.unsupported_os", "the embed service needs macOS 15 or later", retryable: false))
    }
}
