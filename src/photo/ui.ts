import { bounded, type PhotoRecord } from "./adapter.ts";
import { normalizePhoto, type NormalizedPhoto } from "./normalize.ts";
import { type PhotoGateway, type PhotoUpload } from "./gateway.ts";
import type { CleanupJournal } from "./cleanup-journal.ts";
type Options = {
  cleanupJournal?: CleanupJournal;
  storage?: "tab" | "gateway";
  prepare?: (file: Blob, signal: AbortSignal) => Promise<NormalizedPhoto>;
  synthetic?: (signal: AbortSignal) => Promise<NormalizedPhoto>;
  timeout?: number;
};
export function installPhotoUI(
  root: HTMLElement,
  adapter: PhotoGateway,
  options: Options = {},
) {
  const doc = root.ownerDocument,
    win = doc.defaultView!;
  const rows = new Map<
    string,
    {
      row: HTMLElement;
      bar: HTMLElement;
      message: HTMLElement;
      thumb?: string;
      lifetime: AbortController;
      revision: number;
    }
  >();
  const cleanupQueue = new Set<string>();
  let journalError = false;
  try {
    for (const key of options.cleanupJournal?.load() ?? [])
      cleanupQueue.add(key);
  } catch {
    journalError = true;
  }
  function persistCleanup(key: string, removing = false) {
    try {
      if (removing) options.cleanupJournal?.remove(key);
      else options.cleanupJournal?.add(key);
      journalError = false;
    } catch {
      journalError = true;
    }
  }
  let currentDialog: { key: string; close: () => void } | undefined;
  const make = <K extends keyof HTMLElementTagNameMap>(tag: K, text = "") => {
    const el = doc.createElement(tag);
    el.textContent = text;
    return el;
  };
  const button = (text: string, action: () => void) => {
    const b = make("button", text);
    b.type = "button";
    b.className = "btn photo-button";
    b.addEventListener("click", action);
    return b;
  };
  const error = (e: unknown) =>
    e instanceof Error
      ? e.message
      : "Photo unavailable. Text edits still work.";
  const run = <T>(
    fn: (signal: AbortSignal) => Promise<T>,
    parent?: AbortSignal,
  ) => bounded(fn, options.timeout ?? 5000, parent);
  const report = (key: string, message: string) => {
    const row = rows.get(key);
    if (row) row.message.textContent = message;
  };
  const summary = make("p");
  summary.className = "photo-cleanup";
  summary.setAttribute("role", "status");
  root.append(summary);
  function cleanupStatus() {
    summary.textContent = cleanupQueue.size
      ? `${cleanupQueue.size} removed item's photo cleanup is waiting. Text deletion is saved. Retry photos when available.`
      : "";
    if (journalError)
      summary.textContent +=
        " Photo cleanup retry data could not be saved or restored. Keep this tab open and retry when available.";
  }
  cleanupStatus();
  async function cleanup(key: string) {
    cleanupQueue.add(key);
    persistCleanup(key);
    cleanupStatus();
    try {
      await run((signal) => adapter.deleteItem(key, signal));
      cleanupQueue.delete(key);
      persistCleanup(key, true);
    } catch {
      /* Keep only a local retry marker; do not roll back the text deletion. */
    }
    cleanupStatus();
  }
  function thumbnail(key: string, record?: PhotoRecord) {
    const entry = rows.get(key);
    if (!entry) return;
    entry.revision++;
    if (entry.thumb) win.URL.revokeObjectURL(entry.thumb);
    entry.bar.querySelector(".photo-thumbnail")?.remove();
    entry.thumb = undefined;
    const edit = entry.bar.querySelector("button")!;
    edit.textContent = record ? "Change photo" : "Add photo";
    if (!record) return;
    const url = win.URL.createObjectURL(record.thumbnail);
    entry.thumb = url;
    const b = button("", () => open(key, true));
    b.classList.add("photo-thumbnail");
    b.setAttribute("aria-label", "Expand item photo");
    const img = make("img");
    img.src = url;
    img.alt = "Item photo";
    img.width = 48;
    img.height = 48;
    b.append(img);
    entry.bar.append(b);
  }
  async function refresh(key: string) {
    const entry = rows.get(key);
    if (!entry) return;
    const revision = ++entry.revision;
    try {
      const p = await run(
        (signal) => adapter.get(key, signal),
        entry.lifetime.signal,
      );
      if (rows.get(key) === entry && entry.revision === revision) {
        thumbnail(key, p);
        report(key, "");
      }
    } catch (e) {
      if (!entry.lifetime.signal.aborted && entry.revision === revision)
        report(key, error(e));
    }
  }
  function open(key: string, expanded = false) {
    const entry = rows.get(key);
    if (!entry) return;
    currentDialog?.close();
    const origin = doc.activeElement as HTMLElement | null;
    const controller = new AbortController();
    const dialog = make("dialog");
    dialog.className = "photo-dialog";
    const heading = make("h2", expanded ? "Item photo" : "Attach a photo");
    heading.id = "photo-dialog-title";
    dialog.setAttribute("aria-labelledby", heading.id);
    const status = make("p", "Loading photo…");
    status.setAttribute("role", "status");
    const preview = make("img");
    preview.alt = "Photo preview";
    preview.hidden = true;
    let url: string | undefined,
      selected: PhotoUpload | undefined,
      existing: PhotoRecord | undefined,
      busy = false,
      generation = 0;
    function close() {
      controller.abort();
      generation++;
      if (url) win.URL.revokeObjectURL(url);
      dialog.close();
      dialog.remove();
      if (currentDialog?.key === key) currentDialog = undefined;
      if (origin?.isConnected) origin.focus();
    }
    currentDialog = { key, close };
    dialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      close();
    });
    const cancel = button("Cancel", close),
      save = button("Save photo", () => {
        void commit(false);
      }),
      remove = button("Remove photo", () => {
        void commit(true);
      });
    save.disabled = true;
    remove.hidden = true;
    const camera = make("input"),
      library = make("input");
    for (const input of [camera, library]) {
      input.type = "file";
      input.accept = "image/jpeg,.jpg,.jpeg,image/heic,image/heif,.heic,.heif";
      input.hidden = true;
      input.addEventListener("change", () => {
        const file = input.files?.[0];
        if (file)
          void select((signal) =>
            (options.prepare ?? normalizePhoto)(file, signal),
          );
        input.value = "";
      });
    }
    camera.setAttribute("capture", "environment");
    const cameraButton = button("Camera", () => camera.click()),
      libraryButton = button("Photo library", () => library.click());
    const synthetic = options.synthetic
      ? button("Try synthetic image", () => {
          void select((signal) => options.synthetic!(signal));
        })
      : undefined;
    const controls = [
      cameraButton,
      libraryButton,
      ...(synthetic ? [synthetic] : []),
    ];
    controls.forEach((b) => {
      b.disabled = true;
      b.hidden = expanded;
    });
    function display(blob: Blob) {
      if (url) win.URL.revokeObjectURL(url);
      url = win.URL.createObjectURL(blob);
      preview.src = url;
      preview.hidden = false;
    }
    async function select(
      prepare: (signal: AbortSignal) => Promise<NormalizedPhoto>,
    ) {
      const version = ++generation;
      selected = undefined;
      save.disabled = true;
      if (url) win.URL.revokeObjectURL(url);
      url = undefined;
      preview.hidden = true;
      controls.forEach((b) => (b.disabled = true));
      status.textContent = "Preparing JPEG…";
      try {
        const photo = await run(prepare, controller.signal);
        if (controller.signal.aborted || version !== generation) return;
        selected = { operationId: win.crypto.randomUUID(), jpeg: photo.jpeg };
        display(photo.jpeg);
        save.disabled = false;
        status.textContent = "Preview only. Save to attach this photo.";
      } catch (e) {
        if (!controller.signal.aborted && version === generation)
          status.textContent = error(e);
      } finally {
        if (!controller.signal.aborted && version === generation)
          controls.forEach((b) => (b.disabled = false));
      }
    }
    async function commit(deleting: boolean) {
      if (busy || (!deleting && !selected)) return;
      busy = true;
      save.disabled = true;
      remove.disabled = true;
      controls.forEach((b) => (b.disabled = true));
      status.textContent = deleting ? "Removing photo…" : "Saving photo…";
      try {
        const result = deleting
          ? (await run(
              (s) => adapter.remove(key, existing!.version, s),
              controller.signal,
            ),
            undefined)
          : await run(
              (s) => adapter.put(key, existing?.version ?? null, selected!, s),
              controller.signal,
            );
        if (!rows.has(key)) {
          void cleanup(key);
          return;
        }
        thumbnail(key, result);
        report(
          key,
          deleting
            ? "Photo removed."
            : options.storage === "gateway"
              ? "Photo saved."
              : "Photo saved in this tab.",
        );
        close();
      } catch (e) {
        if (!deleting && selected && !controller.signal.aborted) {
          try {
            const operation = await run(
              (s) => adapter.status(selected!.operationId, s),
              controller.signal,
            );
            if (operation?.state === "committed") {
              const current = await run(
                (s) => adapter.get(key, s),
                controller.signal,
              );
              if (rows.has(key)) thumbnail(key, current);
              report(
                key,
                options.storage === "gateway"
                  ? "Photo save confirmed."
                  : "Photo save confirmed in this tab.",
              );
              close();
              return;
            }
            if (operation?.state === "pending") {
              status.textContent =
                "The photo save is still being checked. Keep this window open and retry later. Text edits still work.";
              return;
            }
          } catch {
            /* Unavailable status is not proof that a save failed. */
          }
        }
        if (!controller.signal.aborted)
          status.textContent = error(e) + " Text edits still work.";
      } finally {
        busy = false;
        save.disabled = !selected;
        remove.disabled = false;
        controls.forEach((b) => (b.disabled = false));
      }
    }
    dialog.append(
      heading,
      make(
        "p",
        options.storage === "gateway"
          ? "Photo beta · anyone with this list link can view or change photos. Text still works if photos are unavailable."
          : "Local preview · JPEG photos · nothing is uploaded. Photos disappear when this tab reloads.",
      ),
      status,
      preview,
      camera,
      library,
      ...controls,
      save,
      remove,
      cancel,
    );
    save.hidden = expanded;
    root.append(dialog);
    dialog.showModal();
    cancel.focus();
    void run((s) => adapter.get(key, s), controller.signal)
      .then((record) => {
        if (controller.signal.aborted) return;
        existing = record;
        // A file chosen before the initial read completed owns the preview/status.
        if (generation !== 0) return;
        controls.forEach((b) => (b.disabled = false));
        remove.hidden = expanded || !record;
        if (record) display(record.full);
        status.textContent = expanded
          ? record
            ? ""
            : "This photo is no longer available."
          : "Choose a JPEG or try the synthetic image.";
        if (expanded) cancel.textContent = "Close";
      })
      .catch((e) => {
        if (!controller.signal.aborted)
          status.textContent =
            error(e) + " Close this window to continue editing text.";
      });
  }
  function reconcile() {
    const present = new Set<string>();
    root.querySelectorAll<HTMLElement>(".item[data-key]").forEach((row) => {
      const key = row.dataset.key!;
      present.add(key);
      if (rows.has(key)) return;
      const bar = make("div");
      bar.className = "photo-controls";
      const message = make("span");
      message.setAttribute("role", "status");
      bar.append(
        button("Add photo", () => open(key)),
        message,
      );
      row.append(bar);
      rows.set(key, {
        row,
        bar,
        message,
        lifetime: new AbortController(),
        revision: 0,
      });
      void refresh(key);
    });
    for (const [key, entry] of rows)
      if (!present.has(key)) {
        entry.lifetime.abort();
        if (entry.thumb) win.URL.revokeObjectURL(entry.thumb);
        rows.delete(key);
        if (currentDialog?.key === key) currentDialog.close();
        void cleanup(key);
      }
  }
  const observer = new win.MutationObserver(reconcile);
  observer.observe(root, { childList: true, subtree: true });
  reconcile();
  return {
    async retry() {
      await Promise.all([...cleanupQueue].map(cleanup));
      await Promise.all([...rows.keys()].map(refresh));
    },
    close() {
      observer.disconnect();
      currentDialog?.close();
      for (const entry of rows.values()) {
        entry.lifetime.abort();
        if (entry.thumb) win.URL.revokeObjectURL(entry.thumb);
        entry.bar.remove();
      }
      rows.clear();
      summary.remove();
    },
  };
}
