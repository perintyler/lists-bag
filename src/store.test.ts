import { beforeEach, afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { closeDb, getDb, setDb } from "./db.js";
import {
  addItem,
  createList,
  deleteItem,
  deleteList,
  getList,
  listLists,
  renameList,
  setItemDone,
} from "./store.js";

beforeEach(() => {
  setDb(new Database(":memory:"));
});

afterEach(() => {
  closeDb();
});

describe("lists", () => {
  it("creates a list and reads it back", () => {
    const created = createList("Groceries");
    expect(created.title).toBe("Groceries");
    expect(created.id).toBeTruthy();

    const fetched = getList(created.id);
    expect(fetched?.title).toBe("Groceries");
    expect(fetched?.items).toEqual([]);
  });

  it("trims the title and rejects an empty one", () => {
    expect(createList("  Books  ").title).toBe("Books");
    expect(() => createList("   ")).toThrow(/title cannot be empty/);
  });

  it("returns null for a list that does not exist", () => {
    expect(getList("nope")).toBeNull();
  });

  it("counts items without fetching them", () => {
    const list = createList("Chores");
    addItem(list.id, "sweep");
    addItem(list.id, "mop");
    expect(listLists()[0]!.item_count).toBe(2);
  });

  it("orders lists by most recently updated", () => {
    const first = createList("First");
    const second = createList("Second");
    // Touching the older list should float it to the top.
    addItem(first.id, "something");
    expect(listLists().map((l) => l.id)).toEqual([first.id, second.id]);
  });

  it("renames a list, and reports a missing one", () => {
    const list = createList("Old");
    expect(renameList(list.id, "New")?.title).toBe("New");
    expect(renameList("nope", "New")).toBeNull();
  });

  it("reports whether a delete actually removed anything", () => {
    const list = createList("Temp");
    expect(deleteList(list.id)).toBe(true);
    expect(deleteList(list.id)).toBe(false);
  });
});

describe("items", () => {
  it("adds items and preserves insertion order", () => {
    const list = createList("Trip");
    addItem(list.id, "passport");
    addItem(list.id, "tickets");
    addItem(list.id, "charger");

    expect(getList(list.id)!.items.map((i) => i.text)).toEqual([
      "passport",
      "tickets",
      "charger",
    ]);
  });

  it("refuses to add to a list that does not exist", () => {
    expect(addItem("nope", "orphan")).toBeNull();
  });

  it("rejects empty item text", () => {
    const list = createList("Trip");
    expect(() => addItem(list.id, "  ")).toThrow(/text cannot be empty/);
  });

  it("returns done as a boolean, not SQLite's 0/1", () => {
    const list = createList("Chores");
    const item = addItem(list.id, "dishes")!;
    expect(item.done).toBe(false);

    const toggled = setItemDone(item.id, true)!;
    expect(toggled.done).toBe(true);
    expect(getList(list.id)!.items[0]!.done).toBe(true);
  });

  it("reports a missing item rather than pretending to update it", () => {
    expect(setItemDone("nope", true)).toBeNull();
    expect(deleteItem("nope")).toBe(false);
  });

  it("deletes a single item and leaves its siblings", () => {
    const list = createList("Trip");
    const a = addItem(list.id, "passport")!;
    addItem(list.id, "tickets");

    expect(deleteItem(a.id)).toBe(true);
    expect(getList(list.id)!.items.map((i) => i.text)).toEqual(["tickets"]);
  });

  /**
   * The cascade only fires because db.ts sets `foreign_keys = ON` per
   * connection. Verified by hand that a connection with the pragma OFF leaves
   * the item behind: the rows accumulate as orphans with no visible error.
   * (better-sqlite3 currently defaults it ON, but SQLite's own default is OFF
   * and the driver's is not ours to rely on.) Asserting on the items table,
   * not through getList, because getList filters by list_id and would report
   * an empty list either way.
   */
  it("cascades a list delete to its items", () => {
    const list = createList("Doomed");
    addItem(list.id, "a");
    addItem(list.id, "b");

    deleteList(list.id);

    const orphans = getDb()
      .prepare("SELECT count(*) AS n FROM items WHERE list_id = ?")
      .get(list.id) as { n: number };
    expect(orphans.n).toBe(0);
  });

  it("touches the parent list when its items change", () => {
    const list = createList("Chores");
    const before = listLists()[0]!.updated_at;
    addItem(list.id, "later");
    expect(listLists()[0]!.updated_at >= before).toBe(true);
  });
});
