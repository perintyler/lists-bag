/**
 * The lists service.
 *
 * Plain node:http with no framework and no build step — the plans/metrics
 * shape. Every surface that reads or writes a list goes through here: the web
 * page, the iOS app, and the MCP tools. One write path, so the three cannot
 * disagree about what a save means. The store layer stays importable for
 * tests.
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  addItem,
  createList,
  deleteItem,
  deleteList,
  getList,
  listLists,
  renameList,
  setItemDone,
} from "../../src/store.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const WEB = join(HERE, "..", "..", "web");

const PORT = Number(process.env.PORT || 4885);
const SECRET = process.env.BARRY_SECRET ?? "";

/**
 * Files servable from web/, by explicit allowlist rather than a path join —
 * `join(WEB, url.pathname)` is a directory traversal, and "binds loopback
 * today" is not a security boundary (this origin is published through the
 * tunnel).
 */
const STATIC_ASSETS: Record<string, { file: string; type: string }> = {
  "/": { file: "index.html", type: "text/html; charset=utf-8" },
  "/app.css": { file: "app.css", type: "text/css; charset=utf-8" },
  "/app.js": { file: "app.js", type: "text/javascript; charset=utf-8" },
};

function json(res: ServerResponse, body: unknown, status = 200): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
  });
  res.end(payload);
}

/**
 * Bearer secret, accepting the `x-barry-secret` spelling too — the same pair
 * every other bag service takes, so a client written against one works here.
 *
 * An unset secret leaves the service open, which is correct ONLY on loopback.
 * The tunnel puts this origin on the internet, where Cloudflare Access is the
 * gate; see bag.yaml.
 */
function authorized(req: IncomingMessage): boolean {
  if (!SECRET) return true;
  const header = req.headers.authorization;
  const alt = req.headers["x-barry-secret"];
  return header === `Bearer ${SECRET}` || alt === SECRET;
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    // Cap it: an unbounded reader is a memory exhaustion away from taking the
    // service down, and no list item is a megabyte.
    if (size > 1_000_000) throw new Error("body too large");
    chunks.push(chunk as Buffer);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function str(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`${field} must be a string`);
  return value;
}

export const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "127.0.0.1"}`);
  const path = url.pathname;
  const method = req.method ?? "GET";

  try {
    // Unauthenticated on purpose: a probe that needs a secret cannot tell
    // "server down" from "wrong secret".
    if (path === "/health") {
      return json(res, { ok: true, service: "lists" });
    }

    const asset = STATIC_ASSETS[path];
    if (asset && method === "GET") {
      const body = readFileSync(join(WEB, asset.file));
      res.writeHead(200, { "content-type": asset.type, "cache-control": "no-store" });
      return res.end(body);
    }

    if (path.startsWith("/api/")) {
      if (!authorized(req)) return json(res, { error: "unauthorized" }, 401);

      // /api/lists
      if (path === "/api/lists") {
        if (method === "GET") return json(res, { lists: listLists() });
        if (method === "POST") {
          const body = (await readBody(req)) as { title?: unknown };
          return json(res, { list: createList(str(body.title, "title")) }, 201);
        }
        return json(res, { error: "method not allowed" }, 405);
      }

      // /api/lists/:id  and  /api/lists/:id/items
      const listMatch = /^\/api\/lists\/([^/]+)$/.exec(path);
      if (listMatch) {
        const id = decodeURIComponent(listMatch[1]!);
        if (method === "GET") {
          const list = getList(id);
          return list ? json(res, { list }) : json(res, { error: "not found" }, 404);
        }
        if (method === "PATCH") {
          const body = (await readBody(req)) as { title?: unknown };
          const list = renameList(id, str(body.title, "title"));
          return list ? json(res, { list }) : json(res, { error: "not found" }, 404);
        }
        if (method === "DELETE") {
          return deleteList(id)
            ? json(res, { ok: true })
            : json(res, { error: "not found" }, 404);
        }
        return json(res, { error: "method not allowed" }, 405);
      }

      const itemsMatch = /^\/api\/lists\/([^/]+)\/items$/.exec(path);
      if (itemsMatch && method === "POST") {
        const id = decodeURIComponent(itemsMatch[1]!);
        const body = (await readBody(req)) as { text?: unknown };
        const item = addItem(id, str(body.text, "text"));
        return item ? json(res, { item }, 201) : json(res, { error: "not found" }, 404);
      }

      // /api/items/:id
      const itemMatch = /^\/api\/items\/([^/]+)$/.exec(path);
      if (itemMatch) {
        const id = decodeURIComponent(itemMatch[1]!);
        if (method === "PATCH") {
          const body = (await readBody(req)) as { done?: unknown };
          if (typeof body.done !== "boolean") {
            return json(res, { error: "done must be a boolean" }, 400);
          }
          const item = setItemDone(id, body.done);
          return item ? json(res, { item }) : json(res, { error: "not found" }, 404);
        }
        if (method === "DELETE") {
          return deleteItem(id)
            ? json(res, { ok: true })
            : json(res, { error: "not found" }, 404);
        }
        return json(res, { error: "method not allowed" }, 405);
      }
    }

    return json(res, { error: "not found" }, 404);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // A bad payload is the caller's fault (400); anything else is ours (500).
    // Collapsing both into one status would send a debugger hunting the wrong
    // side of the wire.
    const clientFault =
      message.includes("must be a") ||
      message.includes("cannot be empty") ||
      message.includes("body too large") ||
      err instanceof SyntaxError;
    return json(res, { error: message }, clientFault ? 400 : 500);
  }
});

// Only listen when run directly — importing this module in a test must not
// bind a port.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  server.listen(PORT, "127.0.0.1", () => {
    console.log(`lists service on 127.0.0.1:${PORT}`);
  });
}
