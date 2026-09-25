import { defineTool } from "@barry-rocks/sdk/bags";
import { z } from "zod";
import { api } from "./client.js";
import type { Item, List, ListWithItems } from "./store.js";

/**
 * Tools go through the same HTTP service the web page and the iOS app use —
 * one write path, so the three surfaces cannot disagree about what a save
 * means. The store layer stays importable for tests and the server.
 */

function listLine(l: List): string {
  const n = l.item_count ?? 0;
  return `${l.id}  ${String(n).padStart(3)} item${n === 1 ? "" : "s"}  ${l.title}`;
}

function itemLine(i: Item): string {
  return `${i.done ? "[x]" : "[ ]"} ${i.id}  ${i.text}`;
}

export const listsCreate = defineTool({
  namespace: "lists",
  access: "write",
  name: "create_list",
  description:
    "Create a new, empty list with a title. Returns the list, including its id — " +
    "pass that id to add_item.",
  schema: {
    title: z.string().min(1).describe("List title — a short noun phrase, e.g. 'Groceries'"),
  },
  handler: async ({ title }) => {
    const { list } = await api<{ list: List }>("/api/lists", {
      method: "POST",
      body: JSON.stringify({ title }),
    });
    return list;
  },
  cliFormat: (result) => listLine(result as List),
});

export const listsList = defineTool({
  namespace: "lists",
  access: "read",
  name: "lists",
  description:
    "Every list, most recently touched first, with a count of the items in each. " +
    "Use get_list to see the items themselves.",
  schema: {},
  handler: async () => {
    const { lists } = await api<{ lists: List[] }>("/api/lists");
    return lists;
  },
  cliFormat: (result) => {
    const rows = result as List[];
    return rows.length ? rows.map(listLine).join("\n") : "No lists yet.";
  },
});

export const listsGet = defineTool({
  namespace: "lists",
  access: "read",
  name: "get_list",
  description: "One list and all of its items, in order.",
  schema: {
    id: z.string().min(1).describe("The list's id, from `lists` or `create_list`"),
  },
  handler: async ({ id }) => {
    const { list } = await api<{ list: ListWithItems }>(
      `/api/lists/${encodeURIComponent(id)}`,
    );
    return list;
  },
  cliFormat: (result) => {
    const list = result as ListWithItems;
    const header = `${list.title}  (${list.items.length} items)`;
    return list.items.length
      ? `${header}\n${list.items.map(itemLine).join("\n")}`
      : `${header}\nNo items yet.`;
  },
});

export const listsRename = defineTool({
  namespace: "lists",
  access: "write",
  name: "rename_list",
  description: "Change a list's title. The items are untouched.",
  schema: {
    id: z.string().min(1).describe("The list's id"),
    title: z.string().min(1).describe("The new title"),
  },
  handler: async ({ id, title }) => {
    const { list } = await api<{ list: List }>(`/api/lists/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ title }),
    });
    return list;
  },
  cliFormat: (result) => listLine(result as List),
});

export const listsDelete = defineTool({
  namespace: "lists",
  access: "write",
  name: "delete_list",
  description:
    "Delete a list AND every item in it. This cannot be undone — there is no archive.",
  schema: {
    id: z.string().min(1).describe("The list's id"),
  },
  handler: async ({ id }) => {
    await api<{ ok: true }>(`/api/lists/${encodeURIComponent(id)}`, { method: "DELETE" });
    return { deleted: id };
  },
  cliFormat: (result) => `Deleted ${(result as { deleted: string }).deleted}`,
});

export const listsAddItem = defineTool({
  namespace: "lists",
  access: "write",
  name: "add_item",
  description: "Add one item to the end of a list.",
  schema: {
    list_id: z.string().min(1).describe("The list to add to"),
    text: z.string().min(1).describe("The item text"),
  },
  handler: async ({ list_id, text }) => {
    const { item } = await api<{ item: Item }>(
      `/api/lists/${encodeURIComponent(list_id)}/items`,
      { method: "POST", body: JSON.stringify({ text }) },
    );
    return item;
  },
  cliFormat: (result) => itemLine(result as Item),
});

export const listsCheckItem = defineTool({
  namespace: "lists",
  access: "write",
  name: "check_item",
  description: "Mark an item done, or undo that with done: false.",
  schema: {
    id: z.string().min(1).describe("The item's id, from get_list"),
    done: z.boolean().describe("true to check it off, false to uncheck"),
  },
  handler: async ({ id, done }) => {
    const { item } = await api<{ item: Item }>(`/api/items/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ done }),
    });
    return item;
  },
  cliFormat: (result) => itemLine(result as Item),
});

export const listsDeleteItem = defineTool({
  namespace: "lists",
  access: "write",
  name: "delete_item",
  description: "Remove one item from its list. The list itself stays.",
  schema: {
    id: z.string().min(1).describe("The item's id, from get_list"),
  },
  handler: async ({ id }) => {
    await api<{ ok: true }>(`/api/items/${encodeURIComponent(id)}`, { method: "DELETE" });
    return { deleted: id };
  },
  cliFormat: (result) => `Deleted ${(result as { deleted: string }).deleted}`,
});
