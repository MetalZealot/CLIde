// Speak tab. Every request goes to the running CLIde voice service, so an
// audition cannot drift from what the app actually says.

let clideAudioUrl = null;
let corpusCases = [];

function clideStatus(message, kind = "") {
  const status = el("clide-status");
  status.textContent = message;
  status.className = `status ${kind}`;
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
  const bytes = Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
  clideAudioUrl = URL.createObjectURL(new Blob([bytes], { type: "audio/wav" }));
  audio.src = clideAudioUrl;
  audio.hidden = false;
  audio.play().catch(() => { /* autoplay refused; the control is there */ });
}

async function runClideSpeech(speak) {
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
  el("clide-speak").disabled = true;
  el("clide-prepare").disabled = true;

  // An audition renders any installed model; a preset also carries its pacing,
  // so only the preset path may set `voice`.
  const auditioning = selection.type === "model" && speak;
  try {
    const response = auditioning
      ? await fetch("/api/clide/audition", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text,
            model: selection.model,
            speaker_id: selection.speakerId,
            length_scale: Voices.speed ? Voices.speed.value : undefined,
          }),
        })
      : await fetch("/api/clide/speech", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text,
            voice: selection.type === "preset" ? selection.id : undefined,
            speak,
          }),
        });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Request failed");

    el("clide-prepared").textContent = data.prepared || "(nothing speakable)";
    el("clide-phonemes").textContent = (data.phonemes || []).join("\n") || "—";

    if (data.audio_base64) {
      playAudio(data.audio_base64);
      renderPauses(data.pauses, data.sentences);
      clideStatus(
        `${data.duration_seconds}s of audio in ${data.generation_seconds}s`,
        "ok",
      );
      const key = Voices.currentKey();
      if (key) {
        Voices.markHeard(key, {
          model: selection.model,
          speaker_id: selection.speakerId ?? null,
          length_scale: Voices.speed ? Voices.speed.value : null,
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
    el("clide-speak").disabled = false;
    el("clide-prepare").disabled = false;
  }
}

/* The listening pass: one reference case per class of failure. --------- */

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
  el("clide-char-count").textContent =
    `${event.target.value.length.toLocaleString()} / 6,000`;
});
el("clide-script").dispatchEvent(new Event("input"));
loadCorpus();
