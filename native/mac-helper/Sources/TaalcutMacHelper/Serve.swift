// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation

struct ServeConfig: Sendable {
    var services: Set<HelperService>
    var roots: [String]
    var models: String?
    var idleSeconds: Double?
    var forceLegacy: Bool
}

enum ParsedCommand {
    case version
    case serve(ServeConfig)
    /// One OCR warm-up step in a child process (WarmChild.swift).
    case warmStep(script: String, forceLegacy: Bool)
}

struct UsageError: Error, Equatable {
    var message: String
}

enum HelperCommand {
    static func run(_ arguments: [String]) async -> Int32 {
        switch parseArguments(arguments) {
        case .failure(let error):
            return fail(error.message)
        case .success(.version):
            LineWriter().write(BuildStamp.versionObject)
            return 0
        case .success(.serve(let config)):
            if let message = validate(config) { return fail(message) }
            return await serve(config)
        case .success(.warmStep(let script, let forceLegacy)):
            let (line, status) = await WarmChild.runStep(script: script, forceLegacy: forceLegacy)
            LineWriter().write(line)
            return status
        }
    }
}

func parseArguments(_ arguments: [String]) -> Result<ParsedCommand, UsageError> {
    let args = Array(arguments.dropFirst())
    if args == ["--version"] { return .success(.version) }
    if args.first == WarmChild.command, args.count >= 2 {
        let legacy = args.count == 3 && args[2] == "--force-legacy-ocr"
        guard args.count == 2 || legacy else { return .failure(UsageError(message: "unknown argument \(args[2])")) }
        #if !DEBUG
        if legacy { return .failure(UsageError(message: "--force-legacy-ocr is only available in test builds")) }
        #endif
        return .success(.warmStep(script: args[1], forceLegacy: legacy))
    }
    guard args.first == "serve" else {
        return .failure(UsageError(message: "usage: taalcut-mac-helper --version | serve --services <names> --allow-root <dir>"))
    }
    var services: Set<HelperService> = []
    var roots: [String] = []
    var models: String?
    var idle: Double?
    var forceLegacy = false
    var index = 1
    while index < args.count {
        let flag = args[index]
        index += 1
        switch flag {
        case "--services":
            guard let value = take(&index, args) else { return .failure(UsageError(message: "missing value for --services")) }
            for name in value.split(separator: ",").map({ $0.trimmingCharacters(in: .whitespaces) }) {
                guard let service = HelperService(rawValue: name) else {
                    return .failure(UsageError(message: "unknown service \(name)"))
                }
                services.insert(service)
            }
        case "--allow-root":
            guard let value = take(&index, args) else { return .failure(UsageError(message: "missing value for --allow-root")) }
            roots.append(value)
        case "--models":
            guard let value = take(&index, args) else { return .failure(UsageError(message: "missing value for --models")) }
            models = value
        case "--idle-exit":
            guard let value = take(&index, args), let seconds = Double(value), seconds >= 0, seconds.rounded() == seconds
            else { return .failure(UsageError(message: "--idle-exit wants a whole number of seconds, or 0")) }
            // Zero means the parent stops the process. Devices uses that.
            idle = seconds == 0 ? nil : seconds
        case "--force-legacy-ocr":
            #if DEBUG
            forceLegacy = true
            #else
            return .failure(UsageError(message: "--force-legacy-ocr is only available in test builds"))
            #endif
        default:
            return .failure(UsageError(message: "unknown argument \(flag)"))
        }
    }
    guard !services.isEmpty else { return .failure(UsageError(message: "missing --services")) }
    return .success(.serve(ServeConfig(
        services: services, roots: roots, models: models, idleSeconds: idle, forceLegacy: forceLegacy)))
}

private func take(_ index: inout Int, _ args: [String]) -> String? {
    guard index < args.count else { return nil }
    let value = args[index]
    guard !value.hasPrefix("--") else { return nil }
    index += 1
    return value
}

private func validate(_ config: ServeConfig) -> String? {
    if config.roots.isEmpty { return "missing --allow-root" }
    let exclusive = config.services.intersection([.asr, .devices, .photos, .track, .grade, .embed, .decode, .shots])
    if let alone = exclusive.first, config.services.count != 1 {
        return "\(alone.rawValue) is its own process"
    }
    if config.services.contains(.asr) && config.models == nil { return "asr requires --models" }
    if config.services.contains(.embed) && config.models == nil { return "embed requires --models" }
    if config.services.contains(.shots) && config.models == nil { return "shots requires --models" }
    for root in config.roots {
        var isDirectory: ObjCBool = false
        guard FileManager.default.fileExists(atPath: root, isDirectory: &isDirectory), isDirectory.boolValue else {
            return "allow-root is not a directory: \(root)"
        }
    }
    return nil
}

private func fail(_ message: String) -> Int32 {
    FileHandle.standardError.write(Data((message + "\n").utf8))
    return 2
}

func readyLine(config: ServeConfig, ocr: OcrEngine, warmup: [String] = []) -> JSONValue {
    let services = HelperService.allCases.filter { config.services.contains($0) }
    var body: [String: JSONValue] = [
        "type": .string("ready"),
        "protocol": .number(Double(BuildStamp.protocolVersion)),
        "version": .string(BuildStamp.version),
        "services": .array(services.map { .string($0.rawValue) }),
        "os": .string(BuildStamp.osVersion),
        "arch": .string(BuildStamp.arch),
        "serviceVersions": serviceVersions(for: config.services),
    ]
    // FIX-OCRCOLD: the name this build's compiled models are cached under (CacheScope.swift), when it has one.
    let cacheName = ProcessInfo.processInfo.processName
    if CacheScope.isScoped(cacheName) { body["cache"] = .string(cacheName) }
    if config.services.contains(.ocr) {
        body["ocr"] = .object([
            "api": .string(ocr.apiName),
            "revision": .number(Double(BuildStamp.ocrRevision)),
            "languages": .array(ocr.supportedIdentifiers(fast: false).map { .string($0) }),
            // OCR v2: the script families the background warm-up reads, in order (OcrWarmup.swift).
            "warmup": .array(warmup.map { .string($0) }),
        ])
    }
    return .object(body)
}

/// `busy`: work outside any request (the OCR warm-up) that keeps an idle process from exiting.
func serveLoop(
    events: AsyncStream<PumpEvent>, session: ProtocolSession, idle: Duration?,
    busy: @escaping @Sendable () async -> Bool = { false }
) async {
    let clock = ContinuousClock()
    var last = clock.now
    for await event in events {
        switch event {
        case .line(let text):
            last = clock.now
            await session.accept(text)
        case .oversized:
            last = clock.now
            await session.oversized()
        case .tick:
            if let idle, await session.inFlight() == 0, !(await busy()), clock.now - last >= idle {
                await session.shutdown()
                return
            }
        case .eof:
            await session.shutdown()
            return
        }
    }
    await session.shutdown()
}

private func serve(_ config: ServeConfig) async -> Int32 {
    if config.services.contains(where: \.holdsVideoSession) {
        // A write to a client or reader that went away is EPIPE (handled), not a signal that ends the process with
        // a VideoToolbox session open.
        signal(SIGPIPE, SIG_IGN)
    }
    let writer = LineWriter()
    let ocr = OcrEngine(forceLegacy: config.forceLegacy)
    let asr = AsrEngine(modelsDirectory: URL(fileURLWithPath: config.models ?? "/"))
    let confinement = PathConfinement(roots: config.roots)
    let devices: DevicesService? = config.services.contains(.devices) ? DevicesService() : nil
    let photos: PhotosService? = config.services.contains(.photos) ? PhotosService() : nil
    let embed = config.services.contains(.embed)
        ? makeEmbedService(modelsDirectory: URL(fileURLWithPath: config.models ?? "/")) : nil
    let shots = config.services.contains(.shots)
        ? makeShotsService(modelsDirectory: URL(fileURLWithPath: config.models ?? "/")) : nil
    let warmup = config.services.contains(.ocr)
        ? OcrWarmup(engine: ocr, child: Bundle.main.executableURL, forceLegacy: config.forceLegacy) : nil
    let session = ProtocolSession(
        started: config.services,
        handler: { method, params, progress, events in
            if method.hasPrefix("photos."), let photos {
                return await photos.handle(method: method, params: params, events: events, confinement: confinement)
            }
            if let phase = await dispatchPhase3(
                method: method, params: params, progress: progress, events: events,
                confinement: confinement, devices: devices, embed: embed, shots: shots)
            {
                return phase
            }
            return await dispatch(
                method: method, params: params, progress: progress,
                confinement: confinement, ocr: ocr, asr: asr, warmup: warmup)
        },
        sink: { writer.write($0.json) },
        hooks: WorkHooks(
            arrived: { method in if method == "ocr.recognize" { await warmup?.readArrived() } },
            finished: { method in if method == "ocr.recognize" { await warmup?.readFinished() } }))
    writer.write(readyLine(config: config, ocr: ocr, warmup: await warmup?.scripts ?? []))
    await warmup?.start()
    let pump = LinePump(
        fileDescriptor: FileHandle.standardInput.fileDescriptor, idleTicks: config.idleSeconds != nil)
    let idle = config.idleSeconds.map { Duration.seconds($0) }
    // Devices runs the main run loop from main.swift. Starting another one from
    // here would nest it in a main-queue block, and browser.start() would not return.
    await serveLoop(events: pump.events, session: session, idle: idle, busy: { await warmup?.running ?? false })
    await warmup?.stop()
    return 0
}

private func dispatch(
    method: String, params: JSONValue, progress: @escaping @Sendable (Double) -> Void,
    confinement: PathConfinement, ocr: OcrEngine, asr: AsrEngine, warmup: OcrWarmup?
) async -> WorkResponse {
    switch method {
    case "ocr.recognize":
        await warmup?.beforeRead()
        return await ocr.recognize(params, confinement: confinement, progress: progress)
    case "ocr.warmup":
        let report = await warmup?.report() ?? .object(["steps": .array([]), "ms": .number(0), "yieldedMs": .number(0)])
        // FIX-OCRCOLD: this build's own compile cache, when it has one (CacheScope), so the app keeps it.
        let cacheName = ProcessInfo.processInfo.processName
        guard CacheScope.isScoped(cacheName), case .object(var body) = report else { return .ok(report) }
        body["cache"] = .string(cacheName)
        return .ok(.object(body))
    case "ocr.languages":
        return ocr.languages()
    case "image.properties":
        return stillProperties(params, confinement: confinement)
    case "asr.load":
        return await asr.load(params)
    case "asr.transcribe":
        return await asr.transcribe(params, confinement: confinement, progress: progress)
    default:
        return .fail(.unknownMethod(method))
    }
}
