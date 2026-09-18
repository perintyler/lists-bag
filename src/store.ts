import { randomUUID } from "node:crypto";
import { getDb } from "./db.js";

export interface Item {
  id: string;
  list_id: string;
  text: string;
  done: boolean;
  position: number;
  created_at: string;
}

export interface List {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  /** Present on list rows (a count) so the index does not need an item fetch. */
  item_count?: number;
}

export interface ListWithItems extends List {
  items: Item[];
}

/** Raw shapes, before the INTEGER->boolean conversion SQLite cannot do. */
interface ItemRow extends Omit<Item, "done"> {
  done: number;
}

function toItem(row: ItemRow): Item {
  // SQLite has no boolean type: `done` comes back as 0/1 and would serialize
  // to JSON as a number, which every client then has to special-case.
  return { ...row, done: row.done === 1 };
}

function now(): string {
  return new Date().toISOString();
}

export function createList(title: string): List {
  const trimmed = title.trim();
  if (!trimmed) throw new Error("title cannot be empty");

  const db = getDb();
  const ts = now();
  const list: List = { id: randomUUID(), title: trimmed, created_at: ts, updated_at: ts };
  db.prepare(
    "INSERT INTO lists (id, title, created_at, updated_at) VALUES (?, ?, ?, ?)",
  ).run(list.id, list.title, list.created_at, list.updated_at);
  return { ...list, item_count: 0 };
}

export function listLists(): List[] {
  return getDb()
    .prepare(
      `SELECT l.id, l.title, l.created_at, l.updated_at,
              (SELECT count(*) FROM items WHERE items.list_id = l.id) AS item_count
         FROM lists l
        ORDER BY l.updated_at DESC`,
    )
    .all() as List[];
}

export function getList(id: string): ListWithItems | null {
  const db = getDb();
  const list = db.prepare("SELECT * FROM lists WHERE id = ?").get(id) as List | undefined;
  if (!list) return null;

  const rows = db
    .prepare("SELECT * FROM items WHERE list_id = ? ORDER BY position, created_at")
    .all(id) as ItemRow[];
  return { ...list, items: rows.map(toItem), item_count: rows.length };
}

export function renameList(id: string, title: string): List | null {
  const trimmed = title.trim();
  if (!trimmed) throw new Error("title cannot be empty");

  const db = getDb();
  const result = db
    .prepare("UPDATE lists SET title = ?, updated_at = ? WHERE id = ?")
    .run(trimmed, now(), id);
  if (result.changes === 0) return null;
  return db.prepare("SELECT * FROM lists WHERE id = ?").get(id) as List;
}

/** Returns false when the list did not exist, so a caller can 404 honestly. */
export function deleteList(id: string): boolean {
  // Items go with it via ON DELETE CASCADE — which only fires because db.ts
  // turns foreign_keys on for every connection.
  return getDb().prepare("DELETE FROM lists WHERE id = ?").run(id).changes > 0;
}

function touchList(listId: string): void {
  getDb().prepare("UPDATE lists SET updated_at = ? WHERE id = ?").run(now(), listId);
}

export function addItem(listId: string, text: string): Item | null {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("text cannot be empty");

  const db = getDb();
  const exists = db.prepare("SELECT 1 FROM lists WHERE id = ?").get(listId);
  if (!exists) return null;

  const next = db
    .prepare("SELECT coalesce(max(position), 0) + 1 AS pos FROM items WHERE list_id = ?")
    .get(listId) as { pos: number };

  const item: Item = {
    id: randomUUID(),
    list_id: listId,
    text: trimmed,
    done: false,
    position: next.pos,
    created_at: now(),
  };
  db.prepare(
    `INSERT INTO items (id, list_id, text, done, position, created_at)
     VALUES (?, ?, ?, 0, ?, ?)`,
  ).run(item.id, item.list_id, item.text, item.position, item.created_at);
  touchList(listId);
  return item;
}

export function setItemDone(id: string, done: boolean): Item | null {
  const db = getDb();
  const result = db.prepare("UPDATE items SET done = ? WHERE id = ?").run(done ? 1 : 0, id);
  if (result.changes === 0) return null;
  const row = db.prepare("SELECT * FROM items WHERE id = ?").get(id) as ItemRow;
  touchList(row.list_id);
  return toItem(row);
}

export function deleteItem(id: string): boolean {
  const db = getDb();
  // Read the parent BEFORE deleting: afterwards there is no row to learn it
  // from, and the list's updated_at would silently stop tracking its items.
  const row = db.prepare("SELECT list_id FROM items WHERE id = ?").get(id) as
    | { list_id: string }
    | undefined;
  if (!row) return false;

  const deleted = db.prepare("DELETE FROM items WHERE id = ?").run(id).changes > 0;
  if (deleted) touchList(row.list_id);
  return deleted;
}
