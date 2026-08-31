// The voice catalogue, the labels kept about it, and the picker that makes
// 1,800 voices navigable on a phone. Labels live on the Pi, not in the
// browser: the point of auditioning is a list that survives the tab closing.

const SELECTION_KEY = "voice-studio-selection";
const PAGE_SIZE = 60;

const Voices = {
  models: [],
  presets: [],
  defaultPreset: "",
  labels: {},
  current: null,
  speed: null,
};
window.Voices = Voices;

const selectionListeners = [];
Voices.onChange = (callback) => selectionListeners.push(callback);

const keyFor = (model, speakerId) =>
  speakerId === null || speakerId === undefined ? model : `${model}#${speakerId}`;
Voices.keyFor = keyFor;

const modelById = (id) => Voices.models.find((model) => model.id === id);

function normalizePreset(value) {
  if (typeof value === "string") {
    return { id: value, label: value, gender: "", tier: "", locale: "" };
  }
  if (!value || typeof value !== "object" || typeof value.id !== "string") return null;
  return {
    id: value.id,
    label: typeof value.label === "string" && value.label ? value.label : value.id,
    gender: typeof value.gender === "string" ? value.gender : "",
    tier: typeof value.tier === "string" ? value.tier : "",
    locale: typeof value.locale === "string" ? value.locale : "",
  };
}

const presetById = (id) => Voices.presets.find((preset) => preset.id === id);

function presetDetails(preset, { includeRole = true } = {}) {
  if (!preset) return includeRole ? "CLIde preset" : "";
  const details = [
    preset.gender ? `${preset.gender[0].toUpperCase()}${preset.gender.slice(1)}` : "",
    preset.tier,
    preset.locale,
  ].filter(Boolean);
  if (includeRole) details.push("CLIde preset");
  return details.join(" · ");
}

// Piper's own metadata, tidied only where two spellings mean one thing:
// "en-us" and "en_US" are the same voice pool, and the jane-eyre model spells
// British English out in full. Anything else is reported as the model declares
// it rather than guessed at.
const LANGUAGE_ALIASES = { englishbritish: "en-gb" };
const REAL_QUALITIES = ["x_low", "low", "medium", "high"];

function languageOf(model) {
  const raw = String(model.language || "").toLowerCase().replace(/_/g, "-");
  return LANGUAGE_ALIASES[raw] || raw || "unknown";
}

function languageLabel(code) {
  const [language, region] = code.split("-");
  return region ? `${language}-${region.toUpperCase()}` : language;
}

const qualityOf = (model) =>
  REAL_QUALITIES.includes(model.quality) ? model.quality : "other";

// Only facets that some installed model actually has, so adding a model adds
// its chip and nothing offers an empty result.
function facetCounts(pick) {
  const counts = new Map();
  for (const model of Voices.models) {
    const value = pick(model);
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return counts;
}

function qualityChips() {
  const counts = facetCounts(qualityOf);
  return [...REAL_QUALITIES, "other"]
    .filter((quality) => counts.has(quality))
    .map((quality) => [quality, quality, counts.get(quality)]);
}

function languageChips() {
  const counts = facetCounts(languageOf);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([code, count]) => [code, languageLabel(code), count]);
}
const labelFor = (key) => Voices.labels[key] || {};
Voices.label = labelFor;

// Only the locale prefix is dropped: two models can share a name and differ
// only in quality, so "jarvis-high" has to stay distinguishable from "-medium".
const shortName = (modelId) => modelId.replace(/^[a-z]{2}_[A-Z]{2}-/, "");

function speakerName(model, speakerId) {
  return model?.speakers?.[speakerId] || "";
}

function describe(selection) {
  if (!selection) return { name: "Loading…", detail: "" };
  if (selection.type === "preset") {
    const preset = presetById(selection.id);
    const role = selection.id === Voices.defaultPreset ? "default" : "preset";
    return {
      name: preset?.label || selection.id,
      detail: [presetDetails(preset, { includeRole: false }), `CLIde ${role}`].filter(Boolean).join(" · "),
    };
  }
  const model = modelById(selection.model);
  const named = speakerName(model, selection.speakerId);
  const pieces = [selection.model];
  if (model?.num_speakers > 1) {
    pieces.push(named ? `speaker ${selection.speakerId} · ${named}` : `speaker ${selection.speakerId}`);
  }
  if (model?.quality) pieces.push(model.quality);
  if (model?.verdict) pieces.push(model.verdict);
  return {
    name: model?.num_speakers > 1
      ? `${shortName(selection.model)} · ${named || selection.speakerId}`
      : shortName(selection.model),
    detail: pieces.join(" · "),
  };
}
Voices.describe = describe;

Voices.currentKey = () =>
  Voices.current && Voices.current.type === "model"
    ? keyFor(Voices.current.model, modelById(Voices.current.model)?.num_speakers > 1
        ? Voices.current.speakerId : null)
    : null;

/* Labels ------------------------------------------------------------- */

async function loadLabels() {
  try {
    const response = await fetch("/api/voices/labels");
    const data = await response.json();
    Voices.labels = data.voices || {};
  } catch {
    Voices.labels = {};
  }
}

async function saveLabel(key, patch) {
  const optimistic = { ...labelFor(key), ...patch };
  Voices.labels[key] = optimistic;
  try {
    const response = await fetch("/api/voices/labels", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, ...patch }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not save the label");
    if (data.entry) Voices.labels[key] = data.entry;
    else delete Voices.labels[key];
  } catch (error) {
    el("clide-status").textContent = error.message;
  }
  paintLabelRow();
  renderFavorites();
  updateTopbar();
}
Voices.saveLabel = saveLabel;

Voices.markHeard = (key, extra) => saveLabel(key, { heard: true, ...extra });

/* Selection ---------------------------------------------------------- */

function setSelection(selection, { remember = true } = {}) {
  Voices.current = selection;
  if (remember) {
    try { localStorage.setItem(SELECTION_KEY, JSON.stringify(selection)); } catch { /* private */ }
  }
  paintSelection();
  for (const listener of selectionListeners) listener(selection);
}
Voices.setSelection = setSelection;

function paintSelection() {
  const selection = Voices.current;
  const { name, detail } = describe(selection);
  el("voice-name").textContent = name;
  el("voice-detail").textContent = detail;

  const model = selection?.type === "model" ? modelById(selection.model) : null;
  const multi = Boolean(model && model.num_speakers > 1);
  el("speaker-nav").hidden = !multi;
  if (multi) {
    const named = speakerName(model, selection.speakerId);
    el("speaker-jump").textContent = named
      ? `${named} · ${selection.speakerId + 1} of ${model.num_speakers}`
      : `Speaker ${selection.speakerId} · ${selection.speakerId + 1} of ${model.num_speakers}`;
    el("speaker-prev").disabled = selection.speakerId <= 0;
    el("speaker-next").disabled = selection.speakerId >= model.num_speakers - 1;
  }

  el("voice-sub").textContent = model ? "Audition — label it below" : "Preset · pacing in Rules";
  paintLabelRow();
}

function paintLabelRow() {
  const key = Voices.currentKey();
  const row = el("label-row");
  row.hidden = !key;
  if (!key) return;
  const entry = labelFor(key);
  el("label-target").textContent = describe(Voices.current).name;
  const favorite = el("voice-favorite");
  favorite.textContent = entry.favorite ? "★ Favorite" : "☆ Favorite";
  favorite.classList.toggle("active", Boolean(entry.favorite));
  favorite.setAttribute("aria-pressed", String(Boolean(entry.favorite)));
  for (const button of el("gender-seg").querySelectorAll("[data-gender]")) {
    button.setAttribute("aria-pressed", String(entry.gender === button.dataset.gender));
  }
}
Voices.paintLabelRow = paintLabelRow;

function updateTopbar() {
  const entries = Object.values(Voices.labels);
  const favorites = entries.filter((entry) => entry.favorite).length;
  const heard = entries.filter((entry) => entry.heard).length;
  el("topbar-sub").textContent =
    `${favorites} favorite${favorites === 1 ? "" : "s"} · ${heard} heard`;
  el("favorites-count").textContent = favorites
    ? `${favorites} kept`
    : "Nothing kept yet — star a voice on the Speak tab";
}

/* The picker sheet --------------------------------------------------- */

// quality and language persist across openings: a sweep is done one
// criterion at a time, and re-picking it every time is the tax.
const picker = {
  level: "models", model: null, filter: "all",
  quality: "", language: "", query: "", shown: PAGE_SIZE,
};

const MODEL_CHIPS = [
  ["all", "All"], ["favorite", "★ Kept"], ["male", "Male"],
  ["female", "Female"], ["neutral", "Neutral"], ["unlabelled", "Unlabeled"],
];
const SPEAKER_CHIPS = [
  ["all", "All"], ["favorite", "★ Kept"], ["male", "Male"],
  ["female", "Female"], ["unheard", "Unheard"], ["heard", "Heard"],
];

function chipButton(label, count, pressed, onClick) {
  const chip = document.createElement("button");
  chip.type = "button";
  chip.className = `chip${pressed ? " active" : ""}`;
  chip.setAttribute("aria-pressed", String(pressed));
  chip.textContent = label;
  if (count !== undefined) {
    const tally = document.createElement("small");
    tally.textContent = String(count);
    chip.appendChild(tally);
  }
  chip.addEventListener("click", () => {
    onClick();
    picker.shown = PAGE_SIZE;
    paintChips();
    renderPicker();
  });
  return chip;
}

function paintChips() {
  const host = el("voice-chips");
  host.replaceChildren();
  for (const [value, label] of picker.level === "models" ? MODEL_CHIPS : SPEAKER_CHIPS) {
    host.appendChild(chipButton(label, undefined, picker.filter === value, () => {
      picker.filter = value;
    }));
  }

  // Quality and language describe a model, so they mean nothing once you are
  // inside one looking at its speakers.
  const facets = el("voice-facets");
  facets.hidden = picker.level !== "models";
  facets.replaceChildren();
  if (facets.hidden) return;
  for (const [value, label, count] of qualityChips()) {
    facets.appendChild(chipButton(label, count, picker.quality === value, () => {
      picker.quality = picker.quality === value ? "" : value;
    }));
  }
  const divider = document.createElement("span");
  divider.className = "chip-divider";
  facets.appendChild(divider);
  for (const [value, label, count] of languageChips()) {
    facets.appendChild(chipButton(label, count, picker.language === value, () => {
      picker.language = picker.language === value ? "" : value;
    }));
  }
}

function matchesFacets(model) {
  if (!model) return false;
  if (picker.quality && qualityOf(model) !== picker.quality) return false;
  return !picker.language || languageOf(model) === picker.language;
}

const facetsActive = () => Boolean(picker.quality || picker.language);

function matchesLabel(entry, filter) {
  if (filter === "all") return true;
  if (filter === "favorite") return Boolean(entry.favorite);
  if (filter === "unlabelled") return !entry.gender;
  if (filter === "unheard") return !entry.heard;
  if (filter === "heard") return Boolean(entry.heard);
  return entry.gender === filter;
}

function voiceRow({ title, meta, key, selection, drill }) {
  const entry = key ? labelFor(key) : {};
  const row = document.createElement("button");
  row.type = "button";
  row.className = "vrow";
  if (key && key === Voices.currentKey()) row.classList.add("current");

  const main = document.createElement("div");
  main.className = "vrow-main";
  const strong = document.createElement("strong");
  strong.textContent = title;
  const metaRow = document.createElement("div");
  metaRow.className = "vrow-meta";
  if (meta) {
    const metaText = document.createElement("span");
    metaText.className = "vrow-meta-text";
    metaText.textContent = meta;
    metaRow.appendChild(metaText);
  }
  if (entry.gender) {
    const tag = document.createElement("span");
    tag.className = `vrow-tag ${entry.gender}`;
    tag.textContent = entry.gender;
    metaRow.appendChild(tag);
  }
  if (entry.heard && !entry.gender) {
    const tag = document.createElement("span");
    tag.className = "vrow-tag heard";
    tag.textContent = "heard";
    metaRow.appendChild(tag);
  }
  main.append(strong, metaRow);

  const mark = document.createElement("span");
  mark.className = drill ? "vrow-go" : "vrow-star";
  mark.textContent = drill ? "›" : entry.favorite ? "★" : "";
  row.append(main, mark);

  row.addEventListener("click", () => {
    if (drill) {
      picker.level = "speakers";
      picker.model = drill;
      picker.filter = "all";
      picker.query = "";
      picker.shown = PAGE_SIZE;
      el("voice-search").value = "";
      el("voice-sheet-back").hidden = false;
      paintChips();
      renderPicker();
      return;
    }
    setSelection(selection);
    Studio.closeSheet();
  });
  return row;
}

function pickerRows() {
  const query = picker.query.trim().toLowerCase();
  const rows = [];

  if (picker.level === "speakers") {
    const model = modelById(picker.model);
    for (let speakerId = 0; speakerId < model.num_speakers; speakerId += 1) {
      const named = speakerName(model, speakerId);
      const key = keyFor(model.id, speakerId);
      if (!matchesLabel(labelFor(key), picker.filter)) continue;
      const haystack = `${speakerId} ${named}`.toLowerCase();
      if (query && !haystack.includes(query)) continue;
      rows.push({
        group: null,
        node: () => voiceRow({
          title: named || `Speaker ${speakerId}`,
          // The row number is already in the title; the space is worth more to
          // the label tags, which are what a sweep of 904 reads.
          meta: named ? `#${speakerId}` : "",
          key,
          selection: { type: "model", model: model.id, speakerId },
        }),
      });
    }
    return rows;
  }

  if (picker.filter !== "all") {
    // A label belongs to a voice, not a model, so a filtered view is flat.
    for (const [key, entry] of Object.entries(Voices.labels)) {
      if (!matchesLabel(entry, picker.filter)) continue;
      const [modelId, speaker] = key.split("#");
      const model = modelById(modelId);
      if (!model || !matchesFacets(model)) continue;
      const speakerId = speaker === undefined ? null : Number(speaker);
      const named = speakerName(model, speakerId ?? 0);
      const title = speakerId === null
        ? shortName(modelId)
        : `${shortName(modelId)} · ${named || speakerId}`;
      if (query && !title.toLowerCase().includes(query)) continue;
      rows.push({
        group: "Labelled voices",
        node: () => voiceRow({
          title,
          meta: entry.notes ? entry.notes.slice(0, 48) : modelId,
          key,
          selection: { type: "model", model: modelId, speakerId: speakerId ?? 0 },
        }),
      });
    }
    return rows;
  }

  // A preset is a curated choice, not a catalogue entry, and the studio does
  // not hold the model behind it -- so a catalogue facet hides the group.
  for (const preset of facetsActive() ? [] : Voices.presets) {
    const haystack = [preset.id, preset.label, preset.gender, preset.tier, preset.locale]
      .join(" ").toLowerCase();
    if (query && !haystack.includes(query)) continue;
    rows.push({
      group: "CLIde presets",
      node: () => voiceRow({
        title: preset.label,
        meta: [
          preset.id,
          presetDetails(preset, { includeRole: false }),
          preset.id === Voices.defaultPreset ? "default" : "preset",
        ].filter(Boolean).join(" · "),
        key: null,
        selection: { type: "preset", id: preset.id },
      }),
    });
  }

  for (const model of Voices.models) {
    if (!matchesFacets(model)) continue;
    const haystack =
      `${model.id} ${model.dataset} ${model.region} ${model.quality} ${languageOf(model)}`.toLowerCase();
    if (query && !haystack.includes(query)) continue;
    const multi = model.num_speakers > 1;
    const meta = [
      languageLabel(languageOf(model)),
      qualityOf(model),
      multi ? `${model.num_speakers} speakers` : "single",
      model.verdict || "",
    ].filter(Boolean).join(" · ");
    rows.push({
      group: "Models",
      node: () => voiceRow({
        title: shortName(model.id),
        meta,
        key: multi ? null : model.id,
        selection: { type: "model", model: model.id, speakerId: 0 },
        drill: multi ? model.id : null,
      }),
    });
  }
  return rows;
}

function renderPicker() {
  const rows = pickerRows();
  const list = el("voice-list");
  list.replaceChildren();
  // A fresh list starts at the top; only "show more" keeps the scroll position.
  if (picker.shown === PAGE_SIZE) list.closest(".sheet-body").scrollTop = 0;
  // The chip strip scrolls, so an active facet can sit off-screen; this line
  // never does, and is the only place both filters are visible at once.
  const count = el("voice-count");
  count.replaceChildren();
  const active = [picker.quality, picker.language && languageLabel(picker.language)].filter(Boolean);
  count.append(picker.level === "speakers"
    ? `${shortName(picker.model)} · ${rows.length} of ${modelById(picker.model).num_speakers} speakers`
    : [`${rows.length} voices`, ...active].join(" · "));
  if (picker.level === "models" && active.length) {
    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "ghost";
    clear.textContent = "✕ clear";
    clear.addEventListener("click", () => {
      picker.quality = "";
      picker.language = "";
      picker.shown = PAGE_SIZE;
      paintChips();
      renderPicker();
    });
    count.appendChild(clear);
  }

  if (!rows.length) {
    const empty = document.createElement("p");
    empty.className = "list-empty";
    empty.textContent = "Nothing matches. Clear the search or the filter.";
    list.appendChild(empty);
    return;
  }

  let lastGroup = null;
  for (const row of rows.slice(0, picker.shown)) {
    if (row.group && row.group !== lastGroup) {
      const heading = document.createElement("p");
      heading.className = "group-label";
      heading.textContent = row.group;
      list.appendChild(heading);
      lastGroup = row.group;
    }
    list.appendChild(row.node());
  }
  if (rows.length > picker.shown) {
    const more = document.createElement("button");
    more.type = "button";
    more.className = "list-more";
    more.textContent = `Show ${Math.min(PAGE_SIZE, rows.length - picker.shown)} more of ${rows.length}`;
    more.addEventListener("click", () => { picker.shown += PAGE_SIZE; renderPicker(); });
    list.appendChild(more);
  }
}

function openPicker({ model = null } = {}) {
  picker.level = model ? "speakers" : "models";
  picker.model = model;
  picker.filter = "all";
  picker.query = "";
  picker.shown = PAGE_SIZE;
  el("voice-search").value = "";
  el("voice-sheet-back").hidden = !model;
  paintChips();
  renderPicker();
  Studio.openSheet("voice-sheet");
}
Voices.openPicker = openPicker;

el("voice-open").addEventListener("click", () => openPicker());
el("voice-sheet-close").addEventListener("click", () => Studio.closeSheet());
el("voice-sheet-back").addEventListener("click", () => {
  picker.level = "models";
  picker.model = null;
  picker.filter = "all";
  picker.query = "";
  picker.shown = PAGE_SIZE;
  el("voice-search").value = "";
  el("voice-sheet-back").hidden = true;
  paintChips();
  renderPicker();
});
el("voice-search").addEventListener("input", (event) => {
  picker.query = event.target.value;
  picker.shown = PAGE_SIZE;
  renderPicker();
});

/* Speaker navigation ------------------------------------------------- */

function stepSpeaker(delta) {
  const selection = Voices.current;
  if (selection?.type !== "model") return;
  const model = modelById(selection.model);
  const next = Math.min(model.num_speakers - 1, Math.max(0, selection.speakerId + delta));
  setSelection({ ...selection, speakerId: next, lengthScale: undefined });
}

el("speaker-prev").addEventListener("click", () => stepSpeaker(-1));
el("speaker-next").addEventListener("click", () => stepSpeaker(1));
el("speaker-jump").addEventListener("click", () => openPicker({ model: Voices.current.model }));

el("voice-random").addEventListener("click", () => {
  const selection = Voices.current;
  const model = selection?.type === "model" ? modelById(selection.model) : null;
  if (model && model.num_speakers > 1) {
    const unheard = [];
    for (let speakerId = 0; speakerId < model.num_speakers; speakerId += 1) {
      if (!labelFor(keyFor(model.id, speakerId)).heard) unheard.push(speakerId);
    }
    if (!unheard.length) return;
    setSelection({ type: "model", model: model.id, speakerId: unheard[Math.floor(Math.random() * unheard.length)] });
    return;
  }
  const unheard = Voices.models.filter((entry) => entry.num_speakers === 1 && !labelFor(entry.id).heard);
  if (!unheard.length) return;
  const pick = unheard[Math.floor(Math.random() * unheard.length)];
  setSelection({ type: "model", model: pick.id, speakerId: 0 });
});

/* Labelling ---------------------------------------------------------- */

el("voice-favorite").addEventListener("click", () => {
  const key = Voices.currentKey();
  if (!key) return;
  const selection = Voices.current;
  const model = modelById(selection.model);
  saveLabel(key, {
    favorite: !labelFor(key).favorite,
    model: selection.model,
    speaker_id: model?.num_speakers > 1 ? selection.speakerId : null,
    speaker_name: speakerName(model, selection.speakerId) || null,
    length_scale: Voices.speed ? Voices.speed.value : null,
  });
});

el("gender-seg").addEventListener("click", (event) => {
  const button = event.target.closest("[data-gender]");
  const key = Voices.currentKey();
  if (!button || !key) return;
  const same = labelFor(key).gender === button.dataset.gender;
  saveLabel(key, { gender: same ? "" : button.dataset.gender, model: Voices.current.model });
});

/* Favourites tab ----------------------------------------------------- */

let favoriteFilter = "all";
const noteTimers = new Map();

function favoriteMatches(entry) {
  if (favoriteFilter === "all") return true;
  if (favoriteFilter === "noted") return Boolean((entry.notes || "").trim());
  if (favoriteFilter === "unlabelled") return !entry.gender;
  return entry.gender === favoriteFilter;
}

function favoriteItem(key, entry) {
  const [modelId, speaker] = key.split("#");
  const speakerId = speaker === undefined ? null : Number(speaker);
  const model = modelById(modelId);
  const named = entry.speaker_name || speakerName(model, speakerId ?? 0);
  const item = document.createElement("article");
  item.className = "fav-item";

  const head = document.createElement("button");
  head.type = "button";
  head.className = "fav-head";
  const main = document.createElement("div");
  main.className = "vrow-main";
  const title = document.createElement("strong");
  title.textContent = speakerId === null
    ? shortName(modelId)
    : `${shortName(modelId)} · ${named || speakerId}`;
  const meta = document.createElement("div");
  meta.className = "vrow-meta vrow-meta-text";
  meta.textContent = [
    modelId,
    speakerId === null ? null : `speaker ${speakerId}`,
    entry.length_scale ? `speed ${Number(entry.length_scale).toFixed(2)}` : null,
  ].filter(Boolean).join(" · ");
  main.append(title, meta);
  if (entry.notes) {
    const preview = document.createElement("div");
    preview.className = "notes-preview";
    preview.textContent = entry.notes;
    main.appendChild(preview);
  }
  const tag = document.createElement("span");
  tag.className = `vrow-tag ${entry.gender || "heard"}`;
  tag.textContent = entry.gender || "—";
  head.append(main, tag);

  const body = document.createElement("div");
  body.className = "fav-body";
  body.hidden = true;

  const notes = document.createElement("textarea");
  notes.placeholder = "Notes — where it works, where it fails, what it reminds you of";
  notes.maxLength = 2000;
  notes.value = entry.notes || "";
  notes.addEventListener("input", () => {
    clearTimeout(noteTimers.get(key));
    noteTimers.set(key, setTimeout(() => saveLabel(key, { notes: notes.value }), 700));
  });

  const actions = document.createElement("div");
  actions.className = "button-row";
  const load = document.createElement("button");
  load.type = "button";
  load.className = "secondary";
  load.style.flex = "1";
  load.textContent = "Open in Speak";
  load.addEventListener("click", () => {
    setSelection({
      type: "model",
      model: modelId,
      speakerId: speakerId ?? 0,
      lengthScale: entry.length_scale || undefined,
    });
    Studio.activateTab("speak");
  });
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "secondary";
  remove.textContent = "Unfavorite";
  remove.addEventListener("click", () => saveLabel(key, { favorite: false }));
  actions.append(load, remove);

  body.append(notes, actions);
  head.addEventListener("click", () => {
    body.hidden = !body.hidden;
    if (body.hidden) return;
    notes.focus();
    notes.scrollIntoView({ block: "center", behavior: "smooth" });
  });
  item.append(head, body);
  return item;
}

function renderFavorites() {
  const host = el("favorites-list");
  if (!host) return;
  const favorites = Object.entries(Voices.labels)
    .filter(([, entry]) => entry.favorite && favoriteMatches(entry))
    .sort(([keyA, a], [keyB, b]) =>
      (a.gender || "zz").localeCompare(b.gender || "zz") || keyA.localeCompare(keyB));

  host.replaceChildren();
  if (!favorites.length) {
    const empty = document.createElement("p");
    empty.className = "list-empty";
    empty.textContent = "Nothing kept here yet. Star a voice on the Speak tab.";
    host.appendChild(empty);
    return;
  }
  let lastGender = null;
  for (const [key, entry] of favorites) {
    const gender = entry.gender || "unlabelled";
    if (gender !== lastGender) {
      const heading = document.createElement("p");
      heading.className = "group-label";
      heading.textContent = gender === "unlabelled" ? "no gender" : gender;
      host.appendChild(heading);
      lastGender = gender;
    }
    host.appendChild(favoriteItem(key, entry));
  }
}
Voices.renderFavorites = renderFavorites;

Studio.bindChips(el("favorites-filters"), "favorite-filter", (value) => {
  favoriteFilter = value;
  renderFavorites();
});

el("favorites-export").addEventListener("click", async () => {
  try {
    const response = await fetch("/api/voices/export");
    const data = await response.json();
    Studio.showText(`${data.count} favorite${data.count === 1 ? "" : "s"}`, data.text);
  } catch (error) {
    Studio.showText("Export failed", String(error));
  }
});

/* Boot --------------------------------------------------------------- */

Voices.ready = (async () => {
  const [presetResponse, modelResponse] = await Promise.all([
    fetch("/api/clide/voices"),
    fetch("/api/clide/models"),
  ]);
  const presetData = await presetResponse.json();
  const modelData = await modelResponse.json();
  if (!presetResponse.ok) throw new Error(presetData.error || "The voice service is unreachable");
  Voices.presets = (presetData.voices || []).map(normalizePreset).filter(Boolean);
  const requestedDefault = typeof presetData.default_voice === "string"
    ? presetData.default_voice : "";
  Voices.defaultPreset = presetById(requestedDefault)?.id || Voices.presets[0]?.id || "";
  Voices.models = modelResponse.ok ? modelData.models || [] : [];
  await loadLabels();

  let restored = null;
  try { restored = JSON.parse(localStorage.getItem(SELECTION_KEY) || "null"); } catch { /* private */ }
  const valid = restored && (restored.type === "preset"
    ? Boolean(presetById(restored.id))
    : Boolean(modelById(restored.model)));
  setSelection(valid ? restored : { type: "preset", id: Voices.defaultPreset }, { remember: false });
  updateTopbar();
  renderFavorites();
})().catch((error) => {
  el("voice-name").textContent = "Voice service unreachable";
  el("voice-detail").textContent = error.message;
});
