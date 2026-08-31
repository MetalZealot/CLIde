// Rules tab. Edits the pronunciation lexicon and per-voice pacing that the
// CLIde voice service actually uses. Nothing is stored here; the shim owns it.

const MODE_HELP = {
  word: "whole word, any case",
  phrase: "this exact run of words",
  before: "only when followed by one of these words",
  unless: "every time except after one of these words",
};
let rulesState = { pronunciations: [], voices: {}, editable_fields: {} };

function rulesStatus(message, kind = "") {
  const status = el("rules-status");
  status.textContent = message;
  status.className = `status ${kind}`;
}

function textField(label, value, onInput, placeholder = "") {
  const wrap = document.createElement("label");
  wrap.className = "field";
  const span = document.createElement("span");
  span.textContent = label;
  const input = document.createElement("input");
  input.type = "text";
  input.value = value || "";
  input.placeholder = placeholder;
  input.addEventListener("input", (event) => onInput(event.target.value));
  wrap.append(span, input);
  return wrap;
}

function modeField(rule, index) {
  const wrap = document.createElement("div");
  wrap.className = "field";
  const span = document.createElement("span");
  span.textContent = "Match";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "picker-button";
  const value = document.createElement("span");
  value.className = "picker-value";
  const strong = document.createElement("strong");
  const small = document.createElement("small");
  value.append(strong, small);
  button.appendChild(value);
  const paint = () => {
    const mode = rule.mode || "word";
    strong.textContent = mode;
    small.textContent = MODE_HELP[mode];
  };
  button.addEventListener("click", async () => {
    const chosen = await Studio.chooseOption({
      title: "Match mode",
      options: Object.entries(MODE_HELP).map(([mode, detail]) => ({ value: mode, label: mode, detail })),
      value: rule.mode || "word",
    });
    if (chosen === null) return;
    rule.mode = chosen;
    renderPronunciations({ openIndex: index });
  });
  paint();
  wrap.append(span, button);
  return wrap;
}

function renderPronunciations({ openIndex = null, focusIndex = null } = {}) {
  const host = el("rules-list");
  host.replaceChildren();
  if (!rulesState.pronunciations.length) {
    host.innerHTML = '<p class="muted" style="font-size:0.8rem">No rules yet. Add one.</p>';
    return;
  }
  rulesState.pronunciations.forEach((rule, index) => {
    const card = document.createElement("details");
    card.className = "disclosure rule-card";
    card.dataset.ruleIndex = String(index);
    card.open = index === openIndex;

    const summary = document.createElement("summary");
    const number = document.createElement("span");
    number.className = "rule-number";
    number.textContent = String(index + 1).padStart(2, "0");
    const summaryText = document.createElement("span");
    summaryText.className = "rule-summary-text";
    const summaryTitle = document.createElement("strong");
    const summaryMode = document.createElement("small");
    summaryText.append(summaryTitle, summaryMode);
    summary.append(number, summaryText);

    const refreshSummary = () => {
      summaryTitle.textContent = `${rule.match || "New rule"} → ${rule.say || "not set"}`;
      summaryMode.textContent = rule.mode || "word";
    };
    refreshSummary();

    const body = document.createElement("div");
    body.className = "disclosure-body rule-body";
    const matchField = textField("When you write", rule.match, (value) => {
      rule.match = value;
      refreshSummary();
    }, "URL");
    matchField.querySelector("input").dataset.rulePrimary = "true";
    body.append(
      matchField,
      textField("Say it as", rule.say, (value) => {
        rule.say = value;
        refreshSummary();
      }, "U R L"),
      modeField(rule, index),
    );
    if (rule.mode === "before") {
      body.appendChild(textField(
        "Followed by (comma separated)",
        (rule.followed_by || []).join(", "),
        (value) => { rule.followed_by = value.split(",").map((word) => word.trim()).filter(Boolean); },
        "in, at, on, here",
      ));
    }
    if (rule.mode === "unless") {
      body.appendChild(textField(
        "Except after (comma separated)",
        (rule.preceded_by || []).join(", "),
        (value) => { rule.preceded_by = value.split(",").map((word) => word.trim()).filter(Boolean); },
        "I, you, we, they, a, an",
      ));
    }
    body.appendChild(textField("Why (note to yourself)", rule.note, (value) => { rule.note = value; }));

    const remove = document.createElement("button");
    remove.className = "ghost rule-remove";
    remove.type = "button";
    remove.setAttribute("aria-label", `Remove rule ${index + 1}`);
    remove.textContent = "Remove rule";
    remove.addEventListener("click", () => {
      rulesState.pronunciations.splice(index, 1);
      renderPronunciations();
      rulesStatus("Removed — not saved yet.");
    });
    body.appendChild(remove);
    card.append(summary, body);
    host.appendChild(card);
  });

  if (focusIndex !== null) {
    window.requestAnimationFrame(() => {
      const card = host.querySelector(`[data-rule-index="${focusIndex}"]`);
      card?.scrollIntoView({ behavior: "smooth", block: "start" });
      window.requestAnimationFrame(() => {
        card?.querySelector("[data-rule-primary]")?.focus({ preventScroll: true });
      });
    });
  }
}

function pacingStepper(voice, key, label, unit) {
  const bounds = rulesState.editable_fields[key] || { min: 0, max: 2 };
  if (unit === "ms") {
    return Studio.createStepper({
      label,
      min: Math.round(bounds.min * 1000),
      max: Math.round(bounds.max * 1000),
      step: 5,
      value: Math.round(voice[key] * 1000),
      format: (value) => `${value} ms`,
      onChange: (value) => { voice[key] = value / 1000; },
    }).element;
  }
  return Studio.createStepper({
    label,
    min: bounds.min,
    max: bounds.max,
    step: 0.01,
    value: voice[key],
    format: (value) => value.toFixed(2),
    onChange: (value) => { voice[key] = value; },
  }).element;
}

function renderPacing() {
  const host = el("pacing-list");
  host.replaceChildren();
  for (const [voiceId, voice] of Object.entries(rulesState.voices)) {
    const block = document.createElement("details");
    block.className = "disclosure";
    const summary = document.createElement("summary");
    const label = document.createElement("span");
    const strong = document.createElement("strong");
    strong.textContent = voice.label || voiceId;
    const small = document.createElement("small");
    const details = [voice.gender, voice.tier, voice.locale, voice.model].filter(Boolean).join(" · ");
    small.textContent = voice.overridden?.length ? ` edited · ${details}` : ` ${details}`;
    label.append(strong, small);
    summary.appendChild(label);

    const body = document.createElement("div");
    body.className = "disclosure-body";
    const separator = textField('Word spoken for "/"', voice.path_separator, (value) => {
      voice.path_separator = value;
    });
    body.append(
      pacingStepper(voice, "length_scale", "Speed (higher is slower)", ""),
      pacingStepper(voice, "sentence_silence_seconds", "Sentence pause", "ms"),
      pacingStepper(voice, "structure_silence_seconds", "Structure pause", "ms"),
      separator,
    );
    block.append(summary, body);
    host.appendChild(block);
  }
}

function applyRules(data) {
  rulesState = data;
  renderPronunciations();
  renderPacing();
}

async function loadRules() {
  try {
    const response = await fetch("/api/clide/rules");
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not load the rules");
    applyRules(data);
    rulesStatus(`${data.pronunciations.length} pronunciation rules loaded.`, "ok");
  } catch (error) {
    rulesStatus(error.message, "error");
  }
}

async function saveRules() {
  rulesStatus("Saving…", "working");
  el("rules-save").disabled = true;
  try {
    const voices = {};
    for (const [voiceId, voice] of Object.entries(rulesState.voices)) {
      voices[voiceId] = {
        length_scale: voice.length_scale,
        sentence_silence_seconds: voice.sentence_silence_seconds,
        structure_silence_seconds: voice.structure_silence_seconds,
        path_separator: voice.path_separator,
      };
    }
    const response = await fetch("/api/clide/rules", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pronunciations: rulesState.pronunciations, voices }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Save failed");
    applyRules(data);
    rulesStatus("Saved. Go to Speak and press Speak it — no restart needed.", "ok");
  } catch (error) {
    rulesStatus(error.message, "error");
  } finally {
    el("rules-save").disabled = false;
  }
}

el("rules-add").addEventListener("click", () => {
  rulesState.pronunciations.unshift({ match: "", say: "", mode: "word", note: "" });
  renderPronunciations({ openIndex: 0, focusIndex: 0 });
  rulesStatus("New rule added — fill it in and save.");
});
el("rules-reset").addEventListener("click", loadRules);
el("rules-save").addEventListener("click", saveRules);
loadRules();
