// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/// `taalcut update-guard` arguments.
struct GuardOptions: Equatable {
    var pendingPath: String
    var rollbackNow = false
    var installTimeoutMs = 600_000
    var healthTimeoutMs = 90_000
    var pollMs = 500
    /// How long a SIGTERM'd launch gets before SIGKILL.
    var terminateGraceMs = 5_000
    /// How long --rollback-now waits for the app to quit.
    var quitWaitMs = 30_000

    static func parse(_ arguments: [String]) -> Result<GuardOptions, ArgumentProblem> {
        var pending: String?
        var options = GuardOptions(pendingPath: "")
        var index = 0
        while index < arguments.count {
            let flag = arguments[index]
            switch flag {
            case "--rollback-now":
                options.rollbackNow = true
                index += 1
                continue
            case "--pending", "--install-timeout-ms", "--health-timeout-ms", "--poll-ms":
                guard index + 1 < arguments.count else { return .failure(.missingValue(flag)) }
                let value = arguments[index + 1]
                index += 2
                if flag == "--pending" {
                    pending = value
                    continue
                }
                guard let number = Int(value), number > 0 else { return .failure(.badNumber(flag, value)) }
                switch flag {
                case "--install-timeout-ms": options.installTimeoutMs = number
                case "--health-timeout-ms": options.healthTimeoutMs = number
                default: options.pollMs = number
                }
            default:
                return .failure(.unknown(flag))
            }
        }
        guard let pending, pending.hasPrefix("/") else { return .failure(.missingValue("--pending")) }
        options.pendingPath = pending
        return .success(options)
    }

    enum ArgumentProblem: Error, Equatable, CustomStringConvertible {
        case unknown(String)
        case missingValue(String)
        case badNumber(String, String)

        var description: String {
            switch self {
            case .unknown(let flag): return "unknown argument \(flag)"
            case .missingValue(let flag): return "\(flag) needs a value (an absolute path for --pending)"
            case .badNumber(let flag, let value): return "\(flag) needs a positive whole number, not \(value)"
            }
        }
    }
}
