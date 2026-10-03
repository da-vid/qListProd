import "./photo.css";
import { installPhotoUI } from "./ui.ts";
import { HttpPhotoGateway } from "./http-gateway.ts";
import { cleanupJournal } from "./cleanup-journal.ts";
import { assertProductionHost } from "../production-config.ts";
export const PHOTO_ENDPOINT =
  "https://qmpdinzendwpkqhtqskz.supabase.co/functions/v1/qlist-photos";
export function installProductionPhotos(root: HTMLElement, list: string) {
  assertProductionHost(location.hostname);
  return installPhotoUI(root, new HttpPhotoGateway(PHOTO_ENDPOINT, list), {
    storage: "gateway",
    minimal: true,
    cleanupJournal: cleanupJournal(localStorage, list),
  });
}
