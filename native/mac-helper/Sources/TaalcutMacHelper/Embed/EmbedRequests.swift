// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation

/// Most frames or texts one request carries.
let embedRequestLimit = 16
/// Longest frame side: 280 tokens allow 2520 patches, and the short side is at least 3 (48 px), so 840 patches.
let embedMaxSide = 13_440

/// `embed.images` params: `{ tokens, frames: [{ path, width, height }] }`. Each path is a raw rgb24 file inside an
/// allowed root, `width`×`height` at the Gemma 4 image processor's size for `tokens` (sides a multiple of 48, at
/// most 9 × tokens patches of 16 px).
struct EmbedImagesRequest: Sendable {
    let tokens: Int
    let entries: [(url: URL, width: Int, height: Int)]

    static func parse(_ params: JSONValue, confinement: PathConfinement) -> Result<EmbedImagesRequest, HelperFailure> {
        guard let object = params.object else { return .failure(.badRequest("params must be an object")) }
        guard let tokens = whole(object["tokens"]), embedBudgets.contains(tokens) else {
            return .failure(.badRequest("tokens must be one of \(embedBudgets.map(String.init).joined(separator: ", "))"))
        }
        guard let frames = object["frames"]?.array, (1...embedRequestLimit).contains(frames.count) else {
            return .failure(.badRequest("frames must hold 1 to \(embedRequestLimit) frames"))
        }
        var entries: [(url: URL, width: Int, height: Int)] = []
        for frame in frames {
            guard let item = frame.object, let path = item["path"]?.string,
                let width = whole(item["width"]), let height = whole(item["height"])
            else { return .failure(.badRequest("each frame needs path, width and height")) }
            let side = embedPatch * embedPooling
            guard (side...embedMaxSide).contains(width), (side...embedMaxSide).contains(height),
                width % side == 0, height % side == 0
            else {
                return .failure(.badRequest("\(width)x\(height): sides must be multiples of \(side), at most \(embedMaxSide)"))
            }
            guard (width / embedPatch) * (height / embedPatch) <= tokens * 9 else {
                return .failure(.badRequest("\(width)x\(height) is more than \(tokens) soft tokens"))
            }
            switch confinement.resolve(path) {
            case .failure(let failure): return .failure(failure)
            case .success(let url): entries.append((url, width, height))
            }
        }
        return .success(EmbedImagesRequest(tokens: tokens, entries: entries))
    }

    /// Reads every frame; a file of the wrong length is a bad request.
    func frames() throws -> [EmbedFrame] {
        try entries.map { entry in
            let data: Data
            do {
                data = try Data(contentsOf: entry.url)
            } catch {
                throw EmbedError.badFrame("\(entry.url.lastPathComponent) is unreadable")
            }
            guard data.count == entry.width * entry.height * 3 else {
                throw EmbedError.badFrame("\(entry.url.lastPathComponent) is not \(entry.width)x\(entry.height) rgb24")
            }
            return EmbedFrame(width: entry.width, height: entry.height, rgb: data)
        }
    }
}

/// `embed.texts` params: `{ ids: [[Int]] }`, token ids from the model's tokenizer with `<bos>` and `<eos>`.
func embedIdsParam(_ params: JSONValue) -> Result<[[Int32]], HelperFailure> {
    guard let lists = params.object?["ids"]?.array, (1...embedRequestLimit).contains(lists.count) else {
        return .failure(.badRequest("ids must hold 1 to \(embedRequestLimit) token lists"))
    }
    var out: [[Int32]] = []
    for list in lists {
        guard let values = list.array, !values.isEmpty else { return .failure(.badRequest("a token list is empty")) }
        var ids: [Int32] = []
        for value in values {
            guard let id = whole(value), id >= 0, id < 262_144 else {
                return .failure(.badRequest("token ids are whole numbers from 0 to 262143"))
            }
            ids.append(Int32(id))
        }
        out.append(ids)
    }
    return .success(out)
}

/// `embed.prepare` params: `{ budgets? }`, default every budget.
func embedBudgetsParam(_ params: JSONValue) -> Result<[Int], HelperFailure> {
    guard let value = params.object?["budgets"] else { return .success(embedBudgets) }
    guard let list = value.array, !list.isEmpty else { return .failure(.badRequest("budgets must be a non-empty array")) }
    var budgets: [Int] = []
    for item in list {
        guard let budget = whole(item), embedBudgets.contains(budget) else {
            return .failure(.badRequest("budgets are \(embedBudgets.map(String.init).joined(separator: ", "))"))
        }
        if !budgets.contains(budget) { budgets.append(budget) }
    }
    return .success(budgets)
}
