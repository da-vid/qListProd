import { bounded, type PhotoRecord } from "./adapter.ts";
import { normalizePhoto, type NormalizedPhoto } from "./normalize.ts";
import { type PhotoGateway, type PhotoUpload } from "./gateway.ts";
import { PHOTO_DELETE_INTENT, type PhotoDeleteIntent } from "./text-delete.ts";
import type { CleanupIntent, CleanupJournal } from "./cleanup-journal.ts";
type Options = {
  minimal?: boolean;
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
      photoVersion?: number;
      record?: PhotoRecord;
      loadedAt?: number;
    }
  >();
  const cleanupQueue = new Map<string, CleanupIntent>();
  const intentKey = (i: CleanupIntent) => JSON.stringify(i);
  let journalError = false;
  try {
    for (const intent of options.cleanupJournal?.load() ?? [])
      cleanupQueue.set(intentKey(intent), intent);
  } catch {
    journalError = true;
  }
  function persistCleanup(intent: CleanupIntent, removing = false) {
    try {
      if (removing) options.cleanupJournal?.remove(intent);
      else options.cleanupJournal?.add(intent);
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
      ? `${cleanupQueue.size} item's photo cleanup is waiting. Text editing still works. Retry photos when available.`
      : "";
    if (journalError)
      summary.textContent +=
        " Photo cleanup retry data could not be saved or restored. Keep this tab open and retry when available.";
  }
  cleanupStatus();
  async function cleanup(intent: CleanupIntent) {
    cleanupQueue.set(intentKey(intent), intent);
    persistCleanup(intent);
    cleanupStatus();
    try {
      await run((signal) => adapter.remove(intent.key, intent.version, signal));
      cleanupQueue.delete(intentKey(intent));
      persistCleanup(intent, true);
    } catch {
      /* Keep only a local retry marker; do not roll back the text deletion. */
    }
    cleanupStatus();
  }
  function thumbnail(key: string, record?: PhotoRecord) {
    const entry = rows.get(key);
    if (!entry) return;
    entry.revision++;
    entry.photoVersion = record?.version ?? adapter.observedVersion?.(key);
    if (entry.thumb) win.URL.revokeObjectURL(entry.thumb);
    entry.record = record;
    entry.loadedAt = Date.now();
    entry.thumb = undefined;
    const edit = entry.bar.querySelector<HTMLButtonElement>(".photo-manage")!;
    edit.replaceChildren();
    edit.classList.toggle("photo-thumbnail", !!record);
    const label = record ? "Change photo" : "Add photo";
    edit.setAttribute("aria-label", label);
    edit.title = label;
    if (!record) {
      const glyph = make("span", "\uf030");
      glyph.className = "photo-camera-glyph";
      glyph.setAttribute("aria-hidden", "true");
      edit.append(glyph);
      return;
    }
    entry.thumb = win.URL.createObjectURL(record.thumbnail);
    const img = make("img");
    img.src = entry.thumb;
    img.alt = "";
    img.width = 34;
    img.height = 34;
    edit.append(img);
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
  function open(key: string) {
    const found = rows.get(key);
    if (!found) return;
    const entry = found;
    currentDialog?.close();
    const origin = doc.activeElement as HTMLElement | null;
    const controller = new AbortController();
    const dialog = make("dialog");
    dialog.className = "photo-dialog";
    const heading = make("h2", "Add a photo");
    heading.id = "photo-dialog-title";
    dialog.setAttribute("aria-label", "Manage photo");
    const status = make("p", "Loading photo…");
    status.setAttribute("role", "status");
    const preview = make("img");
    preview.alt = "Photo preview";
    preview.hidden = true;
    let url: string | undefined,
      selected: PhotoUpload | undefined,
      existing: PhotoRecord | undefined,
      observedVersion: number | undefined,
      busy = false,
      generation = 0;
    let expanded = false;
    const historyKey = win.crypto.randomUUID();
    const previewButton = button("", () => setExpanded(!expanded));
    previewButton.className = "photo-preview";
    previewButton.hidden = true;
    previewButton.setAttribute("aria-label", "Expand photo");
    previewButton.append(preview);
    const lightboxClose = button("×", close);
    lightboxClose.classList.add("photo-lightbox-close");
    lightboxClose.setAttribute("aria-label", "Close photo");
    lightboxClose.hidden = true;
    const back = button("Back", () => setExpanded(false));
    back.classList.add("photo-lightbox-back");
    back.setAttribute("aria-label", "Return to photo controls");
    back.hidden = true;
    function setExpanded(value: boolean, fromHistory = false) {
      if (value === expanded) return;
      expanded = value;
      dialog.classList.toggle("photo-lightbox", value);
      back.hidden = lightboxClose.hidden = !value;
      previewButton.setAttribute(
        "aria-label",
        value ? "Return to photo controls" : "Expand photo",
      );
      if (value) {
        win.history.pushState(
          { ...win.history.state, qListPhotoView: historyKey },
          "",
        );
        back.focus();
      } else {
        if (!fromHistory && win.history.state?.qListPhotoView === historyKey)
          win.history.back();
        previewButton.focus();
      }
    }
    const onBack = () => {
      if (expanded) setExpanded(false, true);
    };
    win.addEventListener("popstate", onBack);
    function close() {
      if (expanded) setExpanded(false);
      win.removeEventListener("popstate", onBack);
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
      if (expanded) setExpanded(false);
      else close();
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
    });
    function display(blob: Blob) {
      if (url) win.URL.revokeObjectURL(url);
      url = win.URL.createObjectURL(blob);
      preview.src = url;
      preview.hidden = false;
      previewButton.hidden = false;
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
      previewButton.hidden = true;
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
              (s) =>
                adapter.put(
                  key,
                  existing?.version ?? observedVersion ?? null,
                  selected!,
                  s,
                ),
              controller.signal,
            );
        if (!rows.has(key)) return;
        thumbnail(key, result);
        report(
          key,
          options.minimal
            ? ""
            : deleting
              ? "Photo removed."
              : options.storage === "gateway"
                ? "Photo saved."
                : "Photo saved in this tab.",
        );
        close();
      } catch (e) {
        entry.loadedAt = 0; // Revalidate after any uncertain write; never retry against an assumed revision.
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
      ...(options.minimal
        ? []
        : [
            make(
              "p",
              options.storage === "gateway"
                ? "Photo beta · anyone with this list link can view or change photos. Text still works if photos are unavailable."
                : "Local preview · JPEG photos · nothing is uploaded. Photos disappear when this tab reloads.",
            ),
          ]),
      status,
      previewButton,
      back,
      lightboxClose,
      camera,
      library,
      ...controls,
      save,
      remove,
      cancel,
    );
    const reload = button("Refresh", () => {
      void load();
    });
    reload.setAttribute("aria-label", "Refresh photo");
    reload.title = "Check for changes from other people";
    dialog.append(reload);
    for (const [control, label, glyph] of [
      [cameraButton, "Camera", "\uf030"],
      [libraryButton, "Choose", "\uf03e"],
      [save, "Save", "\uf00c"],
      [remove, "Delete", "\uf014"],
      [cancel, "Close", "\uf00d"],
      [reload, "Refresh", "\uf021"],
    ] as const) {
      control.setAttribute(
        "aria-label",
        control.getAttribute("aria-label") ?? control.textContent!,
      );
      const icon = make("span", glyph);
      icon.className = "photo-camera-glyph";
      icon.setAttribute("aria-hidden", "true");
      control.replaceChildren(icon, doc.createTextNode(label));
    }
    root.append(dialog);
    dialog.showModal();
    cancel.focus();
    function showRecord(record?: PhotoRecord) {
      if (controller.signal.aborted) return;
      existing = record;
      observedVersion = record?.version ?? adapter.observedVersion?.(key);
      entry.photoVersion = observedVersion;
      heading.hidden = !!record;
      cancel.setAttribute("aria-label", record ? "Close" : "Cancel");
      remove.hidden = !record;
      if (generation !== 0) return; // A selected draft owns the preview.
      controls.forEach((b) => (b.disabled = false));
      if (record) display(record.full);
      else {
        if (url) win.URL.revokeObjectURL(url);
        url = undefined;
        preview.hidden = previewButton.hidden = true;
      }
      status.textContent = record
        ? "Refresh to check for changes from others."
        : options.synthetic
          ? "Choose a JPEG or try the synthetic image."
          : "Choose a photo.";
    }
    async function load() {
      if (busy || selected) {
        status.textContent =
          "Save or close your selected photo before refreshing.";
        return;
      }
      reload.disabled = true;
      const revision = ++entry.revision;
      try {
        const record = await run((s) => adapter.get(key, s), controller.signal);
        if (controller.signal.aborted || entry.revision !== revision) return;
        thumbnail(key, record);
        showRecord(record);
      } catch (e) {
        if (!controller.signal.aborted)
          status.textContent =
            error(e) + " Close this window to continue editing text.";
      } finally {
        reload.disabled = false;
      }
    }
    // Keep a versioned Blob in memory. Reopening a fresh photo needs no download.
    // Reload/manual refresh fetch remote changes; older cached entries revalidate on open.
    if (entry.record) showRecord(entry.record);
    if (!entry.record || !entry.loadedAt || Date.now() - entry.loadedAt > 60000)
      void load();
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
      message.className = "sr-only";
      message.setAttribute("role", "status");
      const manage = button("", () => open(key));
      manage.className = "icon photo-manage";
      manage.setAttribute("aria-label", "Add photo");
      manage.title = "Add photo";
      const glyph = make("span", "\uf030");
      glyph.className = "photo-camera-glyph";
      glyph.setAttribute("aria-hidden", "true");
      manage.append(glyph);
      bar.append(manage, message);
      const handle = row.querySelector(".drag-handle");
      if (handle) handle.before(bar);
      else row.append(bar);
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
        // DOM disappearance cancels UI only; it does not authorize removal.
      }
  }
  const onDeleteIntent = (event: Event) => {
    const intent = (event as CustomEvent<PhotoDeleteIntent>).detail;
    const version = rows.get(intent.key)?.photoVersion;
    if (version === undefined) return; // A lost/unobserved hint may leave a charged orphan.
    const removal = { key: intent.key, version };
    intent.confirm = () => {
      void cleanup(removal);
    };
  };
  root.addEventListener(PHOTO_DELETE_INTENT, onDeleteIntent);
  const observer = new win.MutationObserver(reconcile);
  observer.observe(root, { childList: true, subtree: true });
  reconcile();
  return {
    async retry() {
      await Promise.all([...cleanupQueue.values()].map(cleanup));
      await Promise.all([...rows.keys()].map(refresh));
    },
    close() {
      observer.disconnect();
      root.removeEventListener(PHOTO_DELETE_INTENT, onDeleteIntent);
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
