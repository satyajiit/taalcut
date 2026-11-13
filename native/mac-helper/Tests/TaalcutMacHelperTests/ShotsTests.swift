// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation
import Testing

@testable import TaalcutMacHelper

private func windows(_ count: Int, path: String, units: String? = nil) -> JSONValue {
    var body: [String: JSONValue] = ["count": .number(Double(count)), "path": .string(path)]
    if let units { body["computeUnits"] = .string(units) }
    return .object(body)
}

private func scratch() throws -> URL {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent("taalcut-shots-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    return root
}

extension Result where Failure == HelperFailure {
    fileprivate var shotsFailureCode: String? {
        if case .failure(let failure) = self { return failure.code }
        return nil
    }
}

@Suite struct ShotsRequestTests {
    @Test func windowsWantOneToFourWholeWindowsInAnAllowedFile() throws {
        let one = ShotsWindow.bytes
        #expect(one == 388_800)
        let root = try scratch()
        defer { try? FileManager.default.removeItem(at: root) }
        let confinement = PathConfinement(roots: [root.path])
        let two = root.appendingPathComponent("two.rgb")
        let short = root.appendingPathComponent("short.rgb")
        try Data(repeating: 7, count: 2 * one).write(to: two)
        try Data(repeating: 7, count: one - 3).write(to: short)
        let parse = { (params: JSONValue) in ShotsWindowsRequest.parse(params, confinement: confinement) }
        #expect(parse(windows(0, path: two.path)).shotsFailureCode == "helper.bad_request")
        #expect(parse(windows(5, path: two.path)).shotsFailureCode == "helper.bad_request")
        #expect(parse(windows(1, path: two.path, units: "gpu")).shotsFailureCode == "helper.bad_request")
        #expect(parse(.object(["count": .number(1)])).shotsFailureCode == "helper.bad_request")
        #expect(parse(.array([])).shotsFailureCode == "helper.bad_request")
        #expect(parse(windows(1, path: "/private/var/root/a.rgb")).shotsFailureCode == "helper.path_not_allowed")
        // A file of another length, or none, is a bad request when it is read.
        for (count, url) in [(1, two), (1, short), (1, root.appendingPathComponent("none.rgb"))] {
            guard case .success(let request) = parse(windows(count, path: url.path)) else {
                Issue.record("\(url.lastPathComponent) should parse")
                continue
            }
            #expect(request.frames().shotsFailureCode == "helper.bad_request")
        }
        guard case .success(let request) = parse(windows(2, path: two.path, units: "cpuOnly")),
            case .success(let frames) = request.frames()
        else {
            Issue.record("two whole windows should parse and read")
            return
        }
        #expect(request.count == 2)
        #expect(request.units == .cpuOnly)
        #expect(shotsWindow(frames, 1).count == one)
    }

    @Test func computeUnitsDefaultToTheGpu() {
        #expect((try? shotsUnitsParam(.object([:])).get()) == .cpuAndGPU)
        #expect((try? shotsUnitsParam(.object(["computeUnits": .string("cpuAndNeuralEngine")])).get())
            == .cpuAndNeuralEngine)
        #expect(shotsUnitsParam(.object(["computeUnits": .number(1)])).shotsFailureCode == "helper.bad_request")
    }

    @Test func shotsIsItsOwnProcessWithModels() async {
        #expect(HelperService.forMethod("shots.prepare") == .shots)
        #expect(HelperService.forMethod("shots.windows") == .shots)
        #expect(HelperService.shots.slots == 2)
        #expect(!HelperService.shots.holdsVideoSession)
        let missingModels = await HelperCommand.run(["bin", "serve", "--services", "shots", "--allow-root", "/tmp"])
        #expect(missingModels == 2)
        let mixed = await HelperCommand.run(
            ["bin", "serve", "--services", "shots,ocr", "--allow-root", "/tmp", "--models", "/tmp"])
        #expect(mixed == 2)
    }

    @Test func aMissingModelIsALoadFailureNamingTheFile() async throws {
        let root = try scratch()
        defer { try? FileManager.default.removeItem(at: root) }
        let window = root.appendingPathComponent("w.rgb")
        try Data(repeating: 7, count: ShotsWindow.bytes).write(to: window)
        let confinement = PathConfinement(roots: [root.path])
        let service = makeShotsService(modelsDirectory: URL(fileURLWithPath: "/no/such/transnetv2-coreml"))
        let prepared = await service.handle(method: "shots.prepare", params: .object([:]), confinement: confinement)
        #expect(prepared.failure?.code == "shots.model_load_failed")
        #expect(prepared.failure?.message.contains("TransNetV2.mlmodelc") == true)
        let predicted = await service.handle(
            method: "shots.windows", params: windows(1, path: window.path), confinement: confinement)
        #expect(predicted.failure?.code == "shots.model_load_failed")
        let unknown = await service.handle(method: "shots.nope", params: .object([:]), confinement: confinement)
        #expect(unknown.failure?.code == "helper.unknown_method")
    }
}

/// IX2-F13: the window file is checked before a byte is read, and never through a link. (No FIFO here: a test that
/// could block has no place in the suite; the open is non-blocking and fstat refuses anything not regular.)
@Suite struct ShotsWindowFileTests {
    @Test func windowsReadOnlyARegularFileOfExactlyTheirLength() throws {
        let root = try scratch()
        defer { try? FileManager.default.removeItem(at: root) }
        let confinement = PathConfinement(roots: [root.path])
        let one = root.appendingPathComponent("one.rgb")
        try Data(repeating: 9, count: ShotsWindow.bytes).write(to: one)
        // Far more than any request may hold: refused from its size, not read.
        let huge = root.appendingPathComponent("huge.rgb")
        FileManager.default.createFile(atPath: huge.path, contents: nil)
        let handle = try FileHandle(forWritingTo: huge)
        try handle.truncate(atOffset: UInt64(64 * 1024 * 1024 * 1024))
        try handle.close()
        let folder = root.appendingPathComponent("folder.rgb")
        try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: false)
        let link = root.appendingPathComponent("link.rgb")
        try FileManager.default.createSymbolicLink(at: link, withDestinationURL: one)
        let read = { (url: URL) -> Result<Data, HelperFailure> in
            switch ShotsWindowsRequest.parse(windows(1, path: url.path), confinement: confinement) {
            case .success(let request): return request.frames()
            case .failure(let failure): return .failure(failure)
            }
        }
        #expect((try? read(one).get())?.count == ShotsWindow.bytes)
        for (url, says) in [(huge, "holds 68719476736 bytes"), (folder, "not a regular file"), (link, "symbolic link")] {
            guard case .failure(let failure) = read(url) else {
                Issue.record("\(url.lastPathComponent) should be refused")
                continue
            }
            #expect(failure.code == "helper.bad_request")
            #expect(failure.message.contains(says), "\(failure.message)")
        }
    }
}

/// The model itself: `packages/vision/.cache/transnetv2-coreml` (from tools/components/pack-transnetv2-coreml.sh) or
/// `TAALCUT_SHOTS_MODELS`, against the shipped ONNX's answer for one synthetic window
/// (Tests/Fixtures/transnetv2-synthetic.json, written by the same script). The parity over ix-v1 is the pack's gate
/// and the vision package's test/integration/coreml-shots-parity.test.ts.
@Suite(.serialized) struct ShotsModelTests {
    @Test(.disabled(if: shotsModelMissing(), shotsSkipComment), .timeLimit(.minutes(5)))
    func predictsTheOnnxModelsAnswerOnTheGpu() async throws {
        let fixture = try ShotsFixture.load()
        let root = try scratch()
        defer { try? FileManager.default.removeItem(at: root) }
        let confinement = PathConfinement(roots: [root.path])
        let service = makeShotsService(modelsDirectory: shotsModelsDirectory())
        let prepared = await service.handle(method: "shots.prepare", params: .object([:]), confinement: confinement)
        #expect(prepared.failure == nil)
        #expect(prepared.result?.key("computeUnits")?.string == "cpuAndGPU")
        let window = syntheticWindow()
        let file = root.appendingPathComponent("two.rgb")
        try (window + window).write(to: file)
        let params = windows(2, path: file.path)
        let answer = await service.handle(method: "shots.windows", params: params, confinement: confinement)
        let single = try decodedFloats(try #require(answer.result?.key("single")?.string))
        let manyHot = try decodedFloats(try #require(answer.result?.key("manyHot")?.string))
        #expect(single.count == 200)
        #expect(manyHot.count == 200)
        // The same window twice gives the same answer twice.
        #expect((zip(single[0..<100], single[100..<200]).map { abs($0 - $1) }.max() ?? 1) < 1e-5)
        for (mine, onnx) in [(Array(single[0..<100]), fixture.single), (Array(manyHot[0..<100]), fixture.manyHot)] {
            let worst = zip(mine, onnx).map { abs($0 - $1) }.max() ?? 1
            #expect(worst < 1e-3)
            #expect(mine.map { $0 > 0.5 } == onnx.map { $0 > 0.5 })
        }
        // The cut between frames 49 and 50 is found.
        #expect((single[45...52].max() ?? 0) > 0.5)
    }
}

/// `(t < 50 ? 30 : 170) + 5x + 3y + 60c + 2(t mod 5)`, mod 256 (fixture.py's formula).
func syntheticWindow() -> Data {
    let (width, height) = (ShotsWindow.width, ShotsWindow.height)
    return Data((0..<ShotsWindow.bytes).map { index in
        // index = ((t × height + y) × width + x) × 3 + c
        let (c, pixel) = (index % 3, index / 3)
        let (x, row) = (pixel % width, pixel / width)
        let (y, t) = (row % height, row / height)
        let base = t < 50 ? 30 : 170
        return UInt8((base + 5 * x + 3 * y + 60 * c + 2 * (t % 5)) % 256)
    })
}

private struct ShotsFixture: Decodable {
    let single: [Float]
    let manyHot: [Float]

    static func load() throws -> ShotsFixture {
        let url = URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
            .appendingPathComponent("Fixtures/transnetv2-synthetic.json")
        return try JSONDecoder().decode(ShotsFixture.self, from: Data(contentsOf: url))
    }
}

private func decodedFloats(_ base64: String) throws -> [Float] {
    let data = try #require(Data(base64Encoded: base64))
    return data.withUnsafeBytes { Array($0.bindMemory(to: Float.self)) }
}

private func shotsModelsDirectory() -> URL {
    testModelsDirectory(variable: "TAALCUT_SHOTS_MODELS", relative: "../../packages/vision/.cache/transnetv2-coreml")
}

private let shotsSkipComment: Comment = """
The transnetv2-coreml folder is not installed: run tools/components/pack-transnetv2-coreml.sh, or set \
TAALCUT_SHOTS_MODELS to an unpacked transnetv2-coreml component.
"""

private func shotsModelMissing() -> Bool {
    let path = shotsModelsDirectory().appendingPathComponent(ShotsWindow.modelFile).path
    let missing = !FileManager.default.fileExists(atPath: path)
    if missing { print("transnetv2-coreml is not in \(shotsModelsDirectory().path)") }
    return missing
}
