// Shared app-dialog dismissal. A gesture must start and end outside; dragging
// from content or scrolling a dialog must not accidentally dismiss it.
export function installModalDismissal(
  dialog: HTMLDialogElement,
  options: {
    label?: string;
    dismiss?: () => void;
    escape?: () => void;
    outside?: (event: MouseEvent) => boolean;
  } = {},
) {
  const doc = dialog.ownerDocument;
  let origin: HTMLElement | null = null;
  let outsidePointer: number | undefined;
  const header = doc.createElement("div");
  header.className = "modal-dismiss";
  const close = doc.createElement("button");
  close.type = "button";
  close.className = "modal-close";
  close.textContent = "×";
  close.setAttribute("aria-label", options.label ?? "Close dialog");
  header.append(close);
  function restoreFocus() {
    if (!dialog.open && origin?.isConnected) origin.focus();
  }
  function dismiss() {
    if (!dialog.open) return;
    if (options.dismiss) options.dismiss();
    else dialog.close();
    restoreFocus();
  }
  function outside(event: MouseEvent) {
    if (options.outside?.(event)) return true;
    const r = dialog.getBoundingClientRect();
    return (
      event.target === dialog &&
      (event.clientX < r.left ||
        event.clientX > r.right ||
        event.clientY < r.top ||
        event.clientY > r.bottom)
    );
  }
  close.addEventListener("click", dismiss);
  dialog.addEventListener("pointerdown", (event) => {
    outsidePointer =
      event.isPrimary !== false && event.button === 0 && outside(event)
        ? event.pointerId
        : undefined;
  });
  dialog.addEventListener("pointerup", (event) => {
    if (event.pointerId !== outsidePointer || !outside(event))
      outsidePointer = undefined;
  });
  dialog.addEventListener("pointercancel", () => {
    outsidePointer = undefined;
  });
  dialog.addEventListener("click", (event) => {
    const shouldDismiss = outsidePointer !== undefined && outside(event);
    outsidePointer = undefined;
    if (shouldDismiss) dismiss();
  });
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    if (options.escape) options.escape();
    else dismiss();
    restoreFocus();
  });
  dialog.addEventListener("close", restoreFocus);
  return {
    closeButton: close,
    show() {
      origin = doc.activeElement as HTMLElement | null;
      outsidePointer = undefined;
      dialog.prepend(header);
      dialog.showModal();
      close.focus();
    },
  };
}
