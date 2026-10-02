export function installAboutPrivacy(app: HTMLElement, footer: HTMLElement) {
  const link = document.createElement("a");
  link.href = "#about-privacy";
  link.className = "about-link";
  link.textContent = "About & Privacy";
  link.setAttribute("aria-haspopup", "dialog");
  footer.append(link);

  const dialog = document.createElement("dialog");
  dialog.className = "about-dialog";
  dialog.setAttribute("aria-labelledby", "about-heading");
  const heading = document.createElement("h2");
  heading.id = "about-heading";
  heading.tabIndex = -1;
  heading.textContent = "About & Privacy";
  dialog.append(heading);
  const paragraph = (text: string, className = "") => {
    const p = document.createElement("p");
    p.className = className;
    p.textContent = text;
    dialog.append(p);
  };
  paragraph("Effective October 1, 2026", "notice-date");
  paragraph(
    "qList is a free, lightweight shared-list tool intended for people ages 13 and up.",
  );
  const sections = [
    [
      "Shared lists",
      [
        "Anyone who obtains or guesses a list’s address can view and edit it, including deleting checked items. Short and custom addresses aren’t passwords. Don’t store sensitive information here, and keep your own copy of anything important.",
      ],
    ],
    [
      "Your content",
      [
        "Your content remains yours. qList uses it to operate the shared-list service and maintain backups. It isn’t claimed for advertising or unrelated reuse. Please don’t post unlawful content, harass others, or disrupt the service.",
      ],
    ],
    [
      "Storage and privacy",
      [
        "Lists are stored using Google Firebase, and Netlify hosts the website. These providers process technical information such as IP addresses and browser details. The current app has no advertising or analytics integration.",
        "A cookie remembers your last list for up to 60 days. Firebase also uses browser storage for technical operation. qList does not currently respond to Do Not Track or Global Privacy Control signals.",
        "Deleting an item removes it from the current list. Older copies may remain in backups.",
      ],
    ],
    [
      "Availability",
      [
        "qList is provided as is and as available. Availability, recovery, and permanent storage aren’t guaranteed. Unsaved changes can be lost if you close or reload the page. The service may change or stop. Nothing in this notice limits rights that cannot legally be limited.",
      ],
    ],
  ] as const;
  for (const [title, paragraphs] of sections) {
    const h = document.createElement("h3");
    h.textContent = title;
    dialog.append(h);
    for (const text of paragraphs) paragraph(text);
  }
  paragraph("Changes to this notice will appear here with an updated date.");
  const close = document.createElement("button");
  close.type = "button";
  close.className = "btn";
  close.textContent = "Close";
  function dismiss() {
    dialog.close();
    link.focus();
  }
  close.addEventListener("click", dismiss);
  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    dismiss();
  });
  dialog.addEventListener("close", () => link.focus());
  const actions = document.createElement("div");
  actions.className = "nav";
  actions.append(close);
  dialog.append(actions);
  app.append(dialog);
  link.addEventListener("click", (event) => {
    event.preventDefault();
    dialog.showModal();
    heading.focus();
  });
}
