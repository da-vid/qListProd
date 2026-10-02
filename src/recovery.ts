import "./style.css";
import { FirebaseStore } from "./firebase-store.ts";
import { productionDatabase } from "./production-store.ts";
import { PRODUCTION_NAMESPACE } from "./production-config.ts";
import { routeRequest } from "./model.ts";
const app = document.querySelector<HTMLDivElement>("#app")!;
const panel = document.createElement("main");
panel.className = "shell";
const heading = document.createElement("h1");
heading.textContent = "qList · reading mode";
const message = document.createElement("p");
message.textContent =
  "Editing is temporarily paused. Your latest saved items remain available here. Copy any unsaved text from older tabs before refreshing; old offline edits do not transfer automatically.";
const status = document.createElement("p");
status.setAttribute("role", "status");
const title = document.createElement("h2");
const list = document.createElement("ul");
list.setAttribute("aria-label", "Saved list items");
const refresh = document.createElement("button");
refresh.type = "button";
refresh.className = "btn";
refresh.textContent = "Check for updates";
refresh.addEventListener("click", () => location.reload());
panel.append(heading, message, status, title, list, refresh);
app.append(panel);
try {
  const id = routeRequest(location.pathname, document.cookie);
  if (!id)
    status.textContent = "Open an existing list link to see its saved items.";
  else {
    const db = productionDatabase(crypto.randomUUID(), location.hostname);
    const store = new FirebaseStore(db, id, PRODUCTION_NAMESPACE);
    store.subscribe(
      (state) => {
        title.textContent = state.title || "my qList";
        list.replaceChildren(
          ...state.items.map((item) => {
            const row = document.createElement("li");
            row.textContent = `${item.checked ? "✓" : "○"} ${item.name}`;
            return row;
          }),
        );
      },
      (connected) => {
        status.textContent = connected
          ? "Showing saved items · editing paused"
          : "Offline · saved items may be out of date";
      },
      () => {
        status.textContent =
          "Saved items could not be loaded. Keep the link and try again.";
      },
    );
  }
} catch {
  status.textContent =
    "This reading-mode build is restricted to the qList site and valid list links.";
}
