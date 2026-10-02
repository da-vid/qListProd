import "./style.css";
const app = document.querySelector<HTMLDivElement>("#app")!;
const panel = document.createElement("main");
panel.className = "shell";
const heading = document.createElement("h1");
heading.textContent = "qList is being updated";
const message = document.createElement("p");
message.textContent =
  "Your list links will stay the same. Editing is temporarily paused. Keep older tabs open and copy any unsaved text before refreshing; old offline edits will not transfer automatically.";
const refresh = document.createElement("button");
refresh.type = "button";
refresh.className = "btn primary";
refresh.textContent = "Check again";
refresh.addEventListener("click", () => location.reload());
panel.append(heading, message, refresh);
app.append(panel);
