import Foundation
import SwiftUI

/// The app's state, and the only place that talks to the client.
@MainActor
final class AppStore: ObservableObject {
    @Published var config: ServerConfig
    @Published var lists: LoadState<[ListSummary]> = .idle
    @Published var detail: LoadState<ListDetail> = .idle
    /// Set when a write fails. The list itself stays on screen — a failed add
    /// should not blank the thing the user is looking at.
    @Published var actionError: String?

    private var client: ListsClient

    init(config: ServerConfig = .load()) {
        self.config = config
        self.client = ListsClient(config: config)
    }

    func updateConfig(_ new: ServerConfig) {
        config = new
        config.save()
        client = ListsClient(config: new)
        Task { await loadLists() }
    }

    func loadLists() async {
        if case .loaded = lists {} else { lists = .loading }
        do {
            lists = .loaded(try await client.lists())
        } catch {
            lists = .failed(describe(error))
        }
    }

    func openList(id: String) async {
        detail = .loading
        await reloadDetail(id: id)
    }

    /// Refresh the open list without flashing a spinner — used after a write,
    /// where the content is already on screen.
    private func reloadDetail(id: String) async {
        do {
            detail = .loaded(try await client.list(id: id))
        } catch {
            detail = .failed(describe(error))
        }
    }

    func createList(title: String) async -> String? {
        do {
            let created = try await client.createList(title: title)
            await loadLists()
            return created.id
        } catch {
            actionError = describe(error)
            return nil
        }
    }

    func deleteList(id: String) async {
        do {
            try await client.deleteList(id: id)
            detail = .idle
            await loadLists()
        } catch {
            actionError = describe(error)
        }
    }

    func addItem(listID: String, text: String) async {
        do {
            _ = try await client.addItem(listID: listID, text: text)
            await reloadDetail(id: listID)
            await loadLists()
        } catch {
            actionError = describe(error)
        }
    }

    func setItemDone(listID: String, itemID: String, done: Bool) async {
        do {
            _ = try await client.setItemDone(id: itemID, done: done)
            await reloadDetail(id: listID)
        } catch {
            actionError = describe(error)
            // Re-read, so the checkbox does not stay flipped after a failure.
            await reloadDetail(id: listID)
        }
    }

    func deleteItem(listID: String, itemID: String) async {
        do {
            try await client.deleteItem(id: itemID)
            await reloadDetail(id: listID)
            await loadLists()
        } catch {
            actionError = describe(error)
        }
    }

    func testConnection() async -> String {
        do {
            return try await client.health() ? "Connected." : "Server answered, but not OK."
        } catch {
            return describe(error)
        }
    }

    /// Turn a URLError into something that names the likely cause. "The
    /// operation couldn't be completed" tells the reader nothing about which
    /// of the two hosts is wrong.
    private func describe(_ error: Error) -> String {
        if let listsError = error as? ListsError {
            return listsError.errorDescription ?? String(describing: listsError)
        }
        if let urlError = error as? URLError {
            switch urlError.code {
            case .cannotConnectToHost, .cannotFindHost, .timedOut, .networkConnectionLost:
                return "Can't reach \(config.baseURL). Is the Mac on the tailnet, and the lists service running?"
            default:
                return urlError.localizedDescription
            }
        }
        return error.localizedDescription
    }
}
