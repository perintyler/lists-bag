/**
 * The lists web page.
 *
 * Same-origin calls to /api/* — no worker URL, no secret in the page. On
 * loopback the service takes no auth; through the tunnel Cloudflare Access is
 * the gate, so there is never a credential for this page to hold.
 *
 * User text is written with textContent, never innerHTML: a list titled
 * `<img onerror=...>` is a perfectly ordinary thing to type, and it must not
 * become markup.
 */

const listsEl = document.getElementById("lists");
const listsEmptyEl = document.getElementById("lists-empty");
const detailEl = document.getElementById("detail");
const statusEl = document.getElementById("status");
const newListForm = document.getElementById("new-list");
const newListTitle = document.getElementById("new-list-title");

let lists = [];
let selectedId = null;

function setStatus(message, tone) {
  statusEl.textContent = message;
  if (tone) statusEl.dataset.tone = tone;
  else delete statusEl.dataset.tone;
}

async function api(path, options) {
  const res = await fetch(path, {
    ...options,
    headers: { "content-type": "application/json", ...(options && options.headers) },
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error((body && body.error) || `request failed (${res.status})`);
  }
  return body;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderLists() {
  listsEl.replaceChildren();
  listsEmptyEl.hidden = lists.length > 0;

  for (const list of lists) {
    const button = el("button", null);
    button.type = "button";
    button.setAttribute("aria-current", String(list.id === selectedId));
    button.append(el("span", null, list.title), el("span", "count", String(list.item_count ?? 0)));
    button.addEventListener("click", () => selectList(list.id));

    const li = document.createElement("li");
    li.append(button);
    listsEl.append(li);
  }
}

function renderDetail(list) {
  detailEl.replaceChildren();

  if (!list) {
    detailEl.append(el("p", "empty", "Select a list."));
    return;
  }

  const head = el("div", "detail-head");
  head.append(el("h2", null, list.title));

  const del = el("button", "link-danger", "Delete list");
  del.type = "button";
  del.addEventListener("click", () => removeList(list.id, list.title));
  head.append(del);
  detailEl.append(head);

  if (list.items.length === 0) {
    detailEl.append(el("p", "empty", "No items yet."));
  } else {
    const ul = el("ul", "items");
    for (const item of list.items) {
      const li = el("li", item.done ? "item done" : "item");

      const box = document.createElement("input");
      box.type = "checkbox";
      box.checked = item.done;
      box.setAttribute("aria-label", item.text);
      box.addEventListener("change", () => toggleItem(item.id, box.checked));

      const remove = el("button", "link-danger", "×");
      remove.type = "button";
      remove.setAttribute("aria-label", `Delete ${item.text}`);
      remove.addEventListener("click", () => removeItem(item.id));

      li.append(box, el("span", "item-text", item.text), remove);
      ul.append(li);
    }
    detailEl.append(ul);
  }

  const form = el("form", "add-item");
  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "Add an item…";
  input.autocomplete = "off";
  input.setAttribute("aria-label", "New item");
  const submit = el("button", null, "Add");
  submit.type = "submit";
  form.append(input, submit);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    await addItem(list.id, text);
    // Re-focus so a run of items can be typed without reaching for the mouse.
    const next = detailEl.querySelector(".add-item input");
    if (next) next.focus();
  });
  detailEl.append(form);
}

async function refreshLists() {
  const { lists: fetched } = await api("/api/lists");
  lists = fetched;
  renderLists();
}

async function selectList(id) {
  selectedId = id;
  renderLists();
  try {
    const { list } = await api(`/api/lists/${encodeURIComponent(id)}`);
    renderDetail(list);
    setStatus("");
  } catch (err) {
    setStatus(err.message, "error");
  }
}

async function guard(action, done) {
  try {
    await action();
    setStatus(done || "");
  } catch (err) {
    setStatus(err.message, "error");
  }
}

newListForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const title = newListTitle.value.trim();
  if (!title) return;
  newListTitle.value = "";
  guard(async () => {
    const { list } = await api("/api/lists", {
      method: "POST",
      body: JSON.stringify({ title }),
    });
    await refreshLists();
    await selectList(list.id);
  });
});

function addItem(listId, text) {
  return guard(async () => {
    await api(`/api/lists/${encodeURIComponent(listId)}/items`, {
      method: "POST",
      body: JSON.stringify({ text }),
    });
    await refreshLists();
    await selectList(listId);
  });
}

function toggleItem(id, done) {
  return guard(async () => {
    await api(`/api/items/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: JSON.stringify({ done }),
    });
    await refreshLists();
    await selectList(selectedId);
  });
}

function removeItem(id) {
  return guard(async () => {
    await api(`/api/items/${encodeURIComponent(id)}`, { method: "DELETE" });
    await refreshLists();
    await selectList(selectedId);
  });
}

function removeList(id, title) {
  if (!window.confirm(`Delete "${title}" and everything in it?`)) return;
  return guard(async () => {
    await api(`/api/lists/${encodeURIComponent(id)}`, { method: "DELETE" });
    selectedId = null;
    await refreshLists();
    renderDetail(null);
  });
}

guard(refreshLists);
