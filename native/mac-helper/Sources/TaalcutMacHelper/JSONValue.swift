// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation

/// One JSON value. Sendable so request bodies can cross the serve loop's tasks.
enum JSONValue: Sendable, Equatable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])

    var object: [String: JSONValue]? {
        if case .object(let value) = self { return value }
        return nil
    }

    var array: [JSONValue]? {
        if case .array(let value) = self { return value }
        return nil
    }

    var string: String? {
        if case .string(let value) = self { return value }
        return nil
    }

    var bool: Bool? {
        if case .bool(let value) = self { return value }
        return nil
    }

    var number: Double? {
        if case .number(let value) = self { return value }
        return nil
    }

    func key(_ name: String) -> JSONValue? {
        object?[name]
    }

    static func parse(line: String) -> JSONValue? {
        guard let data = line.data(using: .utf8) else { return nil }
        return parse(data: data)
    }

    static func parse(data: Data) -> JSONValue? {
        guard let raw = try? JSONSerialization.jsonObject(with: data, options: [.fragmentsAllowed]) else {
            return nil
        }
        return convert(raw)
    }

    func line() -> String {
        let data = try? JSONSerialization.data(withJSONObject: foundation(), options: [.sortedKeys])
        return data.flatMap { String(data: $0, encoding: .utf8) } ?? "null"
    }

    private func foundation() -> Any {
        switch self {
        case .null:
            return NSNull()
        case .bool(let value):
            return value
        case .number(let value):
            if value.rounded() == value, value <= Double(Int.max), value >= Double(Int.min) {
                return Int(value)
            }
            return value
        case .string(let value):
            return value
        case .array(let values):
            return values.map { $0.foundation() }
        case .object(let values):
            return values.mapValues { $0.foundation() }
        }
    }

    private static func convert(_ raw: Any) -> JSONValue {
        switch raw {
        case is NSNull:
            return .null
        case let value as NSNumber:
            // JSON numbers 0 and 1 bridge to Bool. A real boolean is a CFBoolean.
            if CFGetTypeID(value) == CFBooleanGetTypeID() {
                return .bool(value.boolValue)
            }
            return .number(value.doubleValue)
        case let value as String:
            return .string(value)
        case let value as [Any]:
            return .array(value.map(convert))
        case let value as [String: Any]:
            return .object(value.mapValues(convert))
        default:
            return .null
        }
    }
}
