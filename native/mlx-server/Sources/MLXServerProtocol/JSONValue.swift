// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation

/// A JSON value that keeps its objects' key order. The chat template writes each tool's schema into the prompt
/// with `tojson`, and the model was trained on the order the schema was written in: Foundation's parser would lose
/// it (and give each request a different order, which also defeats the prompt cache).
public indirect enum JSONValue: Sendable, Equatable {
    case null
    case bool(Bool)
    case int(Int)
    case double(Double)
    case string(String)
    case array([JSONValue])
    case object([(String, JSONValue)])

    public static func == (lhs: JSONValue, rhs: JSONValue) -> Bool {
        switch (lhs, rhs) {
        case (.null, .null): true
        case (.bool(let a), .bool(let b)): a == b
        case (.int(let a), .int(let b)): a == b
        case (.double(let a), .double(let b)): a == b
        case (.string(let a), .string(let b)): a == b
        case (.array(let a), .array(let b)): a == b
        case (.object(let a), .object(let b)): a.count == b.count && zip(a, b).allSatisfy { $0.0 == $1.0 && $0.1 == $1.1 }
        default: false
        }
    }

    public subscript(key: String) -> JSONValue? {
        guard case .object(let pairs) = self else { return nil }
        return pairs.first { $0.0 == key }?.1
    }

    public var string: String? { if case .string(let s) = self { s } else { nil } }
    public var bool: Bool? { if case .bool(let b) = self { b } else { nil } }
    public var array: [JSONValue]? { if case .array(let a) = self { a } else { nil } }
    public var objectPairs: [(String, JSONValue)]? { if case .object(let o) = self { o } else { nil } }

    public var number: Double? {
        switch self {
        case .int(let i): Double(i)
        case .double(let d): d
        default: nil
        }
    }

    /// Compact JSON, keys in their order.
    public func serialized() -> String {
        switch self {
        case .null: return "null"
        case .bool(let b): return b ? "true" : "false"
        case .int(let i): return String(i)
        case .double(let d):
            if d.isFinite, d == d.rounded(), abs(d) < 1e15 { return String(Int(d)) }
            return d.isFinite ? String(d) : "null"
        case .string(let s): return JSONValue.quote(s)
        case .array(let items): return "[" + items.map { $0.serialized() }.joined(separator: ",") + "]"
        case .object(let pairs):
            return "{" + pairs.map { JSONValue.quote($0.0) + ":" + $0.1.serialized() }.joined(separator: ",") + "}"
        }
    }

    static func quote(_ s: String) -> String {
        var out = "\""
        for scalar in s.unicodeScalars {
            switch scalar {
            case "\"": out += "\\\""
            case "\\": out += "\\\\"
            case "\n": out += "\\n"
            case "\r": out += "\\r"
            case "\t": out += "\\t"
            case "\u{08}": out += "\\b"
            case "\u{0C}": out += "\\f"
            default:
                if scalar.value < 0x20 {
                    out += String(format: "\\u%04x", scalar.value)
                } else {
                    out.unicodeScalars.append(scalar)
                }
            }
        }
        return out + "\""
    }

    public static func parse(_ data: Data) throws -> JSONValue {
        var parser = JSONParser(bytes: [UInt8](data))
        let value = try parser.value()
        parser.skipSpace()
        guard parser.at == parser.bytes.count else { throw JSONParseError.trailing(parser.at) }
        return value
    }

    public static func parse(_ text: String) throws -> JSONValue { try parse(Data(text.utf8)) }
}

public enum JSONParseError: Error, Equatable {
    case unexpected(Int)
    case trailing(Int)
    case badString(Int)
    case badNumber(Int)
    case tooDeep
}

struct JSONParser {
    let bytes: [UInt8]
    var at = 0
    var depth = 0

    init(bytes: [UInt8]) { self.bytes = bytes }

    mutating func skipSpace() {
        while at < bytes.count, [0x20, 0x09, 0x0A, 0x0D].contains(bytes[at]) { at += 1 }
    }

    mutating func value() throws -> JSONValue {
        skipSpace()
        guard at < bytes.count else { throw JSONParseError.unexpected(at) }
        switch bytes[at] {
        case UInt8(ascii: "{"): return try object()
        case UInt8(ascii: "["): return try array()
        case UInt8(ascii: "\""): return .string(try string())
        case UInt8(ascii: "t"): return try literal("true", .bool(true))
        case UInt8(ascii: "f"): return try literal("false", .bool(false))
        case UInt8(ascii: "n"): return try literal("null", .null)
        default: return try number()
        }
    }

    mutating func literal(_ word: String, _ value: JSONValue) throws -> JSONValue {
        let w = Array(word.utf8)
        guard at + w.count <= bytes.count, Array(bytes[at..<(at + w.count)]) == w else {
            throw JSONParseError.unexpected(at)
        }
        at += w.count
        return value
    }

    mutating func object() throws -> JSONValue {
        depth += 1
        defer { depth -= 1 }
        guard depth < 512 else { throw JSONParseError.tooDeep }
        at += 1
        var pairs: [(String, JSONValue)] = []
        skipSpace()
        if at < bytes.count, bytes[at] == UInt8(ascii: "}") {
            at += 1
            return .object(pairs)
        }
        while true {
            skipSpace()
            guard at < bytes.count, bytes[at] == UInt8(ascii: "\"") else { throw JSONParseError.unexpected(at) }
            let key = try string()
            skipSpace()
            guard at < bytes.count, bytes[at] == UInt8(ascii: ":") else { throw JSONParseError.unexpected(at) }
            at += 1
            let item = try value()
            // A repeated key: the last one wins, as in JavaScript.
            if let existing = pairs.firstIndex(where: { $0.0 == key }) {
                pairs[existing].1 = item
            } else {
                pairs.append((key, item))
            }
            skipSpace()
            guard at < bytes.count else { throw JSONParseError.unexpected(at) }
            if bytes[at] == UInt8(ascii: ",") {
                at += 1
                continue
            }
            if bytes[at] == UInt8(ascii: "}") {
                at += 1
                return .object(pairs)
            }
            throw JSONParseError.unexpected(at)
        }
    }

    mutating func array() throws -> JSONValue {
        depth += 1
        defer { depth -= 1 }
        guard depth < 512 else { throw JSONParseError.tooDeep }
        at += 1
        var items: [JSONValue] = []
        skipSpace()
        if at < bytes.count, bytes[at] == UInt8(ascii: "]") {
            at += 1
            return .array(items)
        }
        while true {
            items.append(try value())
            skipSpace()
            guard at < bytes.count else { throw JSONParseError.unexpected(at) }
            if bytes[at] == UInt8(ascii: ",") {
                at += 1
                continue
            }
            if bytes[at] == UInt8(ascii: "]") {
                at += 1
                return .array(items)
            }
            throw JSONParseError.unexpected(at)
        }
    }

    mutating func string() throws -> String {
        at += 1
        var raw: [UInt8] = []
        while at < bytes.count {
            let byte = bytes[at]
            if byte == UInt8(ascii: "\"") {
                at += 1
                guard let s = String(bytes: raw, encoding: .utf8) else { throw JSONParseError.badString(at) }
                return s
            }
            if byte == UInt8(ascii: "\\") {
                at += 1
                guard at < bytes.count else { throw JSONParseError.badString(at) }
                let escape = bytes[at]
                at += 1
                switch escape {
                case UInt8(ascii: "\""): raw.append(0x22)
                case UInt8(ascii: "\\"): raw.append(0x5C)
                case UInt8(ascii: "/"): raw.append(0x2F)
                case UInt8(ascii: "b"): raw.append(0x08)
                case UInt8(ascii: "f"): raw.append(0x0C)
                case UInt8(ascii: "n"): raw.append(0x0A)
                case UInt8(ascii: "r"): raw.append(0x0D)
                case UInt8(ascii: "t"): raw.append(0x09)
                case UInt8(ascii: "u"):
                    var code = try hex4()
                    if (0xD800..<0xDC00).contains(code) {
                        // A surrogate pair.
                        guard at + 1 < bytes.count, bytes[at] == UInt8(ascii: "\\"), bytes[at + 1] == UInt8(ascii: "u")
                        else { throw JSONParseError.badString(at) }
                        at += 2
                        let low = try hex4()
                        guard (0xDC00..<0xE000).contains(low) else { throw JSONParseError.badString(at) }
                        code = 0x10000 + ((code - 0xD800) << 10) + (low - 0xDC00)
                    }
                    guard let scalar = Unicode.Scalar(code) else { throw JSONParseError.badString(at) }
                    raw.append(contentsOf: Array(String(Character(scalar)).utf8))
                default: throw JSONParseError.badString(at)
                }
                continue
            }
            raw.append(byte)
            at += 1
        }
        throw JSONParseError.badString(at)
    }

    mutating func hex4() throws -> UInt32 {
        guard at + 4 <= bytes.count, let s = String(bytes: bytes[at..<(at + 4)], encoding: .ascii),
            let code = UInt32(s, radix: 16)
        else { throw JSONParseError.badString(at) }
        at += 4
        return code
    }

    mutating func number() throws -> JSONValue {
        let start = at
        var isDouble = false
        while at < bytes.count {
            let byte = bytes[at]
            if (0x30...0x39).contains(byte) || byte == UInt8(ascii: "-") || byte == UInt8(ascii: "+") {
                at += 1
            } else if byte == UInt8(ascii: ".") || byte == UInt8(ascii: "e") || byte == UInt8(ascii: "E") {
                isDouble = true
                at += 1
            } else {
                break
            }
        }
        guard at > start, let text = String(bytes: bytes[start..<at], encoding: .ascii) else {
            throw JSONParseError.badNumber(start)
        }
        if !isDouble, let i = Int(text) { return .int(i) }
        guard let d = Double(text) else { throw JSONParseError.badNumber(start) }
        return .double(d)
    }
}
