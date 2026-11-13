// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

/// What a tool call may look like, for constrained decoding (MLX1). llama-server constrains the arguments of a
/// Qwen3.5 tool call to the tool's JSON schema with a grammar that wakes on `<tool_call>`; without one the 9B on MLX
/// wrote calls the app had to refuse (a stray `]}`, a missing comma, a value off its enum). This is the same rule,
/// as an XGrammar structural tag: after `<tool_call>`, one of the offered functions with its parameters in Qwen's XML
/// (`<parameter=name>` value `</parameter>`, a string as plain text, anything else as JSON to its schema), then
/// `</tool_call>`, laid out as the chat template writes a call. Text outside a call is never constrained.
public enum ToolCallStructure {
    /// The structural tag (XGrammar's JSON) for the body of one call, the text after `<tool_call>`. `relaxed` names
    /// tools whose schema XGrammar couldn't compile: they keep their name, with any parameters.
    public static func structuralTag(tools: [JSONValue], relaxed: Set<String> = []) -> String {
        var tags: [JSONValue] = []
        for (name, parameters) in functions(tools) {
            let schema = relaxed.contains(name) ? anyParameters : xmlParameters(grammarSchema(objectSchema(parameters)))
            tags.append(.object([
                ("type", .string("tag")),
                ("begin", .string("<function=\(name)>")),
                ("content", .object([("type", .string("qwen_xml_parameter")), ("json_schema", schema)])),
                // XGrammar's XML object allows no whitespace after its last `</parameter>`; the template puts a
                // newline there (and between `<function=…>` and `</function>` when there are no arguments).
                ("end", .string("\n</function>")),
            ]))
        }
        let call: JSONValue = tags.count == 1 ? tags[0] : .object([("type", .string("or")), ("elements", .array(tags))])
        let body: JSONValue = .object([
            ("type", .string("sequence")),
            ("elements", .array([
                .object([("type", .string("const_string")), ("value", .string("\n"))]),
                call,
                .object([("type", .string("const_string")), ("value", .string("\n</tool_call>"))]),
            ])),
        ])
        return JSONValue.object([("type", .string("structural_tag")), ("format", body)]).serialized()
    }

    /// The offered functions' names and parameter schemas, in the order offered, each name once.
    public static func functions(_ tools: [JSONValue]) -> [(String, JSONValue?)] {
        var seen = Set<String>()
        var out: [(String, JSONValue?)] = []
        for tool in tools {
            let function = tool["function"] ?? tool
            guard let name = function["name"]?.string, !name.isEmpty, seen.insert(name).inserted else { continue }
            out.append((name, function["parameters"]))
        }
        return out
    }

    /// Any parameters at all (a tool whose schema couldn't be compiled).
    static let anyParameters: JSONValue = .object([("type", .string("object")), ("additionalProperties", .bool(true))])

    /// Counts, lengths, ranges and patterns, which XGrammar spells out state by state (a `maxLength` of 500, a
    /// `maxItems` of 12 of an object, a number range as a regular expression): with them three of the make flow's
    /// tool sets took 48 to 127 s each to compile against Qwen's 248k-token vocabulary; without, its nine 0.4 to 6.6
    /// s. The grammar keeps the shape (JSON, types, enums, required and known fields), which is what the refused
    /// calls broke; the tool's own validation still checks the rest.
    static let droppedKeywords: Set<String> = [
        "minLength", "maxLength", "pattern", "format", "minItems", "maxItems", "uniqueItems", "minProperties",
        "maxProperties", "propertyNames", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "multipleOf",
    ]

    /// The schema the grammar holds a call to: `droppedKeywords` taken out wherever a schema sits (not from the
    /// names of properties, which can be anything).
    static func grammarSchema(_ schema: JSONValue) -> JSONValue {
        guard case .object(let pairs) = schema else { return schema }
        var out: [(String, JSONValue)] = []
        for (key, value) in pairs where !droppedKeywords.contains(key) {
            switch key {
            case "properties", "$defs", "definitions", "patternProperties":
                out.append((key, .object((value.objectPairs ?? []).map { ($0.0, grammarSchema($0.1)) })))
            case "items", "additionalProperties", "not", "contains", "if", "then", "else":
                out.append((key, grammarSchema(value)))
            case "anyOf", "oneOf", "allOf", "prefixItems":
                out.append((key, .array((value.array ?? []).map(grammarSchema))))
            default:
                out.append((key, value))
            }
        }
        return .object(out)
    }

    /// A parameter is written as plain text in Qwen's XML (`<parameter=detail>` low `</parameter>`), but XGrammar
    /// v0.1.30 spells an `enum` or `const` as JSON even there (`"low"`, quotes and all): held to that, the 9B wrote
    /// newlines until it ran out of tokens. So each parameter's text choices become a pattern, which XGrammar
    /// matches as plain text. Values nested inside a parameter are JSON and keep their enums.
    static func xmlParameters(_ schema: JSONValue) -> JSONValue {
        guard let pairs = schema.objectPairs else { return schema }
        return .object(pairs.map { key, value in
            guard key == "properties", let properties = value.objectPairs else { return (key, value) }
            return (key, .object(properties.map { ($0.0, plainTextChoices($0.1)) }))
        })
    }

    /// `{"enum": ["a", "b"]}` or `{"const": "a"}` with only strings, as a pattern; in an `anyOf` or `oneOf`, each
    /// branch so.
    static func plainTextChoices(_ schema: JSONValue) -> JSONValue {
        guard let pairs = schema.objectPairs else { return schema }
        let texts: [String]?
        if let values = schema["enum"]?.array {
            let strings = values.compactMap(\.string)
            texts = strings.count == values.count && !strings.isEmpty ? strings : nil
        } else if let value = schema["const"]?.string {
            texts = [value]
        } else {
            texts = nil
        }
        if let texts {
            var out = pairs.filter { !["enum", "const", "type", "pattern"].contains($0.0) }
            out.insert(("type", .string("string")), at: 0)
            out.append(("pattern", .string("^(" + texts.map(regexEscaped).joined(separator: "|") + ")$")))
            return .object(out)
        }
        return .object(pairs.map { key, value in
            guard key == "anyOf" || key == "oneOf", let branches = value.array else { return (key, value) }
            return (key, .array(branches.map(plainTextChoices)))
        })
    }

    static func regexEscaped(_ text: String) -> String {
        var out = ""
        for character in text {
            if "\\^$.|?*+()[]{}".contains(character) { out.append("\\") }
            out.append(character)
        }
        return out
    }

    /// XGrammar's Qwen XML format takes an object schema only: no schema, or one without a type, is an object.
    static func objectSchema(_ parameters: JSONValue?) -> JSONValue {
        guard let parameters, case .object(var pairs) = parameters else {
            return .object([("type", .string("object")), ("properties", .object([]))])
        }
        if parameters["type"] == nil { pairs.insert(("type", .string("object")), at: 0) }
        return .object(pairs)
    }
}

/// When a call starts: the token `<tool_call>` in the answer, and while the model is thinking only after its
/// `</think>` (a call it muses about isn't one), as llama-server's grammar wakes after the reasoning.
public struct ToolCallTrigger: Sendable {
    let open: Int
    let thinkEnd: Int?
    var thinking: Bool

    /// - thinking: the prompt leaves the model inside `<think>` (its last `<think>` has no `</think>` after it).
    public init(open: Int, thinkEnd: Int?, thinking: Bool) {
        self.open = open
        self.thinkEnd = thinkEnd
        self.thinking = thinking && thinkEnd != nil
    }

    /// Whether the prompt leaves the model thinking.
    public static func promptLeavesThinking(_ prompt: [Int], thinkStart: Int?, thinkEnd: Int?) -> Bool {
        guard let thinkStart, let start = prompt.lastIndex(of: thinkStart) else { return false }
        guard let thinkEnd else { return true }
        return !prompt[start...].contains(thinkEnd)
    }

    /// Sees one generated token outside a call; true when it opens one.
    public mutating func opens(_ token: Int) -> Bool {
        if thinking {
            if token == thinkEnd { thinking = false }
            return false
        }
        return token == open
    }
}
