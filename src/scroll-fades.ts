export function hiddenListEdges(
  listTop: number,
  listBottom: number,
  top: number,
  bottom: number,
  hasItems: boolean,
) {
  const visible =
    hasItems && bottom > top && listBottom > top && listTop < bottom;
  // Ignore fractional-pixel rounding at exact boundaries.
  return {
    above: visible && listTop < top - 1,
    below: visible && listBottom > bottom + 1,
  };
}
export function installScrollFades(sticky: HTMLElement, list: HTMLElement) {
  const fades = ["top", "bottom"].map((edge) => {
    const fade = document.createElement("div");
    fade.className = `list-edge-fade edge-${edge}`;
    fade.setAttribute("aria-hidden", "true");
    fade.inert = true;
    document.body.append(fade);
    return fade;
  });
  let frame = 0;
  function refresh() {
    frame = 0;
    const rect = list.getBoundingClientRect();
    const viewport = window.visualViewport;
    const top = Math.max(
      viewport?.offsetTop ?? 0,
      sticky.getBoundingClientRect().bottom,
    );
    const bottom = viewport
      ? viewport.offsetTop + viewport.height
      : window.innerHeight;
    const edges = hiddenListEdges(
      rect.top,
      rect.bottom,
      top,
      bottom,
      list.children.length > 0,
    );
    fades.forEach((fade, i) => {
      fade.style.left = `${rect.left}px`;
      fade.style.width = `${rect.width}px`;
      fade.style.top = `${i === 0 ? top : bottom}px`;
      fade.classList.toggle("visible", i === 0 ? edges.above : edges.below);
    });
  }
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(refresh);
  };
  document.addEventListener("scroll", schedule, {
    capture: true,
    passive: true,
  });
  window.addEventListener("resize", schedule);
  window.visualViewport?.addEventListener("resize", schedule);
  window.visualViewport?.addEventListener("scroll", schedule);
  if (typeof ResizeObserver !== "undefined") {
    const observer = new ResizeObserver(schedule);
    observer.observe(sticky);
    observer.observe(list);
  }
  new MutationObserver(schedule).observe(list, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "hidden"],
  });
  schedule();
  return schedule;
}
