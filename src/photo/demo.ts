import "../main.ts";
import "./photo.css";
import { MockPhotos, type Fault } from "./adapter.ts";
import { installPhotoUI } from "./ui.ts";
import fullURL from "../../photo-lab/fixtures/clean-full.jpg?url";
import thumbURL from "../../photo-lab/fixtures/clean-thumbnail.jpg?url";
if (
  import.meta.env.MODE !== "photo-preview" ||
  !["127.0.0.1", "localhost"].includes(location.hostname)
)
  throw new Error("Local photo preview only.");
const adapter = new MockPhotos();
const root = document.querySelector<HTMLElement>("#app")!;
const ui = installPhotoUI(root, adapter, {
  synthetic: async () => {
    const [full, thumbnail] = await Promise.all([
      fetch(fullURL).then((r) => r.blob()),
      fetch(thumbURL).then((r) => r.blob()),
    ]);
    return { full, thumbnail };
  },
});
const controls = document.createElement("aside");
controls.className = "photo-lab-controls";
const label = document.createElement("label");
label.textContent = "Synthetic photo service: ";
const select = document.createElement("select");
select.setAttribute("aria-label", "Photo service simulation");
for (const mode of [
  "healthy",
  "offline",
  "paused",
  "quota",
  "rate",
  "forbidden",
  "server",
  "timeout",
]) {
  const option = document.createElement("option");
  option.value = mode;
  option.textContent = mode;
  select.append(option);
}
select.addEventListener("change", () => {
  adapter.fault = select.value as Fault;
});
label.append(select);
const retry = document.createElement("button");
retry.textContent = "Retry photos";
retry.className = "btn";
retry.addEventListener("click", () => {
  void ui.retry();
});
const note = document.createElement("p");
note.textContent =
  "Local photo experiment · add a sample text item, then try its synthetic photo. Text is browser-local; photos are tab-only. Nothing connects to Firebase or Supabase.";
controls.append(note, label, retry);
root.querySelector("main")!.prepend(controls);
