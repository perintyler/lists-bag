import Foundation

enum ListsError: LocalizedError, Equatable {
    case badURL
    case http(Int, String)
    case decoding(String)

    var errorDescription: String? {
        switch self {
        case .badURL:
            return "The server URL is not valid."
        case .http(let code, let detail):
            if code == 401 {
                return "Not authorized — set the secret in Settings."
            }
            if code == 404 {
                return "That list no longer exists."
            }
            return detail.isEmpty ? "Server error \(code)." : "Server error \(code): \(detail)"
        case .decoding(let detail):
            return "Could not read the server's response: \(detail)"
        }
    }
}

/// Talks to the lists service.
struct ListsClient {
    let config: ServerConfig
    var urlSession: URLSession = .shared

    private struct ListsResponse: Decodable { let lists: [ListSummary] }
    private struct ListResponse<T: Decodable>: Decodable { let list: T }
    private struct ItemResponse: Decodable { let item: Item }

    /// `/health` takes no auth, deliberately: a probe that needs a secret
    /// cannot tell "server down" from "wrong secret".
    func health() async throws -> Bool {
        guard let req = config.request(path: "/health") else { throw ListsError.badURL }
        let (_, response) = try await urlSession.data(for: req)
        return (response as? HTTPURLResponse)?.statusCode == 200
    }

    func lists() async throws -> [ListSummary] {
        try await get(ListsResponse.self, path: "/api/lists").lists
    }

    func list(id: String) async throws -> ListDetail {
        try await get(ListResponse<ListDetail>.self, path: "/api/lists/\(escape(id))").list
    }

    func createList(title: String) async throws -> ListSummary {
        try await send(
            ListResponse<ListSummary>.self,
            path: "/api/lists",
            method: "POST",
            body: ["title": title]
        ).list
    }

    func deleteList(id: String) async throws {
        _ = try await sendRaw(path: "/api/lists/\(escape(id))", method: "DELETE", body: nil)
    }

    func addItem(listID: String, text: String) async throws -> Item {
        try await send(
            ItemResponse.self,
            path: "/api/lists/\(escape(listID))/items",
            method: "POST",
            body: ["text": text]
        ).item
    }

    func setItemDone(id: String, done: Bool) async throws -> Item {
        try await send(
            ItemResponse.self,
            path: "/api/items/\(escape(id))",
            method: "PATCH",
            body: ["done": done]
        ).item
    }

    func deleteItem(id: String) async throws {
        _ = try await sendRaw(path: "/api/items/\(escape(id))", method: "DELETE", body: nil)
    }

    // MARK: - Transport

    /// Percent-encode a path segment. The ids are UUIDs today, so this is
    /// belt-and-braces — but a title-derived id later would break the URL
    /// silently without it.
    private func escape(_ value: String) -> String {
        value.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? value
    }

    private func get<T: Decodable>(_ type: T.Type, path: String) async throws -> T {
        guard let req = config.request(path: path) else { throw ListsError.badURL }
        return try decode(type, from: try await run(req))
    }

    private func send<T: Decodable>(
        _ type: T.Type,
        path: String,
        method: String,
        body: [String: Any]?
    ) async throws -> T {
        try decode(type, from: try await sendRaw(path: path, method: method, body: body))
    }

    private func sendRaw(path: String, method: String, body: [String: Any]?) async throws -> Data {
        guard var req = config.request(path: path) else { throw ListsError.badURL }
        req.httpMethod = method
        if let body {
            req.setValue("application/json", forHTTPHeaderField: "content-type")
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
        }
        return try await run(req)
    }

    private func run(_ req: URLRequest) async throws -> Data {
        let (data, response) = try await urlSession.data(for: req)
        let code = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard (200..<300).contains(code) else {
            // Surface the service's own `error` field when there is one: it
            // says which field was wrong, where the status code alone does not.
            var detail = ""
            if let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
               let message = obj["error"] as? String {
                detail = message
            }
            throw ListsError.http(code, detail)
        }
        return data
    }

    private func decode<T: Decodable>(_ type: T.Type, from data: Data) throws -> T {
        do {
            return try JSONDecoder().decode(type, from: data)
        } catch {
            throw ListsError.decoding(String(describing: error))
        }
    }
}
