import "./style.css";
import { installAboutPrivacy } from "./about.ts";
import Sortable from "sortablejs";
import { installScrollFades } from "./scroll-fades.ts";
import { installListViewport } from "./list-viewport.ts";
import {
  SavedMetadataWarning,
  type Change,
  type Item,
  type ListState,
  type Store,
  routeRequest,
  reserveGeneratedID,
  movePriority,
  moveBeforePriority,
  appendPriority,
} from "./model.ts";
import { LocalStore, reserveLocalList } from "./local-store.ts";
const app = document.querySelector<HTMLDivElement>("#app")!;
const mode = import.meta.env.MODE;
let store: Store,
  state: ListState = { title: "", items: [] },
  online = true,
  ready = false,
  pending = 0,
  dragging = false,
  failed: Change[] = [];
const local = mode === "preview";
const production = mode === "release";
let writesAllowed = !production;
const drafts = new Set<HTMLInputElement>();
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
    : mode === "staging"
      ? "Staging preview · Shared test lists only. Your existing qList lists are unchanged."
      : "Local Firebase emulator · Synthetic data only.",
);
const shell = element("div", "shell");
const header = element("header");
const sticky = element("div", "sticky-top");
const controls = element("div", "list-controls");
const brand = element("div", "brand", "qList");
brand.append(
  element("span", "cc", ".cc"),
  element("small", "", "quick, easy lists."),
);
const nav = element("nav", "nav");
nav.setAttribute("aria-label", "List actions");
const headerInner = element("div", "header-inner");
headerInner.append(brand, nav);
header.append(headerInner);
const main = element("main");
const title = element("input", "title");
title.placeholder = "my qList";
title.maxLength = 160;
title.disabled = true;
title.setAttribute("aria-label", "List title");
const meta = element("div", "meta"),
  count = element("span"),
  status = element("span", "status");
status.setAttribute("role", "status");
status.textContent = local ? "Loading…" : "Connecting…";
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
  drafts.clear();
  errorBox.hidden = true;
  render(state, true);
});
errorBox.append(errorText, retry, discard);
const addForm = element("form", "add");
const addInput = element("input");
addInput.placeholder = "enter your first item here";
addInput.maxLength = 1000;
addInput.setAttribute("aria-label", "New item");
const add = element("button", "btn primary", "add");
add.type = "submit";
add.disabled = true;
addForm.append(addInput, add);
const list = element("ul", "list");
list.setAttribute("aria-label", "List items");
const reorderHelp = element(
  "span",
  "sr-only",
  "Drag the handle to reorder, or focus it and use the Up and Down arrow keys. Home moves to the top; End moves to the bottom.",
);
reorderHelp.id = "reorder-help";
const reorderStatus = element("span", "sr-only");
reorderStatus.setAttribute("role", "status");
const viewport = installListViewport(sticky, list);
installScrollFades(sticky, list);
new Sortable(list, {
  scroll: false,
  handle: ".drag-handle",
  draggable: ".item",
  animation: matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 120,
  forceFallback: true,
  fallbackOnBody: true,
  fallbackTolerance: 5,
  direction: "vertical",
  onChoose() {
    dragging = true;
    viewport.start();
    if (document.activeElement instanceof HTMLInputElement)
      document.activeElement.blur();
  },
  onUnchoose() {
    // Sortable fires end synchronously after unchoose; a tap without a drag still releases rendering.
    queueMicrotask(() => {
      dragging = false;
      viewport.stop();
      render(state);
    });
  },
  onEnd(event) {
    const key = event.item.dataset.key!;
    const anchor =
      (event.item.nextElementSibling as HTMLElement | null)?.dataset.key ??
      null;
    dragging = false;
    viewport.stop();
    try {
      if (viewport.canDrop() && event.oldIndex !== event.newIndex)
        void save({
          type: "move",
          key,
          priority: moveBeforePriority(state.items, key, anchor),
        });
    } catch (e) {
      showError((e as Error).message);
    }
    render(state);
  },
});
const empty = element("div", "empty");
empty.append(
  element("strong", "", "welcome to your qList!"),
  element(
    "p",
    "",
    "qList is great for shopping lists, to-do lists, or any other quick list you need",
  ),
  element("strong", "", "easy to share"),
  element(
    "p",
    "",
    local
      ? "open this preview link in another tab to try updates together; different devices do not share preview lists"
      : "send this page’s URL to share and collaborate",
  ),
  element("strong", "", "use it anywhere"),
  element("p", "", "works on your computer, phone, and tablet’s web browser"),
  element("strong", "", "just get started"),
  element("p", "", "no sign up, no spam. start your list right here!"),
);
const bottom = element("footer", "bottom");
const progress = element("span");
const clear = button("Clear all checked", "text-button", () => {
  const checkedCount = state.items.filter((x) => x.checked).length;
  openDialog(
    "Clear all checked items?",
    `${checkedCount} checked item${checkedCount === 1 ? "" : "s"} will be removed.`,
    () => {
      for (const item of state.items.filter((x) => x.checked))
        void save({ type: "delete", key: item.key });
    },
    "Clear all checked",
  );
});
const clearSlot = element("div", "clear-slot");
const clearInner = element("div", "clear-inner");
clearInner.append(clear);
clearSlot.append(clearInner);
clearSlot.inert = true;
clearSlot.setAttribute("aria-hidden", "true");
clear.disabled = true;
controls.append(title, addForm, clearSlot);
sticky.append(header, controls);
bottom.append(progress);
main.append(errorBox, reorderHelp, reorderStatus, list, empty, meta, bottom);
if (local)
  main.append(
    element(
      "p",
      "note",
      "Your preview lists are saved on this device, in this browser. Open the same link in another tab to try updates together. Clearing browser data removes these sample lists.",
    ),
  );
shell.append(main);
if (!production) app.append(notice);
app.append(sticky, shell);
const dialog = element("dialog");
app.append(dialog);
installAboutPrivacy(app, bottom);
function labelDialog() {
  const heading = dialog.querySelector("h2")!;
  const description = dialog.querySelector("p")!;
  heading.id = "dialog-title";
  description.id = "dialog-description";
  dialog.setAttribute("aria-labelledby", heading.id);
  dialog.setAttribute("aria-describedby", description.id);
}
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
  labelDialog();
  dialog.showModal();
}
nav.append(
  button("new list", "btn", () =>
    openDialog(
      "Create a new list?",
      "This list will remain available at its current address. Save or copy the link to return.",
      () => location.assign("/new"),
      "Create list",
    ),
  ),
  button("share your list", "btn primary", () => {
    dialog.replaceChildren(
      element("h2", "", "share your list"),
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
    const copyFeedback = element("p", "copy-feedback");
    copyFeedback.setAttribute("role", "status");
    copyFeedback.setAttribute("aria-live", "polite");
    const actions = element("div", "nav");
    actions.append(
      button("Close", "btn", () => dialog.close()),
      button("Copy link", "btn primary", () => {
        void navigator.clipboard.writeText(input.value).then(
          () => {
            copyFeedback.textContent = "Link copied";
          },
          () => {
            input.select();
            copyFeedback.textContent =
              "Copy is unavailable. Select and copy the link manually.";
          },
        );
      }),
    );
    dialog.append(input, copyFeedback, actions);
    labelDialog();
    dialog.showModal();
    input.select();
  }),
);
function updateStatus() {
  status.className = "status" + (!online ? " offline" : "");
  status.textContent =
    production && !writesAllowed
      ? "Maintenance · editing paused"
      : !ready
        ? "Connecting…"
        : failed.length
          ? "Changes need attention"
          : drafts.size
            ? "Editing…"
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
  if (!writesAllowed) {
    failed.push(change);
    showError(
      "Editing is paused for maintenance. Keep this tab open and copy any unsaved text before refreshing.",
    );
    updateStatus();
    return;
  }
  pending++;
  updateStatus();
  try {
    await store.apply(change);
  } catch (e) {
    if (!(e instanceof SavedMetadataWarning)) failed.push(change);
    showError((e as Error).message || "Could not save. Please retry.");
  } finally {
    pending--;
    updateStatus();
  }
}
// Clipboard/autofill changes do not reliably produce `change` in every browser.
// Input marks unsaved work; blur is a final persistence boundary, including paste.
function bindEditable(
  input: HTMLInputElement,
  current: () => string,
  change: (value: string) => Change,
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let submitted: string | undefined;
  let composing = false;
  function flush() {
    clearTimeout(timer);
    drafts.delete(input);
    const value = input.value.trim();
    if (value === current() || value === submitted) {
      updateStatus();
      return;
    }
    submitted = value;
    void save(change(value)).finally(() => {
      submitted = undefined;
    });
  }
  function schedule() {
    clearTimeout(timer);
    drafts.add(input);
    updateStatus();
    if (!composing) timer = setTimeout(flush, 300);
  }
  input.addEventListener("input", schedule);
  input.addEventListener("change", flush);
  input.addEventListener("blur", flush);
  input.addEventListener("compositionstart", () => {
    composing = true;
    clearTimeout(timer);
  });
  input.addEventListener("compositionend", () => {
    composing = false;
    schedule();
  });
}
function render(next: ListState, discardEdits = false) {
  state = next;
  title.disabled = !ready || !writesAllowed;
  add.disabled = !ready || !writesAllowed;
  // Retain fresh server state, but let Sortable own row positions until release.
  if (dragging) return;
  document.title = (state.title || "qList") + " · quick lists";
  if (discardEdits || document.activeElement !== title)
    title.value = state.title;
  count.textContent = `${state.items.length} item${state.items.length === 1 ? "" : "s"}`;
  const done = state.items.filter((x) => x.checked).length;
  progress.textContent = state.items.length
    ? `${done} of ${state.items.length} complete`
    : "";
  addInput.placeholder = state.items.length
    ? "enter your next item"
    : "enter your first item here";
  const canClear = done > 0;
  if (!canClear && document.activeElement === clear)
    addInput.focus({ preventScroll: true });
  clearSlot.classList.toggle("available", canClear);
  clearSlot.inert = !canClear;
  clearSlot.setAttribute("aria-hidden", String(!canClear));
  clear.disabled = !canClear || !writesAllowed;
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
      bindEditable(
        name,
        () => state.items.find((x) => x.key === item.key)?.name || "",
        (value) => ({ type: "edit", key: item.key, name: value }),
      );
      name.addEventListener("keydown", (e) => {
        if (e.key === "Enter") name.blur();
        if (e.key === "Escape") {
          name.value = state.items.find((x) => x.key === item.key)?.name || "";
          name.blur();
        }
      });
      const actions = element("div", "actions");
      const remove = button(
        "×",
        "icon delete-item",
        () => void save({ type: "delete", key: item.key }),
      );
      const handle = button("≡", "icon drag-handle", () => {});
      handle.setAttribute("aria-describedby", "reorder-help");
      handle.title = "Drag to reorder; use arrow keys when focused";
      handle.addEventListener("keydown", (e) => {
        if (!["ArrowUp", "ArrowDown", "Home", "End"].includes(e.key)) return;
        e.preventDefault();
        try {
          const priority =
            e.key === "Home"
              ? moveBeforePriority(
                  state.items,
                  item.key,
                  state.items.find((x) => x.key !== item.key)?.key ?? null,
                )
              : e.key === "End"
                ? moveBeforePriority(state.items, item.key, null)
                : movePriority(
                    state.items,
                    item.key,
                    e.key === "ArrowUp" ? -1 : 1,
                  );
          void save({ type: "move", key: item.key, priority }).then(() => {
            handle.focus({ preventScroll: true });
            viewport.reveal(handle);
            const position = state.items.findIndex((x) => x.key === item.key);
            reorderStatus.textContent = `${state.items[position]?.name ?? "Item"}, position ${position + 1} of ${state.items.length}`;
          });
        } catch (e) {
          reorderStatus.textContent = (e as Error).message;
        }
      });
      actions.append(remove, handle);
      row.append(check, name, actions);
    }
    row.className = "item" + (item.checked ? " done" : "");
    const inputs = row.querySelectorAll("input");
    inputs[0].disabled = !writesAllowed;
    inputs[1].disabled = !writesAllowed;
    inputs[0].checked = item.checked;
    inputs[0].setAttribute("aria-label", `Complete ${item.name}`);
    if (discardEdits || document.activeElement !== inputs[1])
      inputs[1].value = item.name;
    inputs[1].setAttribute("aria-label", `Edit ${item.name}`);
    const buttons = row.querySelectorAll("button");
    buttons[0].disabled = !item.checked || !writesAllowed;
    buttons[1].disabled = !writesAllowed;
    buttons[0].hidden = !item.checked;
    buttons[0].setAttribute("aria-label", `Delete ${item.name}`);
    buttons[1].setAttribute("aria-label", `Reorder ${item.name}`);
    const at = list.children[i];
    if (at !== row) list.insertBefore(row, at || null);
    existing.delete(item.key);
  });
  for (const row of existing.values()) row.remove();
  updateStatus();
}
bindEditable(
  title,
  () => state.title,
  (value) => ({ type: "title", title: value }),
);
addForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const name = addInput.value.trim();
  if (!name) return;
  const key = crypto.randomUUID().replaceAll("-", "");
  let priority;
  try {
    priority = appendPriority(state.items, key);
  } catch (e) {
    showError((e as Error).message);
    return;
  }
  const item: Item = {
    key,
    ID: key,
    name,
    checked: false,
    priority,
  };
  addInput.value = "";
  void save({ type: "add", item });
  addInput.focus();
});
window.addEventListener("beforeunload", (e) => {
  if (pending || failed.length || drafts.size) {
    e.preventDefault();
    e.returnValue = "";
  }
});
async function start() {
  if (
    !production &&
    ["qlist.cc", "www.qlist.cc", "qlist.netlify.app"].includes(
      location.hostname,
    )
  )
    throw new Error(
      "This development build cannot run on the production site.",
    );
  const requested = routeRequest(location.pathname, document.cookie);
  let id: string;
  if (local) {
    id =
      requested ??
      (await reserveGeneratedID((candidate) =>
        reserveLocalList(candidate, true),
      ));
    if (requested !== null) await reserveLocalList(id, false);
    store = new LocalStore(id);
  } else {
    const { FirebaseStore, emulatorDatabase, reserveFirebaseList } =
      await import("./firebase-store.ts");
    let db;
    const namespace = production ? "v2" : "";
    if (production) {
      const { productionDatabase, watchWrites } =
        await import("./production-store.ts");
      db = productionDatabase(crypto.randomUUID(), location.hostname);
      let accessRevision = 0;
      await new Promise<void>((resolve) => {
        watchWrites(db!, (enabled) => {
          const revision = ++accessRevision;
          writesAllowed = false;
          render(state);
          void (async () => {
            // A custom URL opened during maintenance may not yet have a claim.
            if (enabled && requested !== null)
              await reserveFirebaseList(db!, requested, false, namespace);
            if (revision === accessRevision) {
              writesAllowed = enabled;
              render(state);
              resolve();
            }
          })().catch(() => {
            if (revision === accessRevision) {
              showError(
                "Editing is paused. Keep any unsaved text and refresh when maintenance is complete.",
              );
              resolve();
            }
          });
        });
      });
      if (!writesAllowed && requested === null)
        throw new Error(
          "New lists are paused for maintenance. Existing list links remain available. Copy unsaved text before refreshing.",
        );
    } else if (mode === "staging") {
      const { stagingDatabase } = await import("./staging-store.ts");
      db = stagingDatabase(crypto.randomUUID(), location.hostname);
    } else if (
      mode === "emulator" &&
      ["localhost", "127.0.0.1"].includes(location.hostname)
    ) {
      db = emulatorDatabase(crypto.randomUUID());
    } else throw new Error("Unsupported qList build mode or hostname.");
    id =
      requested ??
      (await reserveGeneratedID((candidate) =>
        reserveFirebaseList(db, candidate, true, namespace),
      ));
    if (requested !== null && writesAllowed)
      await reserveFirebaseList(db, id, false, namespace);
    store = new FirebaseStore(db, id, namespace);
  }
  const canonical = `/${encodeURIComponent(id)}`;
  if (location.pathname !== canonical || location.search || location.hash)
    history.replaceState(null, "", canonical);
  document.cookie = `lastList=${encodeURIComponent(id)}; Max-Age=5184000; Path=/; SameSite=Lax${location.protocol === "https:" ? "; Secure" : ""}`;
  ready = true;
  add.disabled = !writesAllowed;
  title.disabled = !writesAllowed;
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
