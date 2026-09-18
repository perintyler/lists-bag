import SwiftUI

struct ListDetailView: View {
    let listID: String
    let title: String

    @EnvironmentObject private var store: AppStore
    @State private var newItem = ""
    @FocusState private var addFieldFocused: Bool

    var body: some View {
        Group {
            switch store.detail {
            case .idle, .loading:
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)

            case .failed(let message):
                VStack(spacing: 14) {
                    Text(message)
                        .multilineTextAlignment(.center)
                        .foregroundStyle(.secondary)
                    Button("Retry") { Task { await store.openList(id: listID) } }
                }
                .padding()

            case .loaded(let detail):
                List {
                    Section {
                        if detail.items.isEmpty {
                            Text("No items yet.").foregroundStyle(.secondary)
                        }
                        ForEach(detail.items) { item in
                            Button {
                                Task {
                                    await store.setItemDone(
                                        listID: listID, itemID: item.id, done: !item.done
                                    )
                                }
                            } label: {
                                HStack(spacing: Theme.rowSpacing) {
                                    Image(systemName: item.done ? "checkmark.circle.fill" : "circle")
                                        .foregroundStyle(item.done ? Color.accentColor : .secondary)
                                    Text(item.text)
                                        .strikethrough(item.done)
                                        .foregroundStyle(item.done ? .secondary : .primary)
                                    Spacer()
                                }
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .accessibilityLabel(item.text)
                            .accessibilityValue(item.done ? "Done" : "Not done")
                        }
                        .onDelete { offsets in
                            for index in offsets {
                                let id = detail.items[index].id
                                Task { await store.deleteItem(listID: listID, itemID: id) }
                            }
                        }
                    }

                    Section {
                        HStack {
                            TextField("Add an item…", text: $newItem)
                                .focused($addFieldFocused)
                                .submitLabel(.done)
                                .onSubmit(add)
                            Button("Add", action: add)
                                .disabled(
                                    newItem.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                                )
                        }
                    }
                }
            }
        }
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .task { await store.openList(id: listID) }
    }

    private func add() {
        let text = newItem.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return }
        newItem = ""
        // Keep focus so a run of items can be typed without re-tapping.
        addFieldFocused = true
        Task { await store.addItem(listID: listID, text: text) }
    }
}
