const whisperById = (id) => document.getElementById(id);

let whisperRecorder;
let whisperStream;
let whisperStartedAt = 0;
let whisperTimerId;
let whisperRecordingCount = 0;
const whisperObjectUrls = new Set();

function activateStudioTab(tabName) {
  for (const button of document.querySelectorAll("[data-studio-tab]")) {
    const active = button.dataset.studioTab === tabName;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  }
  for (const pane of document.querySelectorAll(".studio-pane")) {
    const active = pane.id === `${tabName}-studio`;
    pane.classList.toggle("active", active);
    pane.hidden = !active;
  }
}

function whisperStatus(message, kind = "") {
  const status = whisperById("whisper-status");
  status.textContent = message;
  status.className = `status ${kind}`;
}

function updateWhisperTimer() {
  const seconds = Math.floor((Date.now() - whisperStartedAt) / 1000);
  whisperById("whisper-timer").textContent = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function updateWhisperPreview(blob) {
  const preview = whisperById("whisper-preview");
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
  const mode = document.querySelector('input[name="whisper-model-mode"]:checked').value;
  return mode === "compare" ? ["tiny.en", "base.en"] : [mode];
}

function selectedWhisperSettings() {
  return {
    initialPrompt: whisperById("whisper-initial-prompt").value.trim(),
    decoderPreset: whisperById("whisper-decoder-preset").value,
    threads: Number(whisperById("whisper-threads").value),
  };
}

function selectedCaptureSettings() {
  return {
    echoCancellation: whisperById("whisper-echo-cancellation").checked,
    noiseSuppression: whisperById("whisper-noise-suppression").checked,
    autoGainControl: whisperById("whisper-auto-gain").checked,
  };
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
  whisperById("whisper-record").disabled = true;
  whisperById("whisper-stop").disabled = true;
  const models = selectedWhisperModels();
  const settings = selectedWhisperSettings();
  whisperRecordingCount += 1;
  try {
    for (const [index, model] of models.entries()) {
      await transcribeOne(blob, filename, model, whisperRecordingCount, index, models.length, settings, captureSettings);
    }
    whisperStatus(models.length === 2 ? "Comparison ready." : "Transcript ready.", "success");
  } catch (error) {
    whisperStatus(error.message || "Transcription failed.", "error");
  } finally {
    whisperById("whisper-record").disabled = false;
  }
}

async function startWhisperRecording() {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    whisperStatus("This browser does not support microphone recording. Upload a file instead.", "error");
    return;
  }
  try {
    const captureSettings = selectedCaptureSettings();
    whisperStream = await navigator.mediaDevices.getUserMedia({ audio: captureSettings });
    const preferred = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];
    const mimeType = preferred.find((candidate) => MediaRecorder.isTypeSupported(candidate));
    whisperRecorder = mimeType ? new MediaRecorder(whisperStream, { mimeType }) : new MediaRecorder(whisperStream);
    const parts = [];
    whisperRecorder.addEventListener("dataavailable", (event) => { if (event.data.size) parts.push(event.data); });
    whisperRecorder.addEventListener("stop", () => {
      whisperStream.getTracks().forEach((track) => track.stop());
      whisperStream = undefined;
      clearInterval(whisperTimerId);
      whisperById("whisper-timer").textContent = "00:00";
      const blob = new Blob(parts, { type: whisperRecorder.mimeType || "audio/webm" });
      updateWhisperPreview(blob);
      transcribeWhisper(blob, `recording.${recordingExtension(blob.type)}`, captureSettings);
    }, { once: true });
    whisperRecorder.start();
    whisperStartedAt = Date.now();
    whisperTimerId = setInterval(updateWhisperTimer, 250);
    whisperById("whisper-record").disabled = true;
    whisperById("whisper-stop").disabled = false;
    whisperStatus("Recording…", "working");
  } catch (error) {
    whisperStatus(`Microphone unavailable: ${error.message || "permission was not granted"}`, "error");
  }
}

function stopWhisperRecording() {
  if (whisperRecorder?.state === "recording") whisperRecorder.stop();
  whisperById("whisper-stop").disabled = true;
}

function addWhisperTake(blob, text, recordingNumber, metrics) {
  whisperById("whisper-history").querySelector(".empty-state")?.remove();
  const card = whisperById("whisper-take-template").content.firstElementChild.cloneNode(true);
  card.querySelector(".whisper-take-number").textContent = `TAKE ${String(recordingNumber).padStart(2, "0")} · ${metrics.model || "tiny.en"}`;
  const url = URL.createObjectURL(blob);
  whisperObjectUrls.add(url);
  card.querySelector("audio").src = url;
  card.querySelector(".whisper-transcript").textContent = text || "No speech detected.";
  const pieces = [metrics.model || "tiny.en"];
  if (Number.isFinite(metrics.milliseconds)) pieces.push(`${(metrics.milliseconds / 1000).toFixed(2)} s processing`);
  if (Number.isFinite(metrics.duration) && metrics.duration > 0 && Number.isFinite(metrics.milliseconds)) {
    pieces.push(`${(metrics.milliseconds / 1000 / metrics.duration).toFixed(2)}× real time`);
  }
  if (Number.isFinite(metrics.peakRssKiB) && metrics.peakRssKiB > 0) pieces.push(`~${Math.round(metrics.peakRssKiB / 1024)} MiB Whisper peak RSS`);
  if (Number.isFinite(metrics.threads) && metrics.threads > 0) pieces.push(`${metrics.threads} CPU threads`);
  if (metrics.decoderLabel) pieces.push(metrics.decoderLabel);
  if (metrics.initialPrompt) pieces.push(`prompt: ${metrics.initialPrompt}`);
  if (metrics.capture) pieces.push(metrics.capture);
  card.querySelector(".whisper-metrics").textContent = pieces.join(" · ");
  card.querySelector(".whisper-remove-take").addEventListener("click", () => {
    URL.revokeObjectURL(url);
    whisperObjectUrls.delete(url);
    card.remove();
  });
  whisperById("whisper-history").prepend(card);
}

for (const button of document.querySelectorAll("[data-studio-tab]")) {
  button.addEventListener("click", () => activateStudioTab(button.dataset.studioTab));
}
whisperById("whisper-record").addEventListener("click", startWhisperRecording);
whisperById("whisper-stop").addEventListener("click", stopWhisperRecording);
whisperById("whisper-upload").addEventListener("change", (event) => {
  const [file] = event.target.files;
  if (!file) return;
  updateWhisperPreview(file);
  transcribeWhisper(file, file.name);
  event.target.value = "";
});
whisperById("whisper-clear").addEventListener("click", () => {
  whisperById("whisper-history").replaceChildren();
  whisperRecordingCount = 0;
  for (const url of whisperObjectUrls) URL.revokeObjectURL(url);
  whisperObjectUrls.clear();
  whisperById("whisper-preview").hidden = true;
  whisperById("whisper-preview").removeAttribute("src");
  whisperStatus("History cleared.");
});
