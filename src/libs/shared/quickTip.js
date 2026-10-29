// v-quick-tip="text": a tooltip that appears after SHOW_DELAY ms. Browser `title` tooltips
// wait ~1–2 s and the delay can't be changed. Used for the "calculated" marks, which
// researchers hover to see how a value was worked out.
// The tip is attached to <body> with fixed positioning, so scrolling containers and
// sticky table headers don't clip it.

const SHOW_DELAY = 300;
let tipEl = null;

function ensureTip() {
  if (tipEl) return tipEl;
  tipEl = document.createElement("div");
  Object.assign(tipEl.style, {
    position: "fixed",
    zIndex: "3000",
    maxWidth: "320px",
    padding: "6px 10px",
    background: "#1e293b",
    color: "#ffffff",
    borderRadius: "4px",
    fontSize: "14px",
    lineHeight: "1.35",
    whiteSpace: "pre-line",
    pointerEvents: "none",
    boxShadow: "0 4px 12px rgba(15, 23, 42, 0.2)",
    display: "none",
  });
  document.body.appendChild(tipEl);
  return tipEl;
}

function show(el) {
  const text = el._quickTip?.text;
  if (!text) return;
  const tip = ensureTip();
  tip.textContent = text;
  // Match the widget's font, not the page's
  tip.style.fontFamily = getComputedStyle(el).fontFamily;
  tip.style.display = "block";
  const rect = el.getBoundingClientRect();
  const tipRect = tip.getBoundingClientRect();
  const left = Math.min(Math.max(4, rect.left), window.innerWidth - tipRect.width - 4);
  // Below the element, or above it near the bottom of the window
  const below = rect.bottom + 6;
  const top = below + tipRect.height > window.innerHeight ? rect.top - tipRect.height - 6 : below;
  tip.style.left = `${left}px`;
  tip.style.top = `${top}px`;
}

function hide(el) {
  clearTimeout(el._quickTip?.timer);
  if (tipEl) tipEl.style.display = "none";
}

export const vQuickTip = {
  mounted(el, binding) {
    el._quickTip = {
      text: binding.value,
      timer: null,
      enter: () => {
        clearTimeout(el._quickTip.timer);
        el._quickTip.timer = setTimeout(() => show(el), SHOW_DELAY);
      },
      leave: () => hide(el),
    };
    el.addEventListener("mouseenter", el._quickTip.enter);
    el.addEventListener("mouseleave", el._quickTip.leave);
    el.addEventListener("mousedown", el._quickTip.leave);
  },
  updated(el, binding) {
    el._quickTip.text = binding.value;
  },
  unmounted(el) {
    hide(el);
    el.removeEventListener("mouseenter", el._quickTip.enter);
    el.removeEventListener("mouseleave", el._quickTip.leave);
    el.removeEventListener("mousedown", el._quickTip.leave);
  },
};
