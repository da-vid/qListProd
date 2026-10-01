import "./style.css";
import {
  type Change,
  type Item,
  type ListState,
  type Store,
  newID,
  route,
  movePriority,
} from "./model.ts";
import { LocalStore } from "./local-store.ts";
const app = document.querySelector<HTMLDivElement>("#app")!;
const mode = import.meta.env.MODE;
let store: Store,
  state: ListState = { title: "", items: [] },
  online = true,
  pending = 0,
  failed: Change[] = [];
const local = mode !== "emulator";
function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls = "",
  text = "",
) {
  const e = document.createElement(tag);
  e.className = cls;
  e.textContent = text;
  return e;
}
function button(text: string, cls: string, action: () => void) {
  const b = element("button", cls, text);
  b.type = "button";
  b.addEventListener("click", action);
  return b;
}
function showError(message: string) {
  errorText.textContent = message;
  errorBox.hidden = false;
  retry.hidden = failed.length === 0;
}
const notice = element(
  "div",
  "preview",
  local
    ? "Development preview · Lists stay in this browser. Links do not sync across devices."
    : "Local Firebase emulator · Synthetic data only.",
);
const shell = element("div", "shell");
const header = element("header");
const brand = element("div", "brand", "qList");
brand.append(element("small", "", "quick, easy lists"));
const nav = element("nav", "nav");
nav.setAttribute("aria-label", "List actions");
header.append(brand, nav);
const main = element("main");
const eyebrow = element("p", "eyebrow", "A little less to remember");
const title = element("input", "title");
title.placeholder = "Untitled list";
title.maxLength = 160;
title.setAttribute("aria-label", "List title");
const meta = element("div", "meta"),
  count = element("span"),
  status = element("span", "status");
status.setAttribute("role", "status");
meta.append(count, status);
const errorBox = element("div", "error");
errorBox.hidden = true;
errorBox.setAttribute("role", "alert");
const errorText = element("span");
const retry = button("Retry", "btn", () => {
  const changes = failed;
  failed = [];
  errorBox.hidden = true;
  for (const change of changes) void save(change);
});
const discard = button("Dismiss unsaved changes", "text-button", () => {
  failed = [];
  errorBox.hidden = true;
  updateStatus();
});
errorBox.append(errorText, retry, discard);
const addForm = element("form", "add");
const addInput = element("input");
addInput.placeholder = "What needs doing?";
addInput.maxLength = 1000;
addInput.setAttribute("aria-label", "New item");
const add = element("button", "btn primary", "Add");
add.type = "submit";
addForm.append(addInput, add);
const list = element("ul", "list");
list.setAttribute("aria-label", "List items");
const empty = element("div", "empty");
empty.append(
  element("strong", "", "A fresh start."),
  element("span", "", "Add your first item above."),
);
const bottom = element("div", "bottom");
const progress = element("span");
const clear = button("Clear completed", "text-button", () =>
  openDialog(
    "Clear completed items?",
    `${state.items.filter((x) => x.checked).length} completed items will be removed.`,
    () => {
      for (const item of state.items.filter((x) => x.checked))
        void save({ type: "delete", key: item.key });
    },
    "Clear completed",
  ),
);
bottom.append(progress, clear);
const note = element(
  "p",
  "note",
  local
    ? "Your preview lists are saved on this device, in this browser. Open the same link in another tab to try updates together. Clearing browser data removes these sample lists."
    : "Anyone with a list link can edit it. Keep this tab open until changes are saved. Offline changes are held in this session only; do not close or reload while changes are pending.",
);
main.append(eyebrow, title, meta, errorBox, addForm, list, empty, bottom, note);
shell.append(header, main);
app.append(notice, shell);
const dialog = element("dialog");
app.append(dialog);
function openDialog(
  heading: string,
  message: string,
  action: () => void,
  confirm = "Continue",
) {
  dialog.replaceChildren(element("h2", "", heading), element("p", "", message));
  const actions = element("div", "nav");
  actions.append(
    button("Cancel", "btn", () => dialog.close()),
    button(confirm, "btn primary", () => {
      dialog.close();
      action();
    }),
  );
  dialog.append(actions);
  dialog.showModal();
}
nav.append(
  button("New list", "btn", () =>
    openDialog(
      "Start a fresh list?",
      "This list will remain available at its current address. Save or copy the link to return.",
      () => location.assign("/new"),
      "Create list",
    ),
  ),
  button("Share", "btn primary", () => {
    dialog.replaceChildren(
      element("h2", "", "A list worth sharing."),
      element(
        "p",
        "",
        local
          ? "This preview link opens a browser-local list. It will not share your items with someone on another device."
          : "Anyone with this link can view and edit the list.",
      ),
    );
    const input = element("input");
    input.readOnly = true;
    input.value = location.origin + location.pathname;
    input.setAttribute("aria-label", "List link");
    const actions = element("div", "nav");
    actions.append(
      button("Close", "btn", () => dialog.close()),
      button("Copy link", "btn primary", () => {
        void navigator.clipboard.writeText(input.value).then(
          () => {
            status.textContent = "Link copied";
          },
          () => {
            input.select();
            showError(
              "Copy is unavailable. Select and copy the link manually.",
            );
          },
        );
      }),
    );
    dialog.append(input, actions);
    dialog.showModal();
    input.select();
  }),
);
function updateStatus() {
  status.className = "status" + (!online ? " offline" : "");
  status.textContent = failed.length
    ? "Changes need attention"
    : pending
      ? online
        ? "Saving…"
        : "Offline · changes waiting"
      : local
        ? "Saved on this device"
        : online
          ? "All changes saved"
          : "Offline · keep this tab open";
}
async function save(change: Change) {
  pending++;
  updateStatus();
  try {
    await store.apply(change);
  } catch (e) {
    failed.push(change);
    showError((e as Error).message || "Could not save. Please retry.");
  } finally {
    pending--;
    updateStatus();
  }
}
function render(next: ListState) {
  state = next;
  document.title = (state.title || "qList") + " · quick lists";
  if (document.activeElement !== title) title.value = state.title;
  count.textContent = `${state.items.length} item${state.items.length === 1 ? "" : "s"}`;
  const done = state.items.filter((x) => x.checked).length;
  progress.textContent = state.items.length
    ? `${done} of ${state.items.length} complete`
    : "Small steps, clearer days.";
  clear.hidden = done === 0;
  empty.hidden = state.items.length > 0;
  const existing = new Map(
    [...list.children].map((x) => [
      (x as HTMLElement).dataset.key!,
      x as HTMLLIElement,
    ]),
  );
  state.items.forEach((item, i) => {
    let row = existing.get(item.key);
    if (!row) {
      row = element("li", "item");
      row.dataset.key = item.key;
      const check = element("input");
      check.type = "checkbox";
      check.addEventListener(
        "change",
        () =>
          void save({ type: "check", key: item.key, checked: check.checked }),
      );
      const name = element("input", "name");
      name.maxLength = 1000;
      name.addEventListener(
        "change",
        () =>
          void save({ type: "edit", key: item.key, name: name.value.trim() }),
      );
      name.addEventListener("keydown", (e) => {
        if (e.key === "Enter") name.blur();
        if (e.key === "Escape") {
          name.value = state.items.find((x) => x.key === item.key)?.name || "";
          name.blur();
        }
      });
      const actions = element("div", "actions");
      for (const [symbol, dir] of [
        ["↑", -1],
        ["↓", 1],
      ] as const) {
        const b = button(symbol, "icon", () => {
          try {
            void save({
              type: "move",
              key: item.key,
              priority: movePriority(state.items, item.key, dir),
            });
          } catch (e) {
            showError((e as Error).message);
          }
        });
        b.dataset.direction = String(dir);
        actions.append(b);
      }
      actions.append(
        button("×", "icon", () => void save({ type: "delete", key: item.key })),
      );
      row.append(check, name, actions);
    }
    row.className = "item" + (item.checked ? " done" : "");
    const inputs = row.querySelectorAll("input");
    inputs[0].checked = item.checked;
    inputs[0].setAttribute("aria-label", `Complete ${item.name}`);
    if (document.activeElement !== inputs[1]) inputs[1].value = item.name;
    inputs[1].setAttribute("aria-label", `Edit ${item.name}`);
    const buttons = row.querySelectorAll("button");
    buttons[0].disabled = i === 0;
    buttons[1].disabled = i === state.items.length - 1;
    buttons[0].setAttribute("aria-label", `Move ${item.name} up`);
    buttons[1].setAttribute("aria-label", `Move ${item.name} down`);
    buttons[2].setAttribute("aria-label", `Delete ${item.name}`);
    const at = list.children[i];
    if (at !== row) list.insertBefore(row, at || null);
    existing.delete(item.key);
  });
  for (const row of existing.values()) row.remove();
  updateStatus();
}
title.addEventListener(
  "change",
  () => void save({ type: "title", title: title.value.trim() }),
);
addForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const name = addInput.value.trim();
  if (!name) return;
  const key = crypto.randomUUID().replaceAll("-", "");
  const item: Item = {
    key,
    ID: key,
    name,
    checked: false,
    priority: Math.max(0, ...state.items.map((x) => x.priority)) + 1024,
  };
  addInput.value = "";
  void save({ type: "add", item });
  addInput.focus();
});
window.addEventListener("beforeunload", (e) => {
  if (pending || failed.length) {
    e.preventDefault();
    e.returnValue = "";
  }
});
async function start() {
  if (
    ["qlist.cc", "www.qlist.cc", "qlist.netlify.app"].includes(
      location.hostname,
    )
  )
    throw new Error(
      "This development build cannot run on the production site.",
    );
  const id = route(location.pathname, document.cookie);
  if (location.pathname !== `/${id}`) history.replaceState(null, "", `/${id}`);
  document.cookie = `lastList=${id}; Max-Age=5184000; Path=/; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
  if (local) {
    store = new LocalStore(id);
  } else {
    if (!["localhost", "127.0.0.1"].includes(location.hostname))
      throw new Error("Emulator mode is only available on this computer.");
    const { FirebaseStore, emulatorDatabase } =
      await import("./firebase-store.ts");
    store = new FirebaseStore(emulatorDatabase(crypto.randomUUID()), id);
  }
  store.subscribe(
    render,
    (b) => {
      online = b;
      updateStatus();
    },
    (e) => showError(e.message),
  );
  if (local && id === "Demo23" && state.items.length === 0 && !state.title) {
    await store.apply({ type: "title", title: "A good kind of day" });
    for (const [i, name] of [
      "Pick up something fresh",
      "Make time for a walk",
      "Send that thank-you note",
    ].entries())
      await store.apply({
        type: "add",
        item: {
          key: `sample${i}`,
          ID: `sample${i}`,
          name,
          checked: i === 1,
          priority: i * 1024,
        },
      });
  }
}
void start().catch((e) => {
  showError(e.message);
  add.disabled = true;
  title.disabled = true;
});
