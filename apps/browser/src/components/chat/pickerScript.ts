import type { PickedElement } from "./types";

export const PICKER_SCRIPT = `
if (window.__ardiaChatPicker) window.__ardiaChatPicker.cancel();
(function () {
  var overlay = document.createElement("div");
  overlay.style.cssText = "position:fixed;pointer-events:none;z-index:2147483646;border:2px solid #4A77D4;background:rgba(74,119,212,0.12);border-radius:2px;box-sizing:border-box;";
  var label = document.createElement("div");
  label.style.cssText = "position:fixed;pointer-events:none;z-index:2147483647;background:#1c1c1e;color:#fff;font:11px/1.4 -apple-system,system-ui,sans-serif;padding:2px 6px;border-radius:4px;white-space:nowrap;max-width:60vw;overflow:hidden;text-overflow:ellipsis;";
  document.documentElement.appendChild(overlay);
  document.documentElement.appendChild(label);
  var current = null;
  function segment(el) {
    var out = el.tagName.toLowerCase();
    if (el.id) out += "#" + el.id;
    var classes = [];
    if (typeof el.className === "string") classes = el.className.split(/\\s+/).filter(Boolean).slice(0, 3);
    if (classes.length) out += "." + classes.join(".");
    return out;
  }
  function pathOf(el, limit) {
    var parts = [];
    var node = el;
    while (node && node !== document.documentElement) {
      parts.unshift(segment(node));
      node = node.parentElement;
    }
    parts.unshift("html");
    return limit ? parts.slice(-limit).join(" > ") : parts.join(" > ");
  }
  function describe(el) {
    var name = segment(el);
    var text = (el.getAttribute && (el.getAttribute("aria-label") || el.getAttribute("title"))) || "";
    return text ? name + " \\"" + text.slice(0, 40) + "\\"" : name;
  }
  function reactInfo(el) {
    var names = [];
    var source = "";
    var node = el;
    while (node && names.length < 6) {
      var key = Object.keys(node).find(function (k) { return k.indexOf("__reactFiber$") === 0 || k.indexOf("__reactInternalInstance$") === 0; });
      if (key) {
        var fiber = node[key];
        while (fiber && names.length < 6) {
          var type = fiber.type;
          var name = typeof type === "function" || (type && typeof type === "object") ? (type.displayName || type.name || (type.render && (type.render.displayName || type.render.name))) : null;
          if (name && names.indexOf(name) === -1) names.push(name);
          if (!source && fiber._debugSource) source = fiber._debugSource.fileName + ":" + fiber._debugSource.lineNumber;
          fiber = fiber.return;
        }
      }
      node = node.parentElement;
    }
    return { names: names, source: source };
  }
  function describeFull(el) {
    var rect = el.getBoundingClientRect();
    var style = getComputedStyle(el);
    var keys = ["display", "position", "font-size", "font-weight", "color", "background-color", "padding", "margin", "text-align"];
    var styles = {};
    keys.forEach(function (k) { styles[k] = style.getPropertyValue(k); });
    var classes = [];
    if (typeof el.className === "string") classes = el.className.split(/\\s+/).filter(Boolean);
    var info = reactInfo(el);
    var selection = String(getSelection() || "").trim();
    var result = {
      element: describe(el),
      elementPath: pathOf(el, 4),
      fullPath: pathOf(el, 0),
      boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      cssClasses: classes,
      computedStyles: styles,
      nearbyText: ((el.innerText || el.textContent || "").trim().replace(/\\s+/g, " ")).slice(0, 200)
    };
    if (selection) result.selectedText = selection.slice(0, 500);
    if (info.names.length) result.reactComponents = info.names;
    if (info.source) result.sourceFile = info.source;
    return result;
  }
  function place(el) {
    var rect = el.getBoundingClientRect();
    overlay.style.left = rect.x + "px";
    overlay.style.top = rect.y + "px";
    overlay.style.width = rect.width + "px";
    overlay.style.height = rect.height + "px";
    label.textContent = describe(el);
    label.style.left = Math.max(4, Math.min(rect.x, innerWidth - 240)) + "px";
    label.style.top = Math.max(4, rect.y - 24) + "px";
  }
  function cleanup() {
    document.removeEventListener("pointermove", onMove, true);
    document.removeEventListener("click", onClick, true);
    document.removeEventListener("contextmenu", onContext, true);
    document.removeEventListener("keydown", onKey, true);
    overlay.remove();
    label.remove();
    if (window.__ardiaChatPicker && window.__ardiaChatPicker.active) delete window.__ardiaChatPicker;
  }
  function finish(value) {
    cleanup();
    post("result", JSON.stringify(value));
  }
  function onMove(event) {
    var el = document.elementFromPoint(event.clientX, event.clientY);
    if (!el || el === overlay || el === label) return;
    current = el;
    place(el);
  }
  function onClick(event) {
    event.preventDefault();
    event.stopPropagation();
    if (current) finish(describeFull(current));
  }
  function onContext(event) {
    event.preventDefault();
    finish(null);
  }
  function onKey(event) {
    if (event.key === "Escape") finish(null);
  }
  document.addEventListener("pointermove", onMove, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("contextmenu", onContext, true);
  document.addEventListener("keydown", onKey, true);
  window.__ardiaChatPicker = { active: true, cancel: function () { finish(null); } };
})();
`;

export function highlightScript(pick: PickedElement): string {
  return `
(function () {
  var el = null;
  try { el = document.querySelector(${JSON.stringify(pick.fullPath)}); } catch (e) {}
  var box = ${JSON.stringify(pick.boundingBox)};
  if (el) {
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    var rect = el.getBoundingClientRect();
    box = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }
  var overlay = document.createElement("div");
  overlay.style.cssText = "position:fixed;pointer-events:none;z-index:2147483647;border:2px solid #4A77D4;background:rgba(74,119,212,0.15);border-radius:2px;box-sizing:border-box;left:" + box.x + "px;top:" + box.y + "px;width:" + box.width + "px;height:" + box.height + "px;transition:opacity 300ms;";
  document.documentElement.appendChild(overlay);
  setTimeout(function () { overlay.style.opacity = "0"; }, 700);
  setTimeout(function () { overlay.remove(); }, 1100);
  post("result", "true");
})();
`;
}
