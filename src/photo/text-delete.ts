import { SavedMetadataWarning, type Change } from "../model.ts";
export const PHOTO_DELETE_INTENT = "qlist:photo-delete-intent";
export type PhotoDeleteIntent = { key: string; confirm?: () => void };
// Observe the existing SDK write outcome; never add a read, listener or text write.
export async function applyWithPhotoCleanup(
  root: HTMLElement,
  change: Change,
  write: () => Promise<void>,
) {
  const intent: PhotoDeleteIntent | undefined =
    change.type === "delete" ? { key: change.key } : undefined;
  if (intent)
    root.dispatchEvent(
      new root.ownerDocument.defaultView!.CustomEvent(PHOTO_DELETE_INTENT, {
        detail: intent,
      }),
    );
  const confirm = () => {
    try {
      intent?.confirm?.();
    } catch {
      /* Photo failure cannot fail a confirmed text write. */
    }
  };
  try {
    await write();
  } catch (error) {
    if (error instanceof SavedMetadataWarning) confirm();
    throw error;
  }
  confirm();
}
