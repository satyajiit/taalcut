// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation
import Testing

@testable import MLXServerProtocol

@Suite struct ToolCallStructureTests {
    let tools = try! JSONValue.parse(
        #"[{"type":"function","function":{"name":"a","parameters":{"type":"object","properties":{"n":{"type":"integer"}},"required":["n"]}}},"#
            + #"{"type":"function","function":{"name":"b"}},"#
            + #"{"type":"function","function":{"name":"a","parameters":{"type":"object"}}}]"#
    ).array!

    @Test func holdsEachOfferedFunctionToItsSchemaLaidOutAsTheTemplateWritesACall() throws {
        let tag = try JSONValue.parse(ToolCallStructure.structuralTag(tools: tools))
        #expect(tag["type"]?.string == "structural_tag")
        let elements = try #require(tag["format"]?["elements"]?.array)
        #expect(elements.first?["value"]?.string == "\n")
        #expect(elements.last?["value"]?.string == "\n</tool_call>")
        let calls = try #require(elements[1]["elements"]?.array)
        // Each name once, in the order offered; a tool without parameters takes an empty object.
        #expect(calls.compactMap { $0["begin"]?.string } == ["<function=a>", "<function=b>"])
        #expect(calls.allSatisfy { $0["end"]?.string == "\n</function>" && $0["content"]?["type"]?.string == "qwen_xml_parameter" })
        #expect(calls[0]["content"]?["json_schema"]?["required"]?.array?.first?.string == "n")
        #expect(calls[1]["content"]?["json_schema"]?.serialized() == #"{"type":"object","properties":{}}"#)
    }

    @Test func givesARelaxedToolAnyArgumentsAndOneToolNoChoice() throws {
        let one = Array(tools.prefix(1))
        let tag = try JSONValue.parse(ToolCallStructure.structuralTag(tools: one, relaxed: ["a"]))
        let call = try #require(tag["format"]?["elements"]?.array?[1])
        #expect(call["type"]?.string == "tag")
        #expect(call["content"]?["json_schema"]?.serialized() == #"{"type":"object","additionalProperties":true}"#)
    }

    @Test func leavesCountsAndLengthsToTheToolButKeepsTheShape() throws {
        let schema = try JSONValue.parse(
            #"{"type":"object","properties":{"pattern":{"type":"string","maxLength":9,"pattern":"^a$"},"#
                + #""list":{"type":"array","minItems":1,"maxItems":12,"items":{"type":"object","properties":{"#
                + #""n":{"type":"integer","minimum":0}},"required":["n"]}},"#
                + #""shot":{"anyOf":[{"type":"string","enum":["wide"],"minLength":1},{"type":"null"}]}},"required":["list"]}"#)
        #expect(
            ToolCallStructure.grammarSchema(schema).serialized()
                == #"{"type":"object","properties":{"pattern":{"type":"string"},"#
                + #""list":{"type":"array","items":{"type":"object","properties":{"n":{"type":"integer"}},"required":["n"]}},"#
                + #""shot":{"anyOf":[{"type":"string","enum":["wide"]},{"type":"null"}]}},"required":["list"]}"#)
    }

    @Test func writesAParametersTextChoicesAsAPatternAndKeepsNestedEnums() throws {
        let schema = try JSONValue.parse(
            #"{"type":"object","properties":{"detail":{"type":"string","enum":["low","a.b"],"default":"low"},"#
                + #""mode":{"const":"story"},"n":{"enum":[1,2]},"#
                + #""place":{"anyOf":[{"type":"string","enum":["x"]},{"type":"null"}]},"#
                + #""at":{"type":"object","properties":{"unit":{"type":"string","enum":["s"]}}}}}"#)
        let properties = try #require(ToolCallStructure.xmlParameters(schema)["properties"])
        #expect(properties["detail"]?.serialized() == #"{"type":"string","default":"low","pattern":"^(low|a\\.b)$"}"#)
        #expect(properties["mode"]?.serialized() == #"{"type":"string","pattern":"^(story)$"}"#)
        #expect(properties["n"]?.serialized() == #"{"enum":[1,2]}"#)
        #expect(properties["place"]?["anyOf"]?.array?.first?.serialized() == #"{"type":"string","pattern":"^(x)$"}"#)
        #expect(properties["at"]?["properties"]?["unit"]?.serialized() == #"{"type":"string","enum":["s"]}"#)
    }

    @Test func aSchemaWithoutATypeIsAnObject() {
        let schema = ToolCallStructure.objectSchema(.object([("properties", .object([]))]))
        #expect(schema.serialized() == #"{"type":"object","properties":{}}"#)
    }
}

@Suite struct ToolCallTriggerTests {
    @Test func opensOnTheToolCallToken() {
        var trigger = ToolCallTrigger(open: 7, thinkEnd: 9, thinking: false)
        let seen = [1, 7].map { trigger.opens($0) }
        #expect(seen == [false, true])
    }

    @Test func whileThinkingOpensOnlyAfterTheThoughtEnds() {
        var trigger = ToolCallTrigger(open: 7, thinkEnd: 9, thinking: true)
        let seen = [7, 9, 7].map { trigger.opens($0) }
        #expect(seen == [false, false, true])
    }

    @Test func readsWhetherThePromptLeavesTheModelThinking() {
        #expect(ToolCallTrigger.promptLeavesThinking([1, 8, 2], thinkStart: 8, thinkEnd: 9))
        #expect(!ToolCallTrigger.promptLeavesThinking([1, 8, 2, 9, 3], thinkStart: 8, thinkEnd: 9))
        #expect(!ToolCallTrigger.promptLeavesThinking([8, 9, 1, 2], thinkStart: 8, thinkEnd: 9))
        #expect(ToolCallTrigger.promptLeavesThinking([8, 9, 8, 2], thinkStart: 8, thinkEnd: 9))
        #expect(!ToolCallTrigger.promptLeavesThinking([1, 2], thinkStart: 8, thinkEnd: 9))
    }
}
