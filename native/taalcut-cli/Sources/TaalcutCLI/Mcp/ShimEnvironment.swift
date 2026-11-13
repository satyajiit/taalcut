// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 Taalcut contributors

import Foundation

/// What `taalcut mcp` reads from its environment. The token never comes from argv: a process list shows argv
/// to every user on the Mac.
public struct ShimEnvironment: Sendable, Equatable {
    public static let tokenVariable = "TAALCUT_MCP_TOKEN"
    public static let urlVariable = "TAALCUT_MCP_URL"
    public static let endpointFileVariable = "TAALCUT_MCP_ENDPOINT_FILE"

    public let token: String
    /// TAALCUT_MCP_URL, already checked to be http://127.0.0.1.
    public let explicitURL: URL?
    /// Where the app's mcp process writes { url, pid, startedAt }.
    public let endpointFile: URL

    public enum Problem: Error, Equatable, CustomStringConvertible {
        case missingToken
        case malformedToken
        case notLoopback(String)

        public var description: String {
            switch self {
            case .missingToken: return "\(ShimEnvironment.tokenVariable) is not set; copy the setup text from Taalcut › Settings › External agents"
            case .malformedToken: return "\(ShimEnvironment.tokenVariable) is not a Taalcut connection key (tcm_…)"
            case .notLoopback(let url): return "\(ShimEnvironment.urlVariable) must be http://127.0.0.1:<port>/mcp, not \(url)"
            }
        }
    }

    public static func parse(_ environment: [String: String], home: URL) -> Result<ShimEnvironment, Problem> {
        guard let token = environment[tokenVariable]?.trimmingCharacters(in: .whitespacesAndNewlines), !token.isEmpty
        else { return .failure(.missingToken) }
        guard isToken(token) else { return .failure(.malformedToken) }
        var explicit: URL?
        if let raw = environment[urlVariable]?.trimmingCharacters(in: .whitespacesAndNewlines), !raw.isEmpty {
            guard let url = LoopbackURL.parse(raw) else { return .failure(.notLoopback(raw)) }
            explicit = url
        }
        let file = environment[endpointFileVariable].flatMap { $0.isEmpty ? nil : URL(fileURLWithPath: $0) }
            ?? defaultEndpointFile(home: home)
        return .success(ShimEnvironment(token: token, explicitURL: explicit, endpointFile: file))
    }

    /// The bearer's shape (core's MCP_TOKEN_PATTERN): `tcm_` and 43 base64url characters.
    static func isToken(_ text: String) -> Bool {
        let body = text.utf8.dropFirst(4)
        return text.hasPrefix("tcm_") && body.count == 43
            && body.allSatisfy { byte in
                (0x41...0x5A).contains(byte) || (0x61...0x7A).contains(byte) || (0x30...0x39).contains(byte)
                    || byte == 0x5F || byte == 0x2D
            }
    }

    /// ~/Library/Application Support/Taalcut/mcp/endpoint.json: the packaged app's userData.
    public static func defaultEndpointFile(home: URL) -> URL {
        home.appendingPathComponent("Library/Application Support/Taalcut/mcp/endpoint.json")
    }
}

/// The only addresses the shim ever connects to: plain HTTP on 127.0.0.1.
public enum LoopbackURL {
    public static func parse(_ raw: String) -> URL? {
        guard let components = URLComponents(string: raw),
            components.scheme?.lowercased() == "http",
            components.host == "127.0.0.1",
            components.user == nil, components.password == nil,
            let url = components.url
        else { return nil }
        return url
    }
}
