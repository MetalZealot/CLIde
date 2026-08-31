// Saved Speak output. Audio and metadata live on the Pi; the browser keeps
// only the token for the most recently generated, not-yet-saved WAV.

const Recordings = {
  pendingToken: null,
  pendingTitle: "",
};
window.Recordings = Recordings;

function recordingsStatus(message, kind = "") {
  const status = el("recordings-status");
  status.textContent = message;
  status.className = `status ${kind}`;
}

function defaultTitle(text) {
  const first = String(text || "")
    .split("\n")
    .map((line) => line.replace(/^\s*(?:#{1,6}|[-*+]>?)\s*/, "").trim())
    .find(Boolean) || "Saved speech";
  return first.length > 64 ? `${first.slice(0, 61).trim()}…` : first;
}

Recordings.clearPending = () => {
  Recordings.pendingToken = null;
  Recordings.pendingTitle = "";
  el("recording-save-row").hidden = true;
  const button = el("recording-save-open");
  button.disabled = false;
  button.textContent = "Save recording";
};

Recordings.offer = (token, text) => {
  Recordings.pendingToken = token || null;
  Recordings.pendingTitle = defaultTitle(text);
  el("recording-save-row").hidden = !Recordings.pendingToken;
};

function formatDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Unknown date"
    : new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function settingsText(item) {
  const settings = item.settings || {};
  return [
    item.settings_preset || "Custom audition",
    `speed ${Number(settings.length_scale ?? 1).toFixed(2)}×`,
    `gaps ${Math.round(Number(settings.sentence_silence_seconds || 0) * 1000)}/` +
      `${Math.round(Number(settings.structure_silence_seconds || 0) * 1000)} ms`,
    `noise ${Number(settings.noise_scale ?? 0).toFixed(3)}`,
    `width ${Number(settings.noise_w_scale ?? 0).toFixed(2)}`,
    `volume ${Number(settings.volume ?? 1).toFixed(2)}×`,
    settings.normalize_audio === false ? "normalization off" : "normalization on",
  ].join(" · ");
}

function recordingCard(item) {
  const card = document.createElement("article");
  card.className = "recording-card";

  const heading = document.createElement("div");
  heading.className = "recording-head";
  const headingText = document.createElement("div");
  headingText.className = "card-head-text";
  const title = document.createElement("h3");
  title.textContent = item.title || "Saved speech";
  const meta = document.createElement("small");
  const voice = item.voice || {};
  meta.textContent = [
    voice.label || voice.id || voice.model,
    item.duration_seconds != null ? `${item.duration_seconds}s` : "",
    formatDate(item.created_at),
  ].filter(Boolean).join(" · ");
  headingText.append(title, meta);
  heading.appendChild(headingText);

  const audio = document.createElement("audio");
  audio.controls = true;
  audio.preload = "metadata";
  audio.src = item.audio_url;

  const details = document.createElement("details");
  details.className = "disclosure recording-details";
  const summary = document.createElement("summary");
  summary.innerHTML = "<span><strong>Details</strong> <small>text and exact settings</small></span>";
  const body = document.createElement("div");
  body.className = "disclosure-body";
  const settings = document.createElement("p");
  settings.className = "recording-settings";
  settings.textContent = settingsText(item);
  const source = document.createElement("pre");
  source.textContent = item.text || item.prepared || "";
  const actions = document.createElement("div");
  actions.className = "recording-actions";
  const download = document.createElement("a");
  download.className = "secondary recording-download";
  download.href = item.download_url;
  download.textContent = "Download WAV";
  const remove = document.createElement("button");
  remove.className = "ghost recording-delete";
  remove.type = "button";
  remove.textContent = "Delete";
  remove.addEventListener("click", async () => {
    const chosen = await Studio.chooseOption({
      title: `Delete “${item.title || "Saved speech"}”?`,
      options: [{
        value: "delete",
        label: "Delete recording",
        detail: "Permanently remove this saved WAV",
      }],
      value: "",
    });
    if (chosen !== "delete") return;
    recordingsStatus("Deleting…", "working");
    try {
      const response = await fetch(`/api/recordings/${encodeURIComponent(item.id)}`, {
        method: "DELETE",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not delete the recording");
      await loadRecordings();
      recordingsStatus("Recording deleted.", "ok");
    } catch (error) {
      recordingsStatus(error.message, "error");
    }
  });
  actions.append(download, remove);
  body.append(settings, source, actions);
  details.append(summary, body);

  card.append(heading, audio, details);
  return card;
}

async function loadRecordings() {
  const list = el("recordings-list");
  try {
    const response = await fetch("/api/recordings");
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not load recordings");
    const items = data.recordings || [];
    el("recordings-count").textContent = items.length
      ? `${items.length} saved · newest first`
      : "Saved Speak output on this Pi.";
    list.replaceChildren();
    if (!items.length) {
      const empty = document.createElement("p");
      empty.className = "list-empty";
      empty.textContent = "Nothing saved yet. Generate speech, then tap Save recording.";
      list.appendChild(empty);
      return;
    }
    for (const item of items) list.appendChild(recordingCard(item));
  } catch (error) {
    list.replaceChildren();
    recordingsStatus(error.message, "error");
  }
}
Recordings.refresh = loadRecordings;

el("recording-save-open").addEventListener("click", () => {
  if (!Recordings.pendingToken) return;
  el("recording-title").value = Recordings.pendingTitle;
  el("recording-save-status").textContent = "";
  Studio.openSheet("recording-save-sheet");
  window.requestAnimationFrame(() => el("recording-title").select());
});

el("recording-save-close").addEventListener("click", Studio.closeSheet);
el("recording-save-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const status = el("recording-save-status");
  const save = el("recording-save");
  save.disabled = true;
  status.textContent = "Saving…";
  status.className = "status working";
  try {
    const response = await fetch("/api/recordings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: Recordings.pendingToken,
        title: el("recording-title").value,
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Could not save the recording");
    Recordings.pendingToken = null;
    el("recording-save-open").textContent = "Saved to Recordings";
    el("recording-save-open").disabled = true;
    Studio.closeSheet();
    await loadRecordings();
  } catch (error) {
    status.textContent = error.message;
    status.className = "status error";
  } finally {
    save.disabled = false;
  }
});

el("recordings-refresh").addEventListener("click", loadRecordings);
document.addEventListener("studio:tab", (event) => {
  if (event.detail === "recordings") loadRecordings();
});
