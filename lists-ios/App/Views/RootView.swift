import SwiftUI

struct RootView: View {
    @EnvironmentObject private var store: AppStore
    @State private var showingSettings = false
    @State private var newListTitle = ""
    @State private var showingNewList = false

    var body: some View {
        NavigationStack {
            content
                .navigationTitle("Lists")
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) {
                        Button { showingSettings = true } label: {
                            Image(systemName: "gearshape")
                        }
                        .accessibilityLabel("Settings")
                    }
                    ToolbarItem(placement: .topBarTrailing) {
                        Button { showingNewList = true } label: {
                            Image(systemName: "plus")
                        }
                        .accessibilityLabel("New list")
                    }
                }
                .sheet(isPresented: $showingSettings) {
                    SettingsView().environmentObject(store)
                }
                .alert("New list", isPresented: $showingNewList) {
                    TextField("Title", text: $newListTitle)
                    Button("Cancel", role: .cancel) { newListTitle = "" }
                    Button("Create") { create() }
                } message: {
                    Text("What do you want to call it?")
                }
                .alert(
                    "Something went wrong",
                    isPresented: Binding(
                        get: { store.actionError != nil },
                        set: { if !$0 { store.actionError = nil } }
                    )
                ) {
                    Button("OK", role: .cancel) { store.actionError = nil }
                } message: {
                    Text(store.actionError ?? "")
                }
        }
        .task { await store.loadLists() }
    }

    @ViewBuilder
    private var content: some View {
        switch store.lists {
        case .idle, .loading:
            ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)

        case .failed(let message):
            // A failure is not an empty state: say what broke and offer the
            // two things that fix it.
            VStack(spacing: 14) {
                Image(systemName: "exclamationmark.triangle")
                    .font(.largeTitle)
                    .foregroundStyle(.secondary)
                Text(message)
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.secondary)
                HStack {
                    Button("Retry") { Task { await store.loadLists() } }
                    Button("Settings") { showingSettings = true }
                }
            }
            .padding()
            .frame(maxWidth: .infinity, maxHeight: .infinity)

        case .loaded(let lists):
            if lists.isEmpty {
                VStack(spacing: 10) {
                    Text("No lists yet").font(.headline)
                    Text("Tap + to make one.").foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                List {
                    ForEach(lists) { list in
                        NavigationLink {
                            ListDetailView(listID: list.id, title: list.title)
                                .environmentObject(store)
                        } label: {
                            HStack {
                                Text(list.title)
                                Spacer()
                                Text("\(list.itemCount ?? 0)")
                                    .foregroundStyle(.secondary)
                                    .monospacedDigit()
                            }
                        }
                    }
                    .onDelete { offsets in
                        for index in offsets {
                            let id = lists[index].id
                            Task { await store.deleteList(id: id) }
                        }
                    }
                }
                .refreshable { await store.loadLists() }
            }
        }
    }

    private func create() {
        let title = newListTitle.trimmingCharacters(in: .whitespacesAndNewlines)
        newListTitle = ""
        guard !title.isEmpty else { return }
        Task { _ = await store.createList(title: title) }
    }
}
