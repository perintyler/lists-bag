import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { closeDb } from "../../src/db.js";

let base: string;
let dir: string;

// The DB path must be set before the server module imports the store, and the
// store opens lazily on first use, so per-test reassignment works.
dir = mkdtempSync(join(tmpdir(), "lists-server-"));
process.env.BARRY_LISTS_DB = join(dir, "lists.db");

/**
 * Pin the secret rather than inheriting the ambient one. A developer with
 * BARRY_SECRET exported would otherwise get 401s from every test, and a CI
 * box without it would silently exercise the no-auth path instead — the
 * tests would pass in both places while testing two different services.
 */
const SECRET = "test-secret-for-lists";
process.env.BARRY_SECRET = SECRET;

const { server } = await import("./index.js");

beforeAll(async () => {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address() as AddressInfo;
  base = `http://127.0.0.1:${addr.port}`;
});

afterAll(() => {
  server.close();
  rmSync(dir, { recursive: true, force: true });
  delete process.env.BARRY_LISTS_DB;
});

beforeEach(() => {
  closeDb();
  dir = mkdtempSync(join(tmpdir(), "lists-server-"));
  process.env.BARRY_LISTS_DB = join(dir, "lists.db");
});

afterEach(() => {
  closeDb();
  rmSync(dir, { recursive: true, force: true });
});

async function api(path: string, init?: RequestInit) {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${SECRET}`,
      ...init?.headers,
    },
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

describe("health", () => {
  it("answers without a secret", async () => {
    const { status, body } = await api("/health");
    expect(status).toBe(200);
    expect(body).toEqual({ ok: true, service: "lists" });
  });
});

describe("auth", () => {
  it("rejects an API call with no secret", async () => {
    const res = await fetch(`${base}/api/lists`);
    expect(res.status).toBe(401);
  });

  it("rejects a wrong secret", async () => {
    const res = await fetch(`${base}/api/lists`, {
      headers: { authorization: "Bearer not-the-secret" },
    });
    expect(res.status).toBe(401);
  });

  it("accepts the x-barry-secret spelling too", async () => {
    const res = await fetch(`${base}/api/lists`, { headers: { "x-barry-secret": SECRET } });
    expect(res.status).toBe(200);
  });
});

describe("lists api", () => {
  it("creates, reads, renames and deletes a list", async () => {
    const created = await api("/api/lists", {
      method: "POST",
      body: JSON.stringify({ title: "Groceries" }),
    });
    expect(created.status).toBe(201);
    const id = created.body.list.id;

    expect((await api("/api/lists")).body.lists).toHaveLength(1);
    expect((await api(`/api/lists/${id}`)).body.list.title).toBe("Groceries");

    const renamed = await api(`/api/lists/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ title: "Food" }),
    });
    expect(renamed.body.list.title).toBe("Food");

    expect((await api(`/api/lists/${id}`, { method: "DELETE" })).status).toBe(200);
    expect((await api(`/api/lists/${id}`)).status).toBe(404);
  });

  it("adds, checks off and deletes items", async () => {
    const list = (
      await api("/api/lists", { method: "POST", body: JSON.stringify({ title: "Trip" }) })
    ).body.list;

    const added = await api(`/api/lists/${list.id}/items`, {
      method: "POST",
      body: JSON.stringify({ text: "passport" }),
    });
    expect(added.status).toBe(201);
    expect(added.body.item.done).toBe(false);

    const itemId = added.body.item.id;
    const checked = await api(`/api/items/${itemId}`, {
      method: "PATCH",
      body: JSON.stringify({ done: true }),
    });
    expect(checked.body.item.done).toBe(true);

    expect((await api(`/api/items/${itemId}`, { method: "DELETE" })).status).toBe(200);
    expect((await api(`/api/lists/${list.id}`)).body.list.items).toEqual([]);
  });

  it("404s a missing list rather than inventing one", async () => {
    expect((await api("/api/lists/nope")).status).toBe(404);
    expect(
      (
        await api("/api/lists/nope/items", {
          method: "POST",
          body: JSON.stringify({ text: "orphan" }),
        })
      ).status,
    ).toBe(404);
  });

  /**
   * A malformed payload is the caller's fault and a broken service is ours.
   * Collapsing both into 500 (or both into 400) sends whoever is debugging to
   * the wrong side of the wire, so the distinction is pinned here.
   */
  it("reports a bad payload as 400, not 500", async () => {
    expect(
      (await api("/api/lists", { method: "POST", body: JSON.stringify({ title: 42 }) }))
        .status,
    ).toBe(400);

    expect(
      (await api("/api/lists", { method: "POST", body: JSON.stringify({ title: "  " }) }))
        .status,
    ).toBe(400);

    expect((await api("/api/lists", { method: "POST", body: "{not json" })).status).toBe(400);
  });

  it("rejects an unknown method with 405, not 404", async () => {
    expect((await api("/api/lists", { method: "PUT" })).status).toBe(405);
  });
});

describe("static assets", () => {
  it("serves the page and refuses a traversal", async () => {
    const page = await fetch(`${base}/`);
    expect(page.status).toBe(200);
    expect(page.headers.get("content-type")).toContain("text/html");

    // Not in the allowlist, so it is a 404 rather than a file read.
    const escaped = await fetch(`${base}/../package.json`, { redirect: "manual" });
    expect(escaped.status).toBe(404);
  });
});
