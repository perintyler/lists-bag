import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import Database from "better-sqlite3";
import { barryHome } from "@barry-rocks/sdk/services/home";

export type ListsDb = Database.Database;

let _db: ListsDb | null = null;

export function getDbPath(): string {
  return (
    process.env.BARRY_LISTS_DB ??
    join(barryHome(), "lists.db")
  );
}

/**
 * Migrations are inline TypeScript rather than a `migrations/` dir of .sql
 * files: reading SQL via `import.meta.url` breaks once esbuild bundles this
 * bag into ~/Library/Caches/Barry/bags/ — the same reason bags/plans,
 * bags/memory and bags/approvals inline theirs.
 *
 * Append only. Never edit a shipped migration — add a new one.
 */
const MIGRATIONS: Array<{ name: string; sql: string }> = [
  {
    name: "001_initial",
    sql: `
      CREATE TABLE lists (
        id         TEXT PRIMARY KEY,
        title      TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE items (
        id      TEXT PRIMARY KEY,
        list_id TEXT NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
        text    TEXT NOT NULL,
        done    INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0, 1)),
        -- Manual ordering. Sparse by design: new items take max+1, so an
        -- insert never has to renumber its siblings.
        position   INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX idx_items_list ON items(list_id, position);
    `,
  },
];

function migrate(db: ListsDb): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const row = db
    .prepare("SELECT coalesce(max(version), 0) AS version FROM schema_migrations")
    .get() as { version: number };

  // Refuse a database written by a newer build rather than running the older
  // code against it: a missing column fails loudly here instead of corrupting
  // rows halfway through a write.
  if (row.version > MIGRATIONS.length) {
    throw new Error(
      `lists.db is at schema version ${row.version}, but this build only knows ` +
        `${MIGRATIONS.length}. Update barry before using this database.`,
    );
  }

  for (let v = row.version; v < MIGRATIONS.length; v++) {
    const m = MIGRATIONS[v]!;
    const apply = db.transaction(() => {
      db.exec(m.sql);
      db.prepare("INSERT INTO schema_migrations (version, name) VALUES (?, ?)").run(
        v + 1,
        m.name,
      );
      // A derived mirror, so `sqlite3 lists.db 'pragma user_version'` answers
      // "what schema is this?" without knowing the schema. schema_migrations
      // stays the source of truth.
      db.pragma(`user_version = ${v + 1}`);
    });
    apply();
  }
}

export function getDb(path = getDbPath()): ListsDb {
  if (!_db) {
    mkdirSync(dirname(path), { recursive: true });
    const db = new Database(path);
    // WAL: the service, the tools and the phone hold this file concurrently.
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");
    // Explicit, not inherited. better-sqlite3 happens to default this ON,
    // but the default is the driver's to change and SQLite's own default is
    // OFF. Without it the items->lists ON DELETE CASCADE silently never fires
    // and a deleted list orphans every one of its items, with no error.
    db.pragma("foreign_keys = ON");
    db.pragma("busy_timeout = 5000");
    migrate(db);
    _db = db;
  }
  return _db;
}

/** Test seam: point the module at an in-memory database. */
export function setDb(db: ListsDb): void {
  db.pragma("foreign_keys = ON");
  migrate(db);
  _db = db;
}

export function closeDb(): void {
  _db?.close();
  _db = null;
}
