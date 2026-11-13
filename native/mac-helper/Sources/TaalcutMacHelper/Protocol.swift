// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation

struct HelperFailure: Error, Sendable, Equatable {
    var code: String
    var message: String
    var retryable: Bool
    var supported: [String]?
    /// Machine-readable extra (ICC domain and code, for example). Never a secret.
    var detail: JSONValue? = nil

    static func badRequest(_ message: String) -> HelperFailure {
        HelperFailure(code: "helper.bad_request", message: message, retryable: false, supported: nil)
    }

    static let cancelled = HelperFailure(
        code: "helper.cancelled", message: "cancelled", retryable: false, supported: nil)

    static func unknownMethod(_ method: String) -> HelperFailure {
        HelperFailure(code: "helper.unknown_method", message: method, retryable: false, supported: nil)
    }

    static func serviceNotStarted(_ name: String) -> HelperFailure {
        HelperFailure(code: "helper.service_not_started", message: name, retryable: false, supported: nil)
    }

    static let pathNotAllowed = HelperFailure(
        code: "helper.path_not_allowed", message: "path is outside every allowed root", retryable: false, supported: nil)

    static func failed(
        _ code: String, _ message: String, retryable: Bool, detail: JSONValue? = nil
    ) -> HelperFailure {
        HelperFailure(code: code, message: message, retryable: retryable, supported: nil, detail: detail)
    }

    static func languageUnsupported(_ language: String, supported: [String]) -> HelperFailure {
        HelperFailure(
            code: "ocr.language_unsupported", message: language, retryable: false, supported: supported)
    }

    var json: JSONValue {
        var body: [String: JSONValue] = [
            "code": .string(code),
            "message": .string(message),
            "retryable": .bool(retryable),
        ]
        if let supported {
            body["supported"] = .array(supported.map { .string($0) })
        }
        if let detail {
            body["detail"] = detail
        }
        return .object(body)
    }
}

struct WorkResponse: Sendable {
    var result: JSONValue?
    var failure: HelperFailure?

    static func ok(_ result: JSONValue) -> WorkResponse {
        WorkResponse(result: result, failure: nil)
    }

    static func fail(_ failure: HelperFailure) -> WorkResponse {
        WorkResponse(result: nil, failure: failure)
    }
}

/// Unsolicited `event` lines. `post` is async so a handler can flush the line before it returns.
struct EventPoster: Sendable {
    var post: @Sendable (String, String, JSONValue) async -> Void

    static let silent = EventPoster { _, _, _ in }
}

enum Outbound: Sendable {
    case response(id: String, body: WorkResponse)
    /// `stage` (OCR v2's keepalive, FIX-OCRCOLD): `queued` for a slot, or `running`. Absent on speech's progress.
    case progress(id: String, fraction: Double, stage: String? = nil)
    case event(service: String, name: String, data: JSONValue)

    var json: JSONValue {
        switch self {
        case .event(let service, let name, let data):
            return .object([
                "type": .string("event"),
                "service": .string(service),
                "name": .string(name),
                "data": data,
            ])
        case .response(let id, let body):
            if let failure = body.failure {
                return .object([
                    "type": .string("response"),
                    "id": .string(id),
                    "ok": .bool(false),
                    "error": failure.json,
                ])
            }
            return .object([
                "type": .string("response"),
                "id": .string(id),
                "ok": .bool(true),
                "result": body.result ?? .object([:]),
            ])
        case .progress(let id, let fraction, let stage):
            var body: [String: JSONValue] = [
                "type": .string("progress"),
                "id": .string(id),
                "fraction": .number(fraction),
            ]
            if let stage { body["stage"] = .string(stage) }
            return .object(body)
        }
    }
}

enum HelperService: String, Sendable, CaseIterable {
    case ocr
    case image
    case asr
    case devices
    case photos
    case track
    case grade
    case embed
    case decode
    case shots

    /// Version announced in `ready.serviceVersions` for this process. OCR 2 (FIX-OCRCOLD): keepalive `progress`
    /// lines for every OCR request, the background warm-up at start, and `ocr.warmup`.
    var version: Int { self == .ocr ? 2 : 1 }

    /// Requests whose progress lines double as a keepalive: Vision's first compile on a new build takes minutes.
    var keepsAlive: Bool { self == .ocr }

    /// `ocr.warmup` only waits for the background warm-up: it never takes one of the two OCR slots.
    static func takesSlot(_ method: String) -> Bool { method != "ocr.warmup" }

    static func forMethod(_ method: String) -> HelperService? {
        switch method {
        case "ocr.recognize", "ocr.languages", "ocr.warmup", "text.render": return .ocr
        case "image.properties": return .image
        case "asr.load", "asr.transcribe": return .asr
        case "devices.start", "devices.open", "devices.list", "devices.thumbnail",
            "devices.download", "devices.cancel", "devices.close", "devices.ptp":
            return .devices
        case "photos.status", "photos.connect", "photos.list", "photos.thumbnail", "photos.export": return .photos
        case "track.shot": return .track
        case "video.applyCube": return .grade
        case "embed.prepare", "embed.images", "embed.texts": return .embed
        case "decode.pass", "decode.frames": return .decode
        case "shots.prepare", "shots.windows": return .shots
        default: return nil
        }
    }

    /// Speech, a camera session, a shot and a grade each run one at a time. OCR may overlap, and so may two embed
    /// requests (one's vision function on the GPU while the other's text pass is on the Neural Engine). Decode runs up to three
    /// VideoToolbox sessions (the most this Mac was measured with; the app's video budget is the real limit).
    var slots: Int {
        switch self {
        case .asr, .devices, .photos, .track, .grade: return 1
        case .ocr, .image, .embed, .shots: return 2
        case .decode: return 3
        }
    }

    /// Services whose work holds a VideoToolbox session: the process waits for their cancelled work before it exits.
    var holdsVideoSession: Bool {
        switch self {
        case .track, .grade, .decode: return true
        case .ocr, .image, .asr, .devices, .photos, .embed, .shots: return false
        }
    }
}

func serviceVersions(for started: Set<HelperService>) -> JSONValue {
    var body: [String: JSONValue] = [:]
    for service in HelperService.allCases where started.contains(service) {
        body[service.rawValue] = .number(Double(service.version))
    }
    // text.render rides in the ocr process. It is not a fourth process.
    if started.contains(.ocr) {
        body["text"] = .number(1)
    }
    return .object(body)
}

/// Told when a request arrives (before it waits for a slot) and when it has been answered: the OCR warm-up holds
/// its next step while a real read is in flight or queued.
struct WorkHooks: Sendable {
    var arrived: @Sendable (String) async -> Void = { _ in }
    var finished: @Sendable (String) async -> Void = { _ in }

    static let none = WorkHooks()
}

/// One JSON-lines session. Replies are matched by id and may finish out of order.
actor ProtocolSession {
    typealias Handler = @Sendable (
        String, JSONValue, @escaping @Sendable (Double) -> Void, EventPoster
    ) async -> WorkResponse

    private let started: Set<HelperService>
    private let handler: Handler
    private let sink: @Sendable (Outbound) -> Void
    private var tasks: [String: Task<Void, Never>] = [:]
    private var taskServices: [String: HelperService] = [:]
    private var gates: [HelperService: SlotGate] = [:]
    private let keepalive: Keepalive
    private let hooks: WorkHooks

    init(
        started: Set<HelperService>, handler: @escaping Handler, sink: @escaping @Sendable (Outbound) -> Void,
        keepaliveSeconds: Double = BuildStamp.keepaliveSeconds, hooks: WorkHooks = .none
    ) {
        self.started = started
        self.handler = handler
        self.sink = sink
        self.hooks = hooks
        keepalive = Keepalive(interval: keepaliveSeconds, sink: sink)
        for service in HelperService.allCases {
            gates[service] = SlotGate(limit: service.slots)
        }
    }

    func inFlight() -> Int { tasks.count }

    func accept(_ line: String) {
        let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
        if trimmed.isEmpty { return }
        guard let value = JSONValue.parse(line: trimmed), let object = value.object else {
            emit(.response(id: "", body: .fail(.badRequest("line is not a JSON object"))))
            return
        }
        let id = object["id"]?.string ?? ""
        guard let type = object["type"]?.string else {
            emit(.response(id: id, body: .fail(.badRequest("missing type"))))
            return
        }
        switch type {
        case "cancel":
            cancel(id)
        case "request":
            start(id: id, object: object)
        default:
            emit(.response(id: id, body: .fail(.badRequest("unknown type"))))
        }
    }

    func oversized() {
        emit(.response(id: "", body: .fail(.badRequest("line is longer than 4 MiB"))))
    }

    /// Finish work already running, at most five seconds, then cancel the rest. Work that holds a VideoToolbox
    /// session is awaited after its cancel, however long it takes: exiting would tear the session down from under
    /// the hardware, which is what preceded both watchdog resets. A stuck session leaves the process waiting; it is
    /// never killed from here.
    func shutdown() async {
        let deadline = ContinuousClock.now + .seconds(BuildStamp.shutdownSeconds)
        while !tasks.isEmpty, ContinuousClock.now < deadline {
            try? await Task.sleep(for: .milliseconds(20))
        }
        let left = tasks
        let services = taskServices
        for task in left.values { task.cancel() }
        for (id, task) in left where services[id]?.holdsVideoSession == true {
            await task.value
        }
        tasks.removeAll()
        taskServices.removeAll()
    }

    private func start(id: String, object: [String: JSONValue]) {
        guard !id.isEmpty, id.count <= 64 else {
            emit(.response(id: id, body: .fail(.badRequest("id must be 1 to 64 characters"))))
            return
        }
        guard tasks[id] == nil else {
            emit(.response(id: id, body: .fail(.badRequest("id is already in flight"))))
            return
        }
        guard let method = object["method"]?.string, !method.isEmpty else {
            emit(.response(id: id, body: .fail(.badRequest("missing method"))))
            return
        }
        guard let service = HelperService.forMethod(method) else {
            emit(.response(id: id, body: .fail(.unknownMethod(method))))
            return
        }
        guard started.contains(service) else {
            emit(.response(id: id, body: .fail(.serviceNotStarted(service.rawValue))))
            return
        }
        let params = object["params"] ?? .object([:])
        if service.keepsAlive {
            keepalive.begin(id, stage: HelperService.takesSlot(method) ? "queued" : "running")
        }
        let task = Task { [handler, hooks] in
            await hooks.arrived(method)
            await self.run(id: id, method: method, params: params, service: service, handler: handler)
            await hooks.finished(method)
        }
        tasks[id] = task
        taskServices[id] = service
    }

    private func run(
        id: String, method: String, params: JSONValue, service: HelperService, handler: @escaping Handler
    ) async {
        defer {
            tasks[id] = nil
            taskServices[id] = nil
        }
        let gate = HelperService.takesSlot(method) ? gates[service] : nil
        do {
            try await gate?.acquire()
        } catch is CancellationError {
            emit(.response(id: id, body: .fail(.cancelled)))
            return
        } catch {
            emit(.response(id: id, body: .fail(.failed("helper.internal", String(describing: error), retryable: true))))
            return
        }
        defer { Task { await gate?.release() } }
        if Task.isCancelled {
            emit(.response(id: id, body: .fail(.cancelled)))
            return
        }
        keepalive.stage(id, "running")
        let progress: @Sendable (Double) -> Void = { fraction in
            Task { await self.progress(id: id, fraction: fraction) }
        }
        let poster = EventPoster { service, name, data in
            await self.postEvent(service: service, name: name, data: data)
        }
        let body = await handler(method, params, progress, poster)
        if Task.isCancelled {
            emit(.response(id: id, body: .fail(.cancelled)))
            return
        }
        emit(.response(id: id, body: body))
    }

    private func progress(id: String, fraction: Double) {
        guard tasks[id] != nil else { return }
        let clamped = min(1, max(0, fraction))
        keepalive.fraction(id, clamped)
        emit(.progress(id: id, fraction: clamped))
    }

    private func cancel(_ id: String) {
        guard let task = tasks[id] else { return }
        task.cancel()
    }

    func postEvent(service: String, name: String, data: JSONValue) {
        emit(.event(service: service, name: name, data: data))
    }

    private func emit(_ outbound: Outbound) {
        // The keepalive stops before the response goes out, so no beat follows a request's answer.
        if case .response(let id, _) = outbound { keepalive.end(id) }
        sink(outbound)
    }
}
