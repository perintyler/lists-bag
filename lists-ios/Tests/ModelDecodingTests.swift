import XCTest
@testable import Lists

/// Decoding tests against the service's REAL response shapes.
///
/// questions-ios documents learning this the hard way: a model ported by hand
/// from another surface failed to decode the live store because it declared
/// fields non-optional that real rows carry as null. These payloads are copied
/// from the service's actual output, not invented.
final class ModelDecodingTests: XCTestCase {
    func testDecodesListSummaryWithItemCount() throws {
        let json = """
        {"id":"abc","title":"Groceries","created_at":"2026-09-17T00:00:00.000Z",
         "updated_at":"2026-09-17T00:00:00.000Z","item_count":3}
        """.data(using: .utf8)!

        let list = try JSONDecoder().decode(ListSummary.self, from: json)
        XCTAssertEqual(list.title, "Groceries")
        XCTAssertEqual(list.itemCount, 3)
    }

    /// `item_count` is absent on the create/rename responses. A non-optional
    /// field here would throw on exactly those payloads.
    func testDecodesListSummaryWithoutItemCount() throws {
        let json = """
        {"id":"abc","title":"Groceries","created_at":"2026-09-17T00:00:00.000Z",
         "updated_at":"2026-09-17T00:00:00.000Z"}
        """.data(using: .utf8)!

        let list = try JSONDecoder().decode(ListSummary.self, from: json)
        XCTAssertNil(list.itemCount)
    }

    func testDecodesItemWithBooleanDone() throws {
        let json = """
        {"id":"i1","list_id":"abc","text":"milk","done":true,"position":1,
         "created_at":"2026-09-17T00:00:00.000Z"}
        """.data(using: .utf8)!

        let item = try JSONDecoder().decode(Item.self, from: json)
        XCTAssertEqual(item.text, "milk")
        XCTAssertTrue(item.done)
        XCTAssertEqual(item.listID, "abc")
    }

    func testDecodesListDetailWithItems() throws {
        let json = """
        {"id":"abc","title":"Trip","created_at":"2026-09-17T00:00:00.000Z",
         "updated_at":"2026-09-17T00:00:00.000Z",
         "items":[{"id":"i1","list_id":"abc","text":"passport","done":false,
                   "position":1,"created_at":"2026-09-17T00:00:00.000Z"}]}
        """.data(using: .utf8)!

        let detail = try JSONDecoder().decode(ListDetail.self, from: json)
        XCTAssertEqual(detail.items.count, 1)
        XCTAssertEqual(detail.items.first?.text, "passport")
        XCTAssertFalse(detail.items.first?.done ?? true)
    }

    func testDecodesEmptyItemList() throws {
        let json = """
        {"id":"abc","title":"Empty","created_at":"2026-09-17T00:00:00.000Z",
         "updated_at":"2026-09-17T00:00:00.000Z","items":[]}
        """.data(using: .utf8)!

        XCTAssertTrue(try JSONDecoder().decode(ListDetail.self, from: json).items.isEmpty)
    }
}

final class ServerConfigTests: XCTestCase {
    /// The Host header is what makes the device path work: Caddy selects the
    /// vhost from it. A request built without one reaches Caddy's default site.
    func testAppliesHostHeaderAndBearerSecret() throws {
        let config = ServerConfig(
            baseURL: "http://100.97.236.110",
            hostHeader: "lists.barry.lan",
            secret: "s3cr3t"
        )
        let req = try XCTUnwrap(config.request(path: "/api/lists"))

        XCTAssertEqual(req.value(forHTTPHeaderField: "Host"), "lists.barry.lan")
        XCTAssertEqual(req.value(forHTTPHeaderField: "authorization"), "Bearer s3cr3t")
        XCTAssertEqual(req.url?.absoluteString, "http://100.97.236.110/api/lists")
    }

    /// On the simulator there is no secret and no vhost. Sending an empty
    /// bearer would be worse than sending nothing: the service compares it
    /// against BARRY_SECRET and 401s.
    func testOmitsEmptyHeaders() throws {
        let config = ServerConfig(baseURL: "http://127.0.0.1:4885", hostHeader: "", secret: "")
        let req = try XCTUnwrap(config.request(path: "/health"))

        XCTAssertNil(req.value(forHTTPHeaderField: "Host"))
        XCTAssertNil(req.value(forHTTPHeaderField: "authorization"))
    }

    /// A typo in Settings must fail here, not as a baffling transport error
    /// later. URLComponents accepts most of these as RELATIVE paths, so
    /// without an explicit scheme+host check they all build a request.
    func testRejectsAMalformedBaseURL() {
        for bad in ["not a url", "", "lists.barry.lan", "/api", "ftp://host"] {
            let config = ServerConfig(baseURL: bad, hostHeader: "", secret: "")
            XCTAssertNil(config.request(path: "/api/lists"), "should reject \(bad)")
        }
    }

    func testAcceptsBothHTTPSchemes() {
        for good in ["http://127.0.0.1:4885", "https://lists.barry.rocks"] {
            let config = ServerConfig(baseURL: good, hostHeader: "", secret: "")
            XCTAssertNotNil(config.request(path: "/api/lists"), "should accept \(good)")
        }
    }
}
