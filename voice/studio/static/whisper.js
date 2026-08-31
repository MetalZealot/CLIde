// Dictation tab. Records or uploads audio and compares the two Whisper models
// on identical input; the settings exist so only one thing varies at a time.

let whisperRecorder;
let whisperStream;
let whisperStartedAt = 0;
let whisperTimerId;
let whisperRecordingCount = 0;
let whisperMode = "compare";
const whisperObjectUrls = new Set();

const DECODER_OPTIONS = [
  { value: "standard", label: "Standard", detail: "Whisper defaults" },
  { value: "careful", label: "Careful", detail: "larger search, slower" },
];
const THREAD_OPTIONS = [
  { value: "1", label: "1", detail: "one core" },
  { value: "2", label: "2", detail: "" },
  { value: "3", label: "3", detail: "" },
  { value: "4", label: "4", detail: "Pi default" },
];

function whisperStatus(message, kind = "") {
  const status = el("whisper-status");
  status.textContent = message;
  status.className = `status ${kind}`;
}

function whisperSyncStatus(message, kind = "") {
  const status = el("whisper-sync-status");
  status.textContent = message;
  status.className = `status ${kind}`;
}

function setWhisperMode(value) {
  if (!["tiny.en", "base.en", "compare"].includes(value)) return;
  whisperMode = value;
  for (const chip of el("whisper-mode").querySelectorAll("[data-whisper-mode]")) {
    const active = chip.dataset.whisperMode === value;
    chip.classList.toggle("active", active);
    chip.setAttribute("aria-pressed", String(active));
  }
}

function setPickerValue(id, options, value) {
  const option = options.find((candidate) => candidate.value === String(value));
  if (!option) return;
  const button = el(id);
  button.dataset.value = option.value;
  button.querySelector("strong").textContent = option.label;
  button.querySelector("small").textContent = option.detail;
}

function updateAdvancedSummary() {
  const decoder = el("whisper-decoder-preset").dataset.value;
  const threads = el("whisper-threads").dataset.value;
  el("whisper-advanced-summary").textContent = `${decoder} · ${threads} threads`;
}

function updateWhisperTimer() {
  const seconds = Math.floor((Date.now() - whisperStartedAt) / 1000);
  el("whisper-timer").textContent =
    `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function updateWhisperPreview(blob) {
  const preview = el("whisper-preview");
  if (preview.src) URL.revokeObjectURL(preview.src);
  const url = URL.createObjectURL(blob);
  whisperObjectUrls.add(url);
  preview.src = url;
  preview.hidden = false;
}

function recordingExtension(mimeType) {
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("mp4")) return "m4a";
  return "webm";
}

function selectedWhisperModels() {
  return whisperMode === "compare" ? ["tiny.en", "base.en"] : [whisperMode];
}

function selectedWhisperSettings() {
  return {
    initialPrompt: el("whisper-initial-prompt").value.trim(),
    decoderPreset: el("whisper-decoder-preset").dataset.value,
    threads: Number(el("whisper-threads").dataset.value),
  };
}

function selectedCaptureSettings() {
  return {
    echoCancellation: el("whisper-echo-cancellation").checked,
    noiseSuppression: el("whisper-noise-suppression").checked,
    autoGainControl: el("whisper-auto-gain").checked,
  };
}

function applyClideSttSettings(settings) {
  setWhisperMode(settings.model);
  el("whisper-initial-prompt").value = settings.initial_prompt || "";
  setPickerValue("whisper-decoder-preset", DECODER_OPTIONS, settings.decoder_preset);
  setPickerValue("whisper-threads", THREAD_OPTIONS, settings.threads);
  const capture = settings.capture || {};
  el("whisper-echo-cancellation").checked = capture.echo_cancellation !== false;
  el("whisper-noise-suppression").checked = capture.noise_suppression !== false;
  el("whisper-auto-gain").checked = capture.auto_gain_control === true;
  updateAdvancedSummary();
}

async function loadClideSttSettings() {
  try {
    const response = await fetch("/api/clide/stt-settings");
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not load CLIde settings");
    applyClideSttSettings(data);
    whisperSyncStatus("Current CLIde dictation settings loaded.", "ok");
  } catch (error) {
    whisperSyncStatus(error.message || "Could not load CLIde settings.", "error");
  }
}

async function saveClideSttSettings() {
  if (whisperMode === "compare") {
    whisperSyncStatus("Choose Fast or Accurate before saving to CLIde.", "error");
    return;
  }
  const save = el("whisper-save-clide");
  save.disabled = true;
  whisperSyncStatus("Saving…", "working");
  const settings = selectedWhisperSettings();
  const capture = selectedCaptureSettings();
  try {
    const response = await fetch("/api/clide/stt-settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: whisperMode,
        decoder_preset: settings.decoderPreset,
        threads: settings.threads,
        initial_prompt: settings.initialPrompt,
        capture: {
          echo_cancellation: capture.echoCancellation,
          noise_suppression: capture.noiseSuppression,
          auto_gain_control: capture.autoGainControl,
        },
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not save CLIde settings");
    applyClideSttSettings(data);
    whisperSyncStatus("Saved. The next CLIde dictation uses these settings.", "ok");
  } catch (error) {
    whisperSyncStatus(error.message || "Could not save CLIde settings.", "error");
  } finally {
    save.disabled = false;
  }
}

function markSttSettingsUnsaved() {
  whisperSyncStatus("Changed — not saved yet.");
}

function formatCaptureSettings(captureSettings) {
  if (!captureSettings) return "uploaded audio";
  const enabled = [];
  if (captureSettings.echoCancellation) enabled.push("echo cancellation");
  if (captureSettings.noiseSuppression) enabled.push("noise suppression");
  if (captureSettings.autoGainControl) enabled.push("automatic gain");
  return enabled.length ? `mic: ${enabled.join(", ")}` : "mic: raw browser capture";
}

async function transcribeOne(blob, filename, model, recordingNumber, index, total, settings, captureSettings) {
  whisperStatus(`Running ${model} (${index + 1} of ${total})…`, "working");
  const form = new FormData();
  form.append("file", blob, filename);
  form.append("model", model);
  form.append("initial_prompt", settings.initialPrompt);
  form.append("decoder_preset", settings.decoderPreset);
  form.append("threads", String(settings.threads));
  const response = await fetch("/audio/transcriptions", { method: "POST", body: form });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Transcription failed");
  addWhisperTake(blob, body.text || "", recordingNumber, {
    model: response.headers.get("X-Voice-Model"),
    milliseconds: Number(response.headers.get("X-Voice-Process-Ms")),
    duration: Number(response.headers.get("X-Voice-Audio-Seconds")),
    peakRssKiB: Number(response.headers.get("X-Voice-Peak-Rss-KiB")),
    threads: Number(response.headers.get("X-Voice-Threads")),
    decoderLabel: body.studio_settings?.decoder_label,
    initialPrompt: body.studio_settings?.initial_prompt,
    capture: formatCaptureSettings(captureSettings),
  });
}

async function transcribeWhisper(blob, filename, captureSettings = undefined) {
  el("whisper-record").disabled = true;
  el("whisper-stop").disabled = true;
  const models = selectedWhisperModels();
  const settings = selectedWhisperSettings();
  whisperRecordingCount += 1;
  try {
    for (const [index, model] of models.entries()) {
      await transcribeOne(blob, filename, model, whisperRecordingCount, index, models.length, settings, captureSettings);
    }
    whisperStatus(models.length === 2 ? "Comparison ready." : "Transcript ready.", "ok");
  } catch (error) {
    whisperStatus(error.message || "Transcription failed.", "error");
  } finally {
    el("whisper-record").disabled = false;
  }
}

async function startWhisperRecording() {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    whisperStatus("This browser cannot record. Upload a file instead.", "error");
    return;
  }
  try {
    const captureSettings = selectedCaptureSettings();
    whisperStream = await navigator.mediaDevices.getUserMedia({ audio: captureSettings });
    const preferred = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];
    const mimeType = preferred.find((candidate) => MediaRecorder.isTypeSupported(candidate));
    whisperRecorder = mimeType
      ? new MediaRecorder(whisperStream, { mimeType })
      : new MediaRecorder(whisperStream);
    const parts = [];
    whisperRecorder.addEventListener("dataavailable", (event) => { if (event.data.size) parts.push(event.data); });
    whisperRecorder.addEventListener("stop", () => {
      whisperStream.getTracks().forEach((track) => track.stop());
      whisperStream = undefined;
      clearInterval(whisperTimerId);
      el("whisper-timer").textContent = "00:00";
      const blob = new Blob(parts, { type: whisperRecorder.mimeType || "audio/webm" });
      updateWhisperPreview(blob);
      transcribeWhisper(blob, `recording.${recordingExtension(blob.type)}`, captureSettings);
    }, { once: true });
    whisperRecorder.start();
    whisperStartedAt = Date.now();
    whisperTimerId = setInterval(updateWhisperTimer, 250);
    el("whisper-record").disabled = true;
    el("whisper-stop").disabled = false;
    whisperStatus("Recording…", "working");
  } catch (error) {
    whisperStatus(`Microphone unavailable: ${error.message || "permission was not granted"}`, "error");
  }
}

function stopWhisperRecording() {
  if (whisperRecorder?.state === "recording") whisperRecorder.stop();
  el("whisper-stop").disabled = true;
}

function addWhisperTake(blob, text, recordingNumber, metrics) {
  const history = el("whisper-history");
  history.querySelector("p.muted")?.remove();
  const card = el("whisper-take-template").content.firstElementChild.cloneNode(true);
  card.querySelector(".whisper-take-number").textContent =
    `TAKE ${String(recordingNumber).padStart(2, "0")} · ${metrics.model || "tiny.en"}`;
  const url = URL.createObjectURL(blob);
  whisperObjectUrls.add(url);
  card.querySelector("audio").src = url;
  card.querySelector(".whisper-transcript").textContent = text || "No speech detected.";
  const pieces = [metrics.model || "tiny.en"];
  if (Number.isFinite(metrics.milliseconds)) pieces.push(`${(metrics.milliseconds / 1000).toFixed(2)} s processing`);
  if (Number.isFinite(metrics.duration) && metrics.duration > 0 && Number.isFinite(metrics.milliseconds)) {
    pieces.push(`${(metrics.milliseconds / 1000 / metrics.duration).toFixed(2)}× real time`);
  }
  if (Number.isFinite(metrics.peakRssKiB) && metrics.peakRssKiB > 0) pieces.push(`~${Math.round(metrics.peakRssKiB / 1024)} MiB peak RSS`);
  if (Number.isFinite(metrics.threads) && metrics.threads > 0) pieces.push(`${metrics.threads} threads`);
  if (metrics.decoderLabel) pieces.push(metrics.decoderLabel);
  if (metrics.initialPrompt) pieces.push(`prompt: ${metrics.initialPrompt}`);
  if (metrics.capture) pieces.push(metrics.capture);
  card.querySelector(".whisper-metrics").textContent = pieces.join(" · ");
  card.querySelector(".whisper-remove-take").addEventListener("click", () => {
    URL.revokeObjectURL(url);
    whisperObjectUrls.delete(url);
    card.remove();
  });
  history.prepend(card);
}

Studio.bindChips(el("whisper-mode"), "whisper-mode", (value) => {
  whisperMode = value;
  markSttSettingsUnsaved();
});
Studio.bindPicker(el("whisper-decoder-preset"), {
  title: "Decoder preset",
  options: DECODER_OPTIONS,
  onChange: () => { updateAdvancedSummary(); markSttSettingsUnsaved(); },
});
Studio.bindPicker(el("whisper-threads"), {
  title: "CPU threads",
  options: THREAD_OPTIONS,
  onChange: () => { updateAdvancedSummary(); markSttSettingsUnsaved(); },
});
updateAdvancedSummary();

el("whisper-initial-prompt").addEventListener("input", markSttSettingsUnsaved);
for (const id of ["whisper-echo-cancellation", "whisper-noise-suppression", "whisper-auto-gain"]) {
  el(id).addEventListener("change", markSttSettingsUnsaved);
}
el("whisper-save-clide").addEventListener("click", saveClideSttSettings);
loadClideSttSettings();

el("whisper-record").addEventListener("click", startWhisperRecording);
el("whisper-stop").addEventListener("click", stopWhisperRecording);
el("whisper-upload").addEventListener("change", (event) => {
  const [file] = event.target.files;
  if (!file) return;
  updateWhisperPreview(file);
  transcribeWhisper(file, file.name);
  event.target.value = "";
});
el("whisper-clear").addEventListener("click", () => {
  el("whisper-history").innerHTML = '<p class="muted" style="font-size:0.8rem">Transcripts appear here.</p>';
  whisperRecordingCount = 0;
  for (const url of whisperObjectUrls) URL.revokeObjectURL(url);
  whisperObjectUrls.clear();
  el("whisper-preview").hidden = true;
  el("whisper-preview").removeAttribute("src");
  whisperStatus("History cleared.");
});
