// CLIde speech tab. Everything here comes from the running voice service on
// 8890, so the audition cannot drift from what the app actually says.

const clideEl = (id) => document.getElementById(id);
let clideAudioUrl = null;
let corpusCases = [];
let auditionModels = [];

function clideStatus(message, kind = "") {
  const status = clideEl("clide-status");
  status.textContent = message;
  status.className = `status ${kind}`;
}

function renderPauses(pauses, sentences) {
  const host = clideEl("clide-pauses");
  host.innerHTML = "";
  if (!pauses || !pauses.length) {
    host.innerHTML = '<p class="muted">No pauses over 80 ms — everything ran together.</p>';
    return;
  }
  const longest = Math.max(...pauses.map((pause) => pause.ms));
  const summary = document.createElement("p");
  summary.className = "muted";
  summary.textContent =
    `${sentences ? `${sentences.length} sentences, ` : ""}` +
    `${pauses.length} pauses, longest ${longest} ms`;
  host.appendChild(summary);

  for (const pause of pauses) {
    const row = document.createElement("div");
    row.className = "take-card";
    const bar = document.createElement("div");
    bar.style.height = "6px";
    bar.style.borderRadius = "3px";
    bar.style.background = pause.ms >= 450 ? "#5eead4" : "#64748b";
    bar.style.width = `${Math.max(4, Math.round((pause.ms / longest) * 100))}%`;
    const label = document.createElement("p");
    label.className = "metrics";
    label.textContent = `${pause.at.toFixed(2)}s — ${pause.ms} ms`;
    row.append(label, bar);
    host.appendChild(row);
  }
}

async function loadClideVoices() {
  const select = clideEl("clide-voice");
  try {
    const response = await fetch("/api/clide/voices");
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not reach the voice service");
    select.innerHTML = "";
    const presets = document.createElement("optgroup");
    presets.label = "Shipped presets";
    for (const voice of data.voices) {
      const option = document.createElement("option");
      option.value = voice;
      option.textContent = voice === data.default_voice ? `${voice} (default)` : voice;
      option.selected = voice === data.default_voice;
      presets.appendChild(option);
    }
    select.appendChild(presets);
    await loadAuditionModels(select);
  } catch (error) {
    select.innerHTML = `<option>${error.message}</option>`;
    clideStatus(error.message, "error");
  }
}

async function runClideSpeech(speak) {
  const text = clideEl("clide-script").value;
  if (!text.trim()) {
    clideStatus("Enter some text first.", "error");
    return;
  }
  clideStatus(speak ? "Generating…" : "Preparing…");
  clideEl("clide-speak").disabled = true;
  clideEl("clide-prepare").disabled = true;
  try {
    // A "model:" selection is an audition: any installed model, rendered
    // through the same speech front end as the shipped presets.
    const choice = clideEl("clide-voice").value;
    const auditioning = choice.startsWith("model:") && speak;
    const response = auditioning
      ? await fetch("/api/clide/audition", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text,
            model: choice.slice(6),
            speaker_id: Number(clideEl("clide-speaker").value) || 0,
          }),
        })
      : await fetch("/api/clide/speech", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text,
            voice: choice.startsWith("model:") ? undefined : choice,
            speak,
          }),
        });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Request failed");

    clideEl("clide-prepared").textContent = data.prepared || "(nothing speakable)";
    clideEl("clide-phonemes").textContent = (data.phonemes || []).join("\n") || "—";

    const audio = clideEl("clide-audio");
    if (data.audio_base64) {
      if (clideAudioUrl) URL.revokeObjectURL(clideAudioUrl);
      const bytes = Uint8Array.from(atob(data.audio_base64), (c) => c.charCodeAt(0));
      clideAudioUrl = URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
      audio.src = clideAudioUrl;
      audio.hidden = false;
      renderPauses(data.pauses, data.sentences);
      clideStatus(
        `${data.duration_seconds}s of audio in ${data.generation_seconds}s · ${data.voice || data.model}`,
        "ok",
      );
    } else {
      audio.hidden = true;
      renderPauses([], null);
      clideStatus(`Prepared for ${data.voice || data.model} — separator "${data.separator}".`, "ok");
    }
  } catch (error) {
    clideStatus(error.message, "error");
  } finally {
    clideEl("clide-speak").disabled = false;
    clideEl("clide-prepare").disabled = false;
  }
}

// Every installed model, so a voice can be tried before it earns a preset.
// The verdict is the last word-drop sweep: PASS renders the probe words, DROPS
// swallows them. Advisory only -- a voice can pass and still sound wrong.
async function loadAuditionModels(select) {
  const response = await fetch("/api/clide/models");
  const data = await response.json();
  if (!response.ok) return;
  auditionModels = data.models;
  const group = document.createElement("optgroup");
  group.label = "All installed models (audition)";
  for (const model of data.models) {
    const option = document.createElement("option");
    option.value = `model:${model.id}`;
    option.textContent = model.verdict ? `${model.id} — ${model.verdict}` : model.id;
    group.appendChild(option);
  }
  select.appendChild(group);
}

function showSpeakerField() {
  const choice = clideEl("clide-voice").value;
  const field = clideEl("clide-speaker-field");
  const model = auditionModels.find((entry) => `model:${entry.id}` === choice);
  field.hidden = !model || model.num_speakers <= 1;
  if (!field.hidden) {
    clideEl("clide-speaker").max = String(model.num_speakers - 1);
  }
}

clideEl("clide-voice").addEventListener("change", showSpeakerField);

// The listening pass: one reference case per class of failure the speech front
// end fixes, loaded by name so a case can be replayed in seconds on a phone.
async function loadCorpus() {
  const select = clideEl("clide-corpus");
  try {
    const response = await fetch("/api/corpus");
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not read the corpus");
    corpusCases = data.cases;
    for (const [index, testCase] of corpusCases.entries()) {
      const option = document.createElement("option");
      option.value = String(index);
      option.textContent = testCase.name;
      select.appendChild(option);
    }
  } catch (error) {
    clideStatus(error.message, "error");
  }
}

clideEl("clide-corpus").addEventListener("change", (event) => {
  const listenFor = clideEl("clide-listen-for");
  const testCase = corpusCases[Number(event.target.value)];
  if (!testCase) {
    listenFor.hidden = true;
    return;
  }
  const script = clideEl("clide-script");
  script.value = testCase.text;
  script.dispatchEvent(new Event("input"));
  listenFor.textContent = testCase.listen_for;
  listenFor.hidden = false;
  clideStatus(`Loaded "${testCase.name}". Press Speak it.`);
});

clideEl("clide-speak").addEventListener("click", () => runClideSpeech(true));
clideEl("clide-prepare").addEventListener("click", () => runClideSpeech(false));
clideEl("clide-script").addEventListener("input", (event) => {
  clideEl("clide-char-count").textContent =
    `${event.target.value.length.toLocaleString()} / 6,000`;
});
loadClideVoices();
loadCorpus();
