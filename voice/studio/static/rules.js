// Rules tab. Edits the pronunciation lexicon and per-voice pacing that the
// CLIde voice service actually uses. Nothing is stored here; the shim owns it.

const rulesEl = (id) => document.getElementById(id);
const MODE_HELP = {
  word: "whole word, any case",
  phrase: "this exact run of words",
  before: "only when followed by one of these words",
};
let rulesState = { pronunciations: [], voices: {}, editable_fields: {} };

function rulesStatus(message, kind = "") {
  const status = rulesEl("rules-status");
  status.textContent = message;
  status.className = `status ${kind}`;
}

function renderPronunciations() {
  const host = rulesEl("rules-list");
  host.innerHTML = "";
  if (!rulesState.pronunciations.length) {
    host.innerHTML = '<p class="muted">No rules. Add one, or delete the file to restore defaults.</p>';
    return;
  }
  rulesState.pronunciations.forEach((rule, index) => {
    const card = document.createElement("article");
    card.className = "take-card";

    const row = document.createElement("div");
    row.className = "take-heading";
    const title = document.createElement("span");
    title.className = "take-number";
    title.textContent = `${index + 1}`;
    const remove = document.createElement("button");
    remove.className = "remove";
    remove.type = "button";
    remove.setAttribute("aria-label", `Remove rule ${index + 1}`);
    remove.textContent = "×";
    remove.addEventListener("click", () => {
      rulesState.pronunciations.splice(index, 1);
      renderPronunciations();
      rulesStatus("Removed — not saved yet.", "");
    });
    row.append(title, remove);

    const field = (label, value, onInput, placeholder = "") => {
      const wrap = document.createElement("label");
      wrap.className = "field field-wide";
      const span = document.createElement("span");
      span.textContent = label;
      const input = document.createElement("input");
      input.type = "text";
      input.value = value || "";
      input.placeholder = placeholder;
      input.addEventListener("input", (event) => onInput(event.target.value));
      wrap.append(span, input);
      return wrap;
    };

    const mode = document.createElement("label");
    mode.className = "field field-wide";
    const modeSpan = document.createElement("span");
    modeSpan.textContent = "Match";
    const select = document.createElement("select");
    for (const name of Object.keys(MODE_HELP)) {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = `${name} — ${MODE_HELP[name]}`;
      option.selected = (rule.mode || "word") === name;
      select.appendChild(option);
    }
    select.addEventListener("change", (event) => {
      rule.mode = event.target.value;
      renderPronunciations();
    });
    mode.append(modeSpan, select);

    card.append(
      row,
      field("When you write", rule.match, (value) => { rule.match = value; }, "URL"),
      field("Say it as", rule.say, (value) => { rule.say = value; }, "U R L"),
      mode,
    );
    if (rule.mode === "before") {
      card.appendChild(field(
        "Followed by (comma separated)",
        (rule.followed_by || []).join(", "),
        (value) => {
          rule.followed_by = value.split(",").map((w) => w.trim()).filter(Boolean);
        },
        "in, at, on, here",
      ));
    }
    card.appendChild(field("Why (note to yourself)", rule.note, (value) => { rule.note = value; }));
    host.appendChild(card);
  });
}

function renderPacing() {
  const host = rulesEl("pacing-list");
  host.innerHTML = "";
  for (const [voiceId, voice] of Object.entries(rulesState.voices)) {
    const block = document.createElement("details");
    block.className = "settings-block";
    if (voice.overridden && voice.overridden.length) block.open = true;
    const summary = document.createElement("summary");
    summary.innerHTML =
      `<span><strong>${voiceId}</strong><small>${
        voice.overridden && voice.overridden.length ? "edited" : voice.model
      }</small></span>`;
    block.appendChild(summary);

    const slider = (label, key, step, unit) => {
      const bounds = rulesState.editable_fields[key] || { min: 0, max: 2 };
      const wrap = document.createElement("label");
      wrap.className = "slider";
      const span = document.createElement("span");
      const output = document.createElement("output");
      output.textContent = unit === "ms"
        ? `${Math.round(voice[key] * 1000)} ms`
        : Number(voice[key]).toFixed(2);
      span.append(`${label} `, output);
      const input = document.createElement("input");
      input.type = "range";
      input.min = bounds.min;
      input.max = bounds.max;
      input.step = step;
      input.value = voice[key];
      input.addEventListener("input", (event) => {
        voice[key] = Number(event.target.value);
        output.textContent = unit === "ms"
          ? `${Math.round(voice[key] * 1000)} ms`
          : voice[key].toFixed(2);
      });
      wrap.append(span, input);
      return wrap;
    };

    const separator = document.createElement("label");
    separator.className = "field field-wide";
    const sepSpan = document.createElement("span");
    sepSpan.textContent = 'Word spoken for "/"';
    const sepInput = document.createElement("input");
    sepInput.type = "text";
    sepInput.value = voice.path_separator;
    sepInput.addEventListener("input", (event) => {
      voice.path_separator = event.target.value;
    });
    separator.append(sepSpan, sepInput);

    block.append(
      slider("Speed (higher is slower)", "length_scale", 0.05, ""),
      slider("Sentence pause", "sentence_silence_seconds", 0.025, "ms"),
      slider("Structure pause", "structure_silence_seconds", 0.025, "ms"),
      separator,
    );
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
  rulesStatus("Saving…");
  rulesEl("rules-save").disabled = true;
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
    rulesStatus("Saved. Go to Speech and press Speak — no restart needed.", "ok");
  } catch (error) {
    rulesStatus(error.message, "error");
  } finally {
    rulesEl("rules-save").disabled = false;
  }
}

rulesEl("rules-add").addEventListener("click", () => {
  rulesState.pronunciations.push({ match: "", say: "", mode: "word", note: "" });
  renderPronunciations();
  rulesStatus("New rule added — fill it in and save.", "");
});
rulesEl("rules-reset").addEventListener("click", loadRules);
rulesEl("rules-save").addEventListener("click", saveRules);
loadRules();
