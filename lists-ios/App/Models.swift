import Foundation

/// One item on a list.
///
/// `done` is a real Bool here because the service converts SQLite's 0/1 before
/// it ever reaches the wire — see toItem() in src/store.ts. Decoding it as Int
/// would work today and break the moment that conversion is relied upon.
struct Item: Codable, Identifiable, Equatable {
    let id: String
    let listID: String
    let text: String
    var done: Bool
    let position: Int
    let createdAt: String

    enum CodingKeys: String, CodingKey {
        case id
        case listID = "list_id"
        case text
        case done
        case position
        case createdAt = "created_at"
    }
}

/// A list as it appears in the index: no items, just a count.
///
/// `itemCount` is optional because the service only computes it on the paths
/// where it is cheap. Declaring it non-optional would fail to decode exactly
/// the responses that omit it — the mistake questions-ios documents having
/// made with its own model.
struct ListSummary: Codable, Identifiable, Equatable {
    let id: String
    let title: String
    let createdAt: String
    let updatedAt: String
    var itemCount: Int?

    enum CodingKeys: String, CodingKey {
        case id
        case title
        case createdAt = "created_at"
        case updatedAt = "updated_at"
        case itemCount = "item_count"
    }
}

/// A list with its items, from `GET /api/lists/:id`.
struct ListDetail: Codable, Identifiable, Equatable {
    let id: String
    let title: String
    let createdAt: String
    let updatedAt: String
    var items: [Item]

    enum CodingKeys: String, CodingKey {
        case id
        case title
        case createdAt = "created_at"
        case updatedAt = "updated_at"
        case items
    }
}

/// Where a fetch has got to. Modelled explicitly so "loading" and "loaded but
/// empty" cannot render as the same blank screen.
enum LoadState<Value: Equatable>: Equatable {
    case idle
    case loading
    case loaded(Value)
    case failed(String)
}
