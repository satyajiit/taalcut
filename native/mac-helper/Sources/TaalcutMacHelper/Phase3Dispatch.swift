// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation

/// Phase 3 methods. Returns nil for a v1 method so the existing dispatcher runs.
func dispatchPhase3(
    method: String,
    params: JSONValue,
    progress: @escaping @Sendable (Double) -> Void,
    events: EventPoster,
    confinement: PathConfinement,
    devices: DevicesService?,
    embed: (any EmbedService)? = nil,
    shots: (any ShotsService)? = nil
) async -> WorkResponse? {
    switch method {
    case "text.render":
        return await renderMatchedText(params: params, confinement: confinement)
    case "video.applyCube":
        return await applyVideoCube(params: params, progress: progress, confinement: confinement)
    case "track.shot":
        return await trackShot(params: params, progress: progress, confinement: confinement)
    case "decode.pass":
        return await decodePass(params: params, progress: progress, confinement: confinement)
    case "decode.frames":
        return await decodeFrames(params: params, progress: progress, confinement: confinement)
    case "devices.start", "devices.open", "devices.list", "devices.thumbnail",
        "devices.download", "devices.cancel", "devices.close", "devices.ptp":
        guard let devices else {
            return .fail(.failed("helper.internal", "\(method) is not installed", retryable: false))
        }
        return await devices.handle(
            method: method, params: params, progress: progress, events: events, confinement: confinement)
    case "embed.prepare", "embed.images", "embed.texts":
        guard let embed else {
            return .fail(.failed("helper.internal", "\(method) is not installed", retryable: false))
        }
        return await embed.handle(method: method, params: params, confinement: confinement)
    case "shots.prepare", "shots.windows":
        guard let shots else {
            return .fail(.failed("helper.internal", "\(method) is not installed", retryable: false))
        }
        return await shots.handle(method: method, params: params, confinement: confinement)
    default:
        return nil
    }
}
