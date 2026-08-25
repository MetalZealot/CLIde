const $ = (id) => document.getElementById(id);

let recorder;
let activeStream;
let startedAt = 0;
let timerId;
let recordingCount = 0;
const objectUrls = new Set();

function setStatus(message, kind = "") {
  const status = $("status");
  status.textContent = message;
  status.className = `status ${kind}`;
}

function setTimer() {
  const seconds = Math.floor((Date.now() - startedAt) / 1000);
  $("timer").textContent = `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
}

function updatePreview(blob) {
  const preview = $("preview");
  if (preview.src) URL.revokeObjectURL(preview.src);
  const url = URL.createObjectURL(blob);
  objectUrls.add(url);
  preview.src = url;
  preview.hidden = false;
}

function recordingExtension(mimeType) {
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("mp4")) return "m4a";
  return "webm";
}

function selectedModels() {
  const mode = document.querySelector('input[name="model-mode"]:checked').value;
  return mode === "compare" ? ["tiny.en", "base.en"] : [mode];
}

async function transcribeOne(blob, filename, model, recordingNumber, index, total) {
  setStatus(`Running ${model} (${index + 1} of ${total})…`, "working");
  const form = new FormData();
  form.append("file", blob, filename);
  form.append("model", model);
  const response = await fetch("/audio/transcriptions", { method: "POST", body: form });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "Transcription failed");
  addTake(blob, body.text || "", recordingNumber, {
    model: response.headers.get("X-Voice-Model"),
    milliseconds: Number(response.headers.get("X-Voice-Process-Ms")),
    duration: Number(response.headers.get("X-Voice-Audio-Seconds")),
    peakRssKiB: Number(response.headers.get("X-Voice-Peak-Rss-KiB")),
    threads: Number(response.headers.get("X-Voice-Threads")),
  });
}

async function transcribe(blob, filename) {
  $("record").disabled = true;
  $("stop").disabled = true;
  const models = selectedModels();
  recordingCount += 1;
  try {
    for (const [index, model] of models.entries()) {
      await transcribeOne(blob, filename, model, recordingCount, index, models.length);
    }
    setStatus(models.length === 2 ? "Comparison ready." : "Transcript ready.", "success");
  } catch (error) {
    setStatus(error.message || "Transcription failed.", "error");
  } finally {
    $("record").disabled = false;
  }
}

async function startRecording() {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    setStatus("This browser does not support microphone recording. Upload a file instead.", "error");
    return;
  }
  try {
    activeStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
    const preferred = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];
    const mimeType = preferred.find((candidate) => MediaRecorder.isTypeSupported(candidate));
    recorder = mimeType ? new MediaRecorder(activeStream, { mimeType }) : new MediaRecorder(activeStream);
    const parts = [];
    recorder.addEventListener("dataavailable", (event) => { if (event.data.size) parts.push(event.data); });
    recorder.addEventListener("stop", () => {
      activeStream.getTracks().forEach((track) => track.stop());
      activeStream = undefined;
      clearInterval(timerId);
      $("timer").textContent = "00:00";
      const blob = new Blob(parts, { type: recorder.mimeType || "audio/webm" });
      updatePreview(blob);
      transcribe(blob, `recording.${recordingExtension(blob.type)}`);
    }, { once: true });
    recorder.start();
    startedAt = Date.now();
    timerId = setInterval(setTimer, 250);
    $("record").disabled = true;
    $("stop").disabled = false;
    setStatus("Recording…", "working");
  } catch (error) {
    setStatus(`Microphone unavailable: ${error.message || "permission was not granted"}`, "error");
  }
}

function stopRecording() {
  if (recorder?.state === "recording") recorder.stop();
  $("stop").disabled = true;
}

function addTake(blob, text, recordingNumber, metrics) {
  $("history").querySelector(".empty-state")?.remove();
  const card = $("take-template").content.firstElementChild.cloneNode(true);
  card.querySelector(".take-number").textContent = `TAKE ${String(recordingNumber).padStart(2, "0")} · ${metrics.model || "tiny.en"}`;
  const url = URL.createObjectURL(blob);
  objectUrls.add(url);
  card.querySelector("audio").src = url;
  card.querySelector(".transcript").textContent = text || "No speech detected.";
  const pieces = [metrics.model || "tiny.en"];
  if (Number.isFinite(metrics.milliseconds)) pieces.push(`${(metrics.milliseconds / 1000).toFixed(2)} s processing`);
  if (Number.isFinite(metrics.duration) && metrics.duration > 0 && Number.isFinite(metrics.milliseconds)) {
    pieces.push(`${(metrics.milliseconds / 1000 / metrics.duration).toFixed(2)}× real time`);
  }
  if (Number.isFinite(metrics.peakRssKiB) && metrics.peakRssKiB > 0) {
    pieces.push(`~${Math.round(metrics.peakRssKiB / 1024)} MiB Whisper peak RSS`);
  }
  if (Number.isFinite(metrics.threads) && metrics.threads > 0) {
    pieces.push(`${metrics.threads} CPU threads`);
  }
  card.querySelector(".metrics").textContent = pieces.join(" · ");
  card.querySelector(".remove").addEventListener("click", () => card.remove());
  $("history").prepend(card);
}

$("record").addEventListener("click", startRecording);
$("stop").addEventListener("click", stopRecording);
$("upload").addEventListener("change", (event) => {
  const [file] = event.target.files;
  if (!file) return;
  updatePreview(file);
  transcribe(file, file.name);
  event.target.value = "";
});
$("clear").addEventListener("click", () => {
  $("history").replaceChildren();
  recordingCount = 0;
  for (const url of objectUrls) URL.revokeObjectURL(url);
  objectUrls.clear();
  $("preview").hidden = true;
  $("preview").removeAttribute("src");
  setStatus("History cleared.");
});
