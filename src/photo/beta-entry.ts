import { installPhotoUI } from "./ui.ts";
import { HttpPhotoGateway } from "./http-gateway.ts";
import { cleanupJournal } from "./cleanup-journal.ts";
// Review-only entry. Ordinary qList does not import this module.
// Selected IDs belong only in the server allowlist, not a public JavaScript bundle.
const CLIENT_ENABLED = false;
const ENDPOINT =
  "https://qmpdinzendwpkqhtqskz.supabase.co/functions/v1/qlist-photo-beta";
export function installReviewedBeta(root: HTMLElement, list: string) {
  if (!CLIENT_ENABLED) return undefined;
  return installPhotoUI(root, new HttpPhotoGateway(ENDPOINT, list), {
    storage: "gateway",
    cleanupJournal: cleanupJournal(
      root.ownerDocument.defaultView!.localStorage,
      list,
    ),
  });
}
