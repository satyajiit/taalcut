// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation
import Testing

@testable import TaalcutMacHelper

private func frame(_ path: String, _ width: Int, _ height: Int) -> JSONValue {
    .object(["path": .string(path), "width": .number(Double(width)), "height": .number(Double(height))])
}

private func images(_ tokens: Int, _ frames: [JSONValue]) -> JSONValue {
    .object(["tokens": .number(Double(tokens)), "frames": .array(frames)])
}

private func scratch() throws -> URL {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent("taalcut-embed-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    return root
}

@Suite struct EmbedRequestTests {
    @Test func imagesWantABudgetAndProcessorSizedFrames() throws {
        let root = try scratch()
        defer { try? FileManager.default.removeItem(at: root) }
        let confinement = PathConfinement(roots: [root.path])
        let inside = root.appendingPathComponent("a.rgb").path
        let codes: (JSONValue) -> String? = { params in
            if case .failure(let failure) = EmbedImagesRequest.parse(params, confinement: confinement) {
                return failure.code
            }
            return nil
        }
        #expect(codes(images(100, [frame(inside, 768, 384)])) == "helper.bad_request")
        #expect(codes(images(140, [])) == "helper.bad_request")
        #expect(codes(images(140, Array(repeating: frame(inside, 768, 384), count: 17))) == "helper.bad_request")
        #expect(codes(images(140, [frame(inside, 760, 384)])) == "helper.bad_request")
        // 1056×576 is 280's size: 2376 patches, over 140 × 9.
        #expect(codes(images(140, [frame(inside, 1056, 576)])) == "helper.bad_request")
        // A side too long for any budget is refused before its patches are counted.
        #expect(codes(images(280, [frame(inside, 48 * 1_000_000_000, 48)])) == "helper.bad_request")
        #expect(codes(images(140, [frame("/private/var/root/a.rgb", 768, 384)])) == "helper.path_not_allowed")
        guard case .success(let request) = EmbedImagesRequest.parse(
            images(140, [frame(inside, 768, 384), frame(inside, 528, 288)]), confinement: confinement)
        else {
            Issue.record("a 140-token request should parse")
            return
        }
        #expect(request.tokens == 140)
        #expect(request.entries.map(\.width) == [768, 528])
    }

    @Test func aFrameFileMustHoldItsSizeInRgb() throws {
        let root = try scratch()
        defer { try? FileManager.default.removeItem(at: root) }
        let good = root.appendingPathComponent("good.rgb")
        let short = root.appendingPathComponent("short.rgb")
        try Data(repeating: 128, count: 528 * 288 * 3).write(to: good)
        try Data(repeating: 128, count: 528 * 288).write(to: short)
        let confinement = PathConfinement(roots: [root.path])
        guard case .success(let request) = EmbedImagesRequest.parse(
            images(70, [frame(good.path, 528, 288)]), confinement: confinement),
            case .success(let bad) = EmbedImagesRequest.parse(
                images(70, [frame(short.path, 528, 288)]), confinement: confinement)
        else {
            Issue.record("both requests should parse")
            return
        }
        let frames = try request.frames()
        #expect(frames.first?.rgb.count == 528 * 288 * 3)
        #expect(throws: EmbedError.self) { try bad.frames() }
    }

    @Test func textIdsAndPrepareBudgets() {
        #expect(embedIdsParam(.object([:])).failureCode == "helper.bad_request")
        #expect(embedIdsParam(.object(["ids": .array([.array([])])])).failureCode == "helper.bad_request")
        #expect(embedIdsParam(.object(["ids": .array([.array([.number(-1)])])])).failureCode == "helper.bad_request")
        #expect(embedIdsParam(.object(["ids": .array([.array([.number(2.5)])])])).failureCode == "helper.bad_request")
        if case .success(let ids) = embedIdsParam(.object(["ids": .array([.array([.number(2), .number(1)])])])) {
            #expect(ids == [[2, 1]])
        } else {
            Issue.record("one token list should parse")
        }
        if case .success(let all) = embedBudgetsParam(.object([:])) { #expect(all == [70, 140, 280]) }
        if case .success(let some) = embedBudgetsParam(.object(["budgets": .array([.number(140), .number(140)])])) {
            #expect(some == [140])
        }
        #expect(embedBudgetsParam(.object(["budgets": .array([.number(64)])])).failureCode == "helper.bad_request")
    }

    @Test func embedIsItsOwnProcessWithModels() async {
        #expect(HelperService.forMethod("embed.images") == .embed)
        #expect(HelperService.forMethod("embed.texts") == .embed)
        #expect(HelperService.forMethod("embed.prepare") == .embed)
        #expect(HelperService.embed.slots == 2)
        let missingModels = await HelperCommand.run(["bin", "serve", "--services", "embed", "--allow-root", "/tmp"])
        #expect(missingModels == 2)
        let mixed = await HelperCommand.run(
            ["bin", "serve", "--services", "embed,ocr", "--allow-root", "/tmp", "--models", "/tmp"])
        #expect(mixed == 2)
    }

    @Test func missingModelFilesAreALoadFailureNamingTheFile() async {
        let service = makeEmbedService(modelsDirectory: URL(fileURLWithPath: "/no/such/embeddinggemma-2-coreml"))
        let confinement = PathConfinement(roots: ["/tmp"])
        let prepared = await service.handle(method: "embed.prepare", params: .object([:]), confinement: confinement)
        if #available(macOS 15, *) {
            #expect(prepared.failure?.code == "embed.model_load_failed")
            #expect(prepared.failure?.message.contains("EmbeddingGemma2Text.mlmodelc") == true)
            let texts = await service.handle(
                method: "embed.texts", params: .object(["ids": .array([.array([.number(2), .number(1)])])]),
                confinement: confinement)
            #expect(texts.failure?.code == "embed.model_load_failed")
        } else {
            #expect(prepared.failure?.code == "embed.unsupported_os")
        }
    }
}

extension Result where Failure == HelperFailure {
    fileprivate var failureCode: String? {
        if case .failure(let failure) = self { return failure.code }
        return nil
    }
}

/// The Core ML models themselves: `packages/vision/.cache/embeddinggemma-2-coreml` (from
/// tools/components/pack-embeddinggemma-coreml.sh) or `TAALCUT_EMBED_MODELS`; for a component packed with a weight
/// recipe (IX3-N3), its `expanded/` folder, which the vision package writes on first use. Parity with the ONNX path is
/// the vision package's test (coreml-parity.int.test.ts); this one checks the service end to end.
@Suite(.serialized) struct EmbedModelTests {
    @Test(.disabled(if: embedModelsMissing(), embedSkipComment), .timeLimit(.minutes(10)))
    func embedsAFrameAndATextWhenTheModelsArePresent() async throws {
        guard #available(macOS 15, *) else { return }
        let root = try scratch()
        defer { try? FileManager.default.removeItem(at: root) }
        let service = makeEmbedService(modelsDirectory: embedModelsDirectory())
        let confinement = PathConfinement(roots: [root.path])
        let prepared = await service.handle(
            method: "embed.prepare", params: .object(["budgets": .array([.number(140)])]), confinement: confinement)
        #expect(prepared.failure == nil)
        let grey = root.appendingPathComponent("grey.rgb")
        try Data(repeating: 128, count: 768 * 384 * 3).write(to: grey)
        let params = images(140, [frame(grey.path, 768, 384), frame(grey.path, 768, 384)])
        let embedded = await service.handle(method: "embed.images", params: params, confinement: confinement)
        let vectors = try #require(embedded.result?.key("vectors")?.array?.compactMap { $0.string })
        #expect(vectors.count == 2)
        #expect(vectors.first == vectors.last)
        let image = try decoded(try #require(vectors.first))
        // `<bos>`, one token, `<eos>`.
        let text = await service.handle(
            method: "embed.texts", params: .object(["ids": .array([.array([.number(2), .number(23391), .number(1)])])]),
            confinement: confinement)
        let words = try decoded(try #require(text.result?.key("vectors")?.array?.first?.string))
        for vector in [image, words] {
            #expect(vector.count == 768)
            #expect(vector.allSatisfy { $0.isFinite })
            #expect(vector.reduce(0) { $0 + $1 * $1 } > 0.5)
        }
    }
}

private func decoded(_ base64: String) throws -> [Float] {
    let data = try #require(Data(base64Encoded: base64))
    return data.withUnsafeBytes { Array($0.bindMemory(to: Float.self)) }
}

private func embedModelsDirectory() -> URL {
    let component = testModelsDirectory(
        variable: "TAALCUT_EMBED_MODELS", relative: "../../packages/vision/.cache/embeddinggemma-2-coreml")
    let expanded = component.appendingPathComponent("expanded")
    return FileManager.default.fileExists(atPath: expanded.path) ? expanded : component
}

private let embedSkipComment: Comment = """
The embeddinggemma-2-coreml folder is not installed: run tools/components/pack-embeddinggemma-coreml.sh and load it \
once through the vision package (it writes the weights), or set TAALCUT_EMBED_MODELS to an unpacked component.
"""

private func embedModelsMissing() -> Bool {
    let missing = !EmbedModelFiles(directory: embedModelsDirectory()).missing.isEmpty
    if missing { print("embeddinggemma-2-coreml is not in \(embedModelsDirectory().path)") }
    return missing
}
