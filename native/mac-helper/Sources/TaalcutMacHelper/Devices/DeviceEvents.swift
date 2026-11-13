// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation

/// Device events in the order they happened. One consumer drains them, so a fast replug's
/// `device.removed` can't overtake its `device.added` the way independent tasks could.
final class DeviceEventQueue: Sendable {
    private struct Pending: Sendable {
        let poster: EventPoster
        let name: String
        let data: JSONValue
    }

    private let continuation: AsyncStream<Pending>.Continuation

    init() {
        let (stream, continuation) = AsyncStream<Pending>.makeStream()
        self.continuation = continuation
        Task.detached {
            for await item in stream { await item.poster.post("devices", item.name, item.data) }
        }
    }

    deinit { continuation.finish() }

    func post(_ poster: EventPoster, _ name: String, _ data: JSONValue) {
        continuation.yield(Pending(poster: poster, name: name, data: data))
    }
}
