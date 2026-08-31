// Speak tab. Every request uses the running CLIde voice service, so saved
// pronunciation rules still apply while render settings remain audition-only.

let clideAudioUrl = null;
let corpusCases = [];
let speechRules = { voices: {} };
let speechSettingsIdentity = "";
let speechSettingsPreset = "Voice defaults";
let speechPathSeparator = "slash";
const speechControls = {};

const LIBRITTS_NATURAL = {
  length_scale: 1.30,
  noise_scale: 0.333,
  noise_w_scale: 0.30,
  volume: 1.00,
  normalize_audio: true,
  sentence_silence_seconds: 0.20,
  structure_silence_seconds: 0.20,
};

const SETTING_SPECS = [
  ["length_scale", "Speed", "Higher is slower.", 0.35, 2.5, 0.01, (value) => `${value.toFixed(2)}×`],
  ["sentence_silence_seconds", "Sentence gap", "Frame-safe silence between sentences.", 0, 1.5, 0.05, (value) => `${Math.round(value * 1000)} ms`],
  ["structure_silence_seconds", "Structure gap", "After headings, lists, tables, and paragraphs.", 0, 2, 0.05, (value) => `${Math.round(value * 1000)} ms`],
  ["noise_scale", "Generator noise", "Variation in the generated voice.", 0, 2, 0.001, (value) => value.toFixed(3)],
  ["noise_w_scale", "Phoneme width", "Variation in phoneme timing.", 0, 2, 0.01, (value) => value.toFixed(2)],
  ["volume", "Volume", "Applied during synthesis, before playback.", 0.1, 2, 0.05, (value) => `${value.toFixed(2)}×`],
];

function clideStatus(message, kind = "") {
  const status = el("clide-status");
  status.textContent = message;
  status.className = `status ${kind}`;
}

function selectionIdentity(selection) {
  if (!selection) return "";
  return selection.type === "preset" ? `preset:${selection.id}` : `model:${selection.model}`;
}

function selectedModel(selection = Voices.current) {
  if (!selection) return null;
  const modelId = selection.type === "preset"
    ? speechRules.voices?.[selection.id]?.model
    : selection.model;
  return Voices.models.find((model) => model.id === modelId) || null;
}

function voiceDefaults(selection = Voices.current) {
  const model = selectedModel(selection) || {};
  return {
    length_scale: Number(model.length_scale ?? 1),
    noise_scale: Number(model.noise_scale ?? 0.667),
    noise_w_scale: Number(model.noise_w_scale ?? 0.8),
    normalize_audio: Boolean(model.normalize_audio ?? true),
    volume: Number(model.volume ?? 1),
    sentence_silence_seconds: 0,
    structure_silence_seconds: 0,
  };
}

function currentClideSettings(selection = Voices.current) {
  if (selection?.type !== "preset") return voiceDefaults(selection);
  return { ...voiceDefaults(selection), ...(speechRules.voices?.[selection.id] || {}) };
}

function currentSettings() {
  return {
    ...Object.fromEntries(
      SETTING_SPECS.map(([key]) => [key, speechControls[key].value]),
    ),
    normalize_audio: el("speak-normalize").checked,
  };
}

function paintSettingsPreset() {
  const button = el("speak-preset");
  button.querySelector("strong").textContent = speechSettingsPreset;
  button.querySelector("small").textContent = "Audition only";
  const settings = currentSettings();
  el("speak-advanced-summary").textContent =
    `${speechSettingsPreset} · ${settings.length_scale.toFixed(2)}× · ` +
    `${Math.round(settings.sentence_silence_seconds * 1000)}/` +
    `${Math.round(settings.structure_silence_seconds * 1000)} ms`;
}

function markSettingsCustom() {
  speechSettingsPreset = "Custom audition";
  paintSettingsPreset();
}

function applySettings(name, settings) {
  const complete = { ...voiceDefaults(), ...settings };
  for (const [key] of SETTING_SPECS) speechControls[key].set(Number(complete[key]));
  el("speak-normalize").checked = Boolean(complete.normalize_audio);
  speechSettingsPreset = name;
  paintSettingsPreset();
}

function createSpeechControls() {
  const host = el("speak-settings");
  for (const [key, label, hint, min, max, step, format] of SETTING_SPECS) {
    const control = Studio.createStepper({
      label, hint, min, max, step, value: voiceDefaults()[key], format,
      onChange: markSettingsCustom,
    });
    speechControls[key] = control;
    host.appendChild(control.element);
  }
  Voices.speed = speechControls.length_scale;
  el("speak-normalize").addEventListener("change", markSettingsCustom);
}

function loadSelectionSettings(selection) {
  const identity = selectionIdentity(selection);
  if (!identity || identity === speechSettingsIdentity) return;
  speechSettingsIdentity = identity;
  if (selection.type === "preset") {
    const live = speechRules.voices?.[selection.id] || {};
    speechPathSeparator = live.path_separator || "slash";
    applySettings("Current CLIde settings", currentClideSettings(selection));
  } else {
    speechPathSeparator = "slash";
    applySettings("Voice defaults", voiceDefaults(selection));
  }
  window.Recordings?.clearPending();
}

async function chooseSynthesisPreset() {
  const options = [];
  if (Voices.current?.type === "preset") {
    options.push({
      value: "clide",
      label: "Current CLIde settings",
      detail: "Live saved pacing for this catalog voice",
    });
  }
  options.push(
    { value: "defaults", label: "Voice defaults", detail: "Values from the selected model" },
    {
      value: "libritts-natural",
      label: "LibriTTS-R Natural",
      detail: "Historic 1.30 / 0.333 / 0.30 preset",
    },
  );
  const chosen = await Studio.chooseOption({ title: "Load synthesis preset", options, value: "" });
  if (chosen === "clide") applySettings("Current CLIde settings", currentClideSettings());
  if (chosen === "defaults") applySettings("Voice defaults", voiceDefaults());
  if (chosen === "libritts-natural") applySettings("LibriTTS-R Natural", LIBRITTS_NATURAL);
}

function renderPauses(pauses, sentences) {
  const host = el("clide-pauses");
  host.replaceChildren();
  if (!pauses || !pauses.length) {
    el("pauses-summary").textContent = "none over 80 ms";
    host.innerHTML = '<p class="muted">No pauses over 80 ms — everything ran together.</p>';
    return;
  }
  const longest = Math.max(...pauses.map((pause) => pause.ms));
  el("pauses-summary").textContent =
    `${sentences ? `${sentences.length} sentences · ` : ""}${pauses.length} pauses · longest ${longest} ms`;
  for (const pause of pauses) {
    const row = document.createElement("div");
    row.className = "pause-row";
    const label = document.createElement("p");
    label.textContent = `${pause.at.toFixed(2)}s — ${pause.ms} ms`;
    const bar = document.createElement("div");
    bar.className = `pause-bar${pause.ms >= 450 ? " long" : ""}`;
    bar.style.width = `${Math.max(4, Math.round((pause.ms / longest) * 100))}%`;
    row.append(label, bar);
    host.appendChild(row);
  }
}

function playAudio(base64) {
  const audio = el("clide-audio");
  if (clideAudioUrl) URL.revokeObjectURL(clideAudioUrl);
  clideAudioUrl = audioUrl(base64);
  audio.src = clideAudioUrl;
  audio.hidden = false;
  audio.play().catch(() => { /* autoplay refused; the control is there */ });
}

function audioUrl(base64) {
  const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
  return URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
}

function speechRequestBody(speak) {
  const selection = Voices.current;
  const voice = Voices.describe(selection);
  return {
    text: el("clide-script").value,
    speak,
    voice: selection.type === "preset" ? selection.id : undefined,
    model: selection.type === "model" ? selection.model : undefined,
    speaker_id: selection.type === "model" ? selection.speakerId : undefined,
    voice_name: voice.name,
    settings_preset: speechSettingsPreset,
    path_separator: speechPathSeparator,
    ...currentSettings(),
  };
}

function setSpeechButtonsDisabled(disabled) {
  el("clide-speak").disabled = disabled;
  el("clide-prepare").disabled = disabled;
}

async function runClideSpeech(speak) {
  await speechSettingsReady;
  const text = el("clide-script").value;
  if (!text.trim()) {
    clideStatus("Enter some text first.", "error");
    return;
  }
  const selection = Voices.current;
  if (!selection) {
    clideStatus("Pick a voice first.", "error");
    return;
  }
  clideStatus(speak ? "Generating…" : "Preparing…", "working");
  setSpeechButtonsDisabled(true);
  if (speak) window.Recordings?.clearPending();

  try {
    const response = await fetch("/api/clide/audition", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(speechRequestBody(speak)),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Request failed");

    el("clide-prepared").textContent = data.prepared || "(nothing speakable)";
    el("clide-phonemes").textContent = (data.phonemes || []).join("\n") || "—";

    if (data.audio_base64) {
      playAudio(data.audio_base64);
      renderPauses(data.pauses, data.sentences);
      window.Recordings?.offer(data.recording_token, text);
      clideStatus(`${data.duration_seconds}s of audio in ${data.generation_seconds}s`, "ok");
      const key = Voices.currentKey();
      if (key) {
        Voices.markHeard(key, {
          model: selection.model,
          speaker_id: selection.speakerId ?? null,
          length_scale: currentSettings().length_scale,
        });
      }
    } else {
      el("clide-audio").hidden = true;
      renderPauses([], null);
      clideStatus(`Prepared — separator "${data.separator}".`, "ok");
    }
  } catch (error) {
    clideStatus(error.message, "error");
  } finally {
    setSpeechButtonsDisabled(false);
  }
}

async function loadCorpus() {
  try {
    const response = await fetch("/api/corpus");
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not read the corpus");
    corpusCases = data.cases;
  } catch (error) {
    clideStatus(error.message, "error");
  }
}

createSpeechControls();
el("speak-preset").addEventListener("click", chooseSynthesisPreset);
Voices.onChange(loadSelectionSettings);

const speechSettingsReady = Promise.all([
  Voices.ready,
  fetch("/api/clide/rules").then(async (response) => {
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not load CLIde settings");
    speechRules = data;
  }),
]).then(() => {
  speechSettingsIdentity = "";
  loadSelectionSettings(Voices.current);
}).catch((error) => {
  clideStatus(error.message, "error");
  loadSelectionSettings(Voices.current);
});

el("corpus-open").addEventListener("click", async () => {
  const chosen = await Studio.chooseOption({
    title: "Reference case",
    options: [
      { value: -1, label: "Free text", detail: "leave the script as it is" },
      ...corpusCases.map((testCase, index) => ({
        value: index,
        label: testCase.name,
        detail: testCase.listen_for,
      })),
    ],
    value: -1,
  });
  if (chosen === null) return;
  const testCase = corpusCases[chosen];
  const listenFor = el("clide-listen-for");
  if (!testCase) {
    el("corpus-name").textContent = "Free text";
    listenFor.hidden = true;
    return;
  }
  const script = el("clide-script");
  script.value = testCase.text;
  script.dispatchEvent(new Event("input"));
  el("corpus-name").textContent = testCase.name;
  listenFor.textContent = `Listen for: ${testCase.listen_for}`;
  listenFor.hidden = false;
  clideStatus(`Loaded "${testCase.name}". Press Speak it.`);
});

el("clide-speak").addEventListener("click", () => runClideSpeech(true));
el("clide-prepare").addEventListener("click", () => runClideSpeech(false));
el("clide-script").addEventListener("input", (event) => {
  el("clide-char-count").textContent = `${event.target.value.length.toLocaleString()} / 6,000`;
});
el("clide-script").dispatchEvent(new Event("input"));
loadCorpus();
