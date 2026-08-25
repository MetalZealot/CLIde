// Shell: tabs, sheets, and the two controls every tab shares -- a picker that
// replaces the native select, and a stepper that makes a slider exact.

const el = (id) => document.getElementById(id);

const Studio = {};
window.Studio = Studio;

/* Tabs --------------------------------------------------------------- */

const TAB_KEY = "voice-studio-tab";

function activateTab(name) {
  for (const button of document.querySelectorAll("[data-studio-tab]")) {
    const active = button.dataset.studioTab === name;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  }
  for (const pane of document.querySelectorAll(".studio-pane")) {
    pane.hidden = pane.id !== `${name}-studio`;
  }
  try { localStorage.setItem(TAB_KEY, name); } catch { /* private mode */ }
  window.scrollTo({ top: 0 });
  document.dispatchEvent(new CustomEvent("studio:tab", { detail: name }));
}
Studio.activateTab = activateTab;

for (const button of document.querySelectorAll("[data-studio-tab]")) {
  button.addEventListener("click", () => activateTab(button.dataset.studioTab));
}

/* Sheets: full-screen, and the phone's Back button closes them. ------- */

let currentSheet = null;
let onSheetClose = null;

function closeSheetNow() {
  if (!currentSheet) return;
  el(currentSheet).hidden = true;
  document.body.style.overflow = "";
  currentSheet = null;
  const handler = onSheetClose;
  onSheetClose = null;
  if (handler) handler();
}

function openSheet(id, closeHandler = null) {
  if (currentSheet) closeSheetNow();
  onSheetClose = closeHandler;
  el(id).hidden = false;
  document.body.style.overflow = "hidden";
  currentSheet = id;
  history.pushState({ sheet: id }, "");
}

function closeSheet() {
  if (currentSheet) history.back();
}

window.addEventListener("popstate", closeSheetNow);
Studio.openSheet = openSheet;
Studio.closeSheet = closeSheet;
Studio.isSheetOpen = () => Boolean(currentSheet);

/* One-of-many picker, in place of a native select. -------------------- */

function optionRow(option, selected) {
  const row = document.createElement("button");
  row.type = "button";
  row.className = `vrow${selected ? " current" : ""}`;
  const main = document.createElement("div");
  main.className = "vrow-main";
  const title = document.createElement("strong");
  title.textContent = option.label;
  main.appendChild(title);
  if (option.detail) {
    const detail = document.createElement("div");
    detail.className = "vrow-meta";
    detail.textContent = option.detail;
    main.appendChild(detail);
  }
  const mark = document.createElement("span");
  mark.className = "vrow-star";
  mark.textContent = selected ? "✓" : "";
  row.append(main, mark);
  return row;
}

function chooseOption({ title, options, value }) {
  return new Promise((resolve) => {
    let answered = false;
    el("option-title").textContent = title;
    const list = el("option-list");
    list.replaceChildren();
    for (const option of options) {
      const row = optionRow(option, option.value === value);
      row.addEventListener("click", () => {
        answered = true;
        resolve(option.value);
        closeSheet();
      });
      list.appendChild(row);
    }
    openSheet("option-sheet", () => { if (!answered) resolve(null); });
  });
}
Studio.chooseOption = chooseOption;

/* A picker button rendered from an option list. ----------------------- */

function bindPicker(button, { title, options, onChange }) {
  const paint = () => {
    const option = options.find((entry) => String(entry.value) === button.dataset.value)
      || options[0];
    button.querySelector("strong").textContent = option.label;
    button.querySelector("small").textContent = option.detail || "";
    return option;
  };
  button.addEventListener("click", async () => {
    const chosen = await chooseOption({ title, options, value: button.dataset.value });
    if (chosen === null) return;
    button.dataset.value = String(chosen);
    paint();
    if (onChange) onChange(chosen);
  });
  paint();
}
Studio.bindPicker = bindPicker;

/* Stepper: drag for coarse, tap +/- for exact, type for exact. -------- */

function createStepper({ label, hint, min, max, step, value, format, onChange }) {
  const decimals = String(step).split(".")[1]?.length || 0;
  const clean = (raw) => {
    const stepped = Math.round(raw / step) * step;
    return Number(Math.min(max, Math.max(min, stepped)).toFixed(decimals));
  };
  let current = clean(value);

  const wrap = document.createElement("div");
  wrap.className = "stepper";

  const top = document.createElement("div");
  top.className = "stepper-top";
  const name = document.createElement("span");
  name.textContent = label;
  const readout = document.createElement("input");
  readout.className = "stepper-value";
  readout.type = "text";
  readout.inputMode = "decimal";
  readout.setAttribute("aria-label", `${label} value`);
  top.append(name, readout);

  const row = document.createElement("div");
  row.className = "stepper-row";
  const down = document.createElement("button");
  down.type = "button";
  down.className = "icon-button";
  down.textContent = "−";
  down.setAttribute("aria-label", `Decrease ${label}`);
  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = String(min);
  slider.max = String(max);
  slider.step = String(step);
  const up = document.createElement("button");
  up.type = "button";
  up.className = "icon-button";
  up.textContent = "+";
  up.setAttribute("aria-label", `Increase ${label}`);
  row.append(down, slider, up);

  wrap.append(top, row);
  if (hint) {
    const note = document.createElement("small");
    note.textContent = hint;
    wrap.appendChild(note);
  }

  const paint = () => {
    slider.value = String(current);
    if (document.activeElement !== readout) {
      readout.value = format ? format(current) : current.toFixed(decimals);
    }
  };
  const commit = (raw, notify = true) => {
    const next = clean(raw);
    if (next === current) { paint(); return; }
    current = next;
    paint();
    if (notify && onChange) onChange(current);
  };

  slider.addEventListener("input", () => commit(Number(slider.value)));
  down.addEventListener("click", () => commit(current - step));
  up.addEventListener("click", () => commit(current + step));
  readout.addEventListener("change", () => {
    const typed = Number.parseFloat(readout.value.replace(/[^0-9.-]/g, ""));
    commit(Number.isFinite(typed) ? typed : current);
  });
  readout.addEventListener("blur", paint);
  paint();

  return {
    element: wrap,
    get value() { return current; },
    set(next) { commit(next, false); },
  };
}
Studio.createStepper = createStepper;

/* Chip groups -------------------------------------------------------- */

function bindChips(container, attribute, onChange) {
  container.addEventListener("click", (event) => {
    const chip = event.target.closest(`[data-${attribute}]`);
    if (!chip) return;
    for (const other of container.querySelectorAll(`[data-${attribute}]`)) {
      const active = other === chip;
      other.classList.toggle("active", active);
      other.setAttribute("aria-pressed", String(active));
    }
    onChange(chip.dataset[attribute.replace(/-([a-z])/g, (_, c) => c.toUpperCase())]);
  });
}
Studio.bindChips = bindChips;

/* Read-only text sheet, used for the favourites export. --------------- */

function showText(title, text) {
  el("text-sheet-title").textContent = title;
  el("text-sheet-body").textContent = text;
  openSheet("text-sheet");
}
Studio.showText = showText;

el("option-close").addEventListener("click", closeSheet);
el("text-sheet-close").addEventListener("click", closeSheet);
el("text-sheet-copy").addEventListener("click", async () => {
  const button = el("text-sheet-copy");
  try {
    await navigator.clipboard.writeText(el("text-sheet-body").textContent);
    button.textContent = "Copied";
  } catch {
    button.textContent = "Select it";
  }
  setTimeout(() => { button.textContent = "Copy"; }, 1600);
});

try {
  const saved = localStorage.getItem(TAB_KEY);
  if (saved && el(`${saved}-studio`)) activateTab(saved);
} catch { /* private mode */ }
