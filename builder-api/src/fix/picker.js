// Step 54a: runs inside the "Fix a part" view of a built page (a sandboxed frame, numbered by the Builder API).
// Drawing a box (or clicking) picks the smallest part that holds what is inside the box, outlines it, and
// tells the app with postMessage: { type: "ak-pick", kind: "part", n } for a part written in the page's HTML,
// { kind: "style", selector } for a part the page's own script drew, or { error }. Links and buttons don't
// work while picking. The app treats the message as a hint only: the Builder API checks it again.
(() => {
  const MARKERS = ["data-action", "data-field", "data-filter", "data-stat"];
  const PINK = "#ff6b9a";
  const layer = document.createElement("div");
  const mark = document.createElement("div");
  layer.style.cssText = `position:absolute;border:2px dashed ${PINK};background:rgba(255,107,154,.12);pointer-events:none;z-index:2147483647;display:none`;
  mark.style.cssText = `position:absolute;outline:3px solid ${PINK};outline-offset:2px;border-radius:4px;pointer-events:none;z-index:2147483646;display:none`;
  const look = document.createElement("style");
  look.textContent = "html,body,body *{cursor:crosshair!important;user-select:none!important}";
  const mount = () => document.body.append(layer, mark, look);
  if (document.body) mount();
  else document.addEventListener("DOMContentLoaded", mount);

  let start = null;
  const send = (message) => parent.postMessage({ type: "ak-pick", ...message }, "*");
  const ours = (el) => el === layer || el === mark || el === look;
  const area = (r) => (r.right - r.left) * (r.bottom - r.top);
  const boxFrom = (e) => ({ left: Math.min(start.x, e.pageX), top: Math.min(start.y, e.pageY), right: Math.max(start.x, e.pageX), bottom: Math.max(start.y, e.pageY) });

  function place(el, r) {
    Object.assign(el.style, { display: "block", left: `${r.left}px`, top: `${r.top}px`, width: `${r.right - r.left}px`, height: `${r.bottom - r.top}px` });
  }
  function pageRect(el) {
    const b = el.getBoundingClientRect();
    return { left: b.left + scrollX, top: b.top + scrollY, right: b.right + scrollX, bottom: b.bottom + scrollY };
  }
  function common(a, b) {
    let x = a;
    while (x && !x.contains(b)) x = x.parentElement;
    return x;
  }
  function describe(el) {
    const text = (el.innerText || el.value || el.placeholder || el.alt || "").trim().replace(/\s+/g, " ").slice(0, 60);
    return `${el.tagName.toLowerCase()}${text ? ` “${text}”` : ""}`;
  }
  // A part the page's script drew has no number: find it again by its marker, or by an id around it.
  function selectorFor(el) {
    const own = MARKERS.find((m) => el.hasAttribute(m) && /^[\w-]+$/.test(el.getAttribute(m)));
    if (own) return `[${own}="${el.getAttribute(own)}"]`;
    const tag = el.tagName.toLowerCase();
    const holder = el.parentElement?.closest(MARKERS.map((m) => `[${m}]`).join(","));
    const marker = holder && MARKERS.find((m) => holder.hasAttribute(m) && /^[\w-]+$/.test(holder.getAttribute(m)));
    if (marker) return `[${marker}="${holder.getAttribute(marker)}"] ${tag}`;
    const withId = el.parentElement?.closest("[id]");
    if (withId && /^[A-Za-z][\w-]*$/.test(withId.id)) return `#${withId.id} ${tag}`;
    return null;
  }

  function pick(r) {
    let target;
    if (area(r) < 36) target = document.elementFromPoint(r.left - scrollX, r.top - scrollY);
    else {
      const inside = [...document.body.querySelectorAll("*")].filter((el) => {
        if (ours(el) || ["SCRIPT", "STYLE"].includes(el.tagName)) return false;
        const b = pageRect(el);
        const size = area(b);
        if (size < 4) return false;
        const w = Math.max(0, Math.min(r.right, b.right) - Math.max(r.left, b.left));
        const h = Math.max(0, Math.min(r.bottom, b.bottom) - Math.max(r.top, b.top));
        return w * h >= 0.6 * size;
      });
      const outer = inside.filter((el) => !inside.some((o) => o !== el && o.contains(el)));
      target = outer.length ? outer.reduce(common) : document.elementFromPoint((r.left + r.right) / 2 - scrollX, (r.top + r.bottom) / 2 - scrollY);
    }
    if (!target || ours(target) || target === document.body || target === document.documentElement) {
      mark.style.display = "none";
      return send({ error: "Draw the box around one part of the page (a button, a card, a heading)." });
    }
    place(mark, pageRect(target));
    const label = describe(target);
    if (target.hasAttribute("data-ak-n")) return send({ kind: "part", n: Number(target.getAttribute("data-ak-n")), label });
    const selector = selectorFor(target);
    return selector ? send({ kind: "style", selector, label }) : send({ error: "That part is drawn by the page's script and has no marker. Mark a button or a cell in it." });
  }

  addEventListener("click", (e) => (e.preventDefault(), e.stopPropagation()), true);
  addEventListener("submit", (e) => e.preventDefault(), true);
  addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    start = { x: e.pageX, y: e.pageY };
    place(layer, boxFrom(e));
  }, true);
  addEventListener("mousemove", (e) => start && place(layer, boxFrom(e)), true);
  addEventListener("mouseup", (e) => {
    if (!start) return;
    const r = boxFrom(e);
    start = null;
    layer.style.display = "none";
    pick(r);
  }, true);
  addEventListener("message", (e) => e.data?.type === "ak-clear" && (mark.style.display = "none"));
})();
