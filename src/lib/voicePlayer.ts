import { cancelVoiceSynthesis, synthesizeVoice, voiceConfigSignature } from './voiceApi';

// A single app-level audio player for read-aloud. It owns one <audio> element, lives
// outside the React tree, and caches generated audio by content. Because playback is not
// tied to a component, switching chats or re-rendering a message can't revoke the blob URL
// out from under it (the cause of mid-play cutoffs). v1 plays one message at a time
// (a new play replaces the current one); the design leaves room for a queue later.

export type VoicePlayState = 'idle' | 'loading' | 'playing' | 'paused';

export type VoiceSnapshot = {
  state: VoicePlayState;
  error: string | null;
  currentTime: number;
  duration: number;
  generationElapsedSeconds: number;
};

const IDLE: VoiceSnapshot = {
  state: 'idle',
  error: null,
  currentTime: 0,
  duration: 0,
  generationElapsedSeconds: 0,
};
const CACHE_MAX = 24;
const CLIENT_TIMEOUT_MS = 330000; // backstop; the server proxy already times out at 5 min
type SpeechSynthesizer = typeof synthesizeVoice;
type SpeechCanceller = typeof cancelVoiceSynthesis;

function createVoiceJobId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  return `voice-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

// Stable id / cache key from the text and voice settings that affect its audio (djb2).
export function voiceId(content: string, signature = voiceConfigSignature()): string {
  const input = JSON.stringify([content, signature]);
  let h = 5381;
  for (let i = 0; i < input.length; i++) h = (((h << 5) + h) + input.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export function formatPlaybackTime(seconds: number): string {
  const wholeSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(wholeSeconds / 3600);
  const minutes = Math.floor((wholeSeconds % 3600) / 60);
  const remainder = String(wholeSeconds % 60).padStart(2, '0');
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${remainder}`
    : `${minutes}:${remainder}`;
}

export class VoicePlayer {
  private audio: HTMLAudioElement | null = null;
  private unlocked = false;
  private cache = new Map<string, string>(); // id -> blob URL (insertion order = LRU)
  private currentId: string | null = null;
  private state: VoicePlayState = 'idle';
  private errorId: string | null = null;
  private errorMsg: string | null = null;
  private currentTime = 0;
  private duration = 0;
  private generationElapsedSeconds = 0;
  private generationStartedAt = 0;
  private generationTimer: ReturnType<typeof setInterval> | null = null;
  private token = 0; // bumps to ignore stale in-flight results
  private activeController: AbortController | null = null; // aborts the in-flight TTS fetch
  private activeJobId: string | null = null;
  private pendingCancellation: Promise<void> = Promise.resolve();
  private errorTimer: ReturnType<typeof setTimeout> | null = null;
  private listeners = new Set<() => void>();

  constructor(
    private readonly synthesize: SpeechSynthesizer = synthesizeVoice,
    private readonly cancelSynthesis: SpeechCanceller = cancelVoiceSynthesis,
  ) {}

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit() {
    this.listeners.forEach((l) => l());
  }

  getSnapshot(id: string): VoiceSnapshot {
    const state = this.currentId === id ? this.state : 'idle';
    const error = this.errorId === id ? this.errorMsg : null;
    if (state === 'idle' && error === null) return IDLE;
    return {
      state,
      error,
      currentTime: this.currentId === id ? this.currentTime : 0,
      duration: this.currentId === id ? this.duration : 0,
      generationElapsedSeconds: this.currentId === id ? this.generationElapsedSeconds : 0,
    };
  }

  private startGenerationTimer() {
    this.stopGenerationTimer();
    this.generationStartedAt = Date.now();
    this.generationElapsedSeconds = 0;
    this.generationTimer = setInterval(() => {
      if (this.state !== 'loading') return;
      const elapsed = Math.floor((Date.now() - this.generationStartedAt) / 1000);
      if (elapsed === this.generationElapsedSeconds) return;
      this.generationElapsedSeconds = elapsed;
      this.emit();
    }, 250);
  }

  private stopGenerationTimer() {
    if (this.generationTimer) {
      clearInterval(this.generationTimer);
      this.generationTimer = null;
    }
    this.generationStartedAt = 0;
  }

  private ensureAudio(): HTMLAudioElement {
    if (!this.audio) {
      const audio = new Audio();
      audio.addEventListener('ended', () => this.onEnded());
      audio.addEventListener('loadedmetadata', () => this.syncTimeline());
      audio.addEventListener('durationchange', () => this.syncTimeline());
      audio.addEventListener('timeupdate', () => this.syncTimeline());
      audio.addEventListener('play', () => this.onPlay());
      audio.addEventListener('pause', () => this.onPause());
      audio.addEventListener('error', () => {
        if (this.state === 'playing' || this.state === 'paused') this.onEnded();
      });
      this.audio = audio;
      this.installMediaSessionHandlers();
    }
    return this.audio;
  }

  private installMediaSessionHandlers() {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    const handlers: Partial<Record<MediaSessionAction, MediaSessionActionHandler>> = {
      play: () => void this.resume(),
      pause: () => this.pause(),
      stop: () => this.stop(),
    };
    for (const [action, handler] of Object.entries(handlers)) {
      try {
        navigator.mediaSession.setActionHandler(action as MediaSessionAction, handler ?? null);
      } catch {
        /* Browser does not support this media-session action. */
      }
    }
  }

  private syncMediaSession() {
    if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return;
    try {
      navigator.mediaSession.playbackState = this.state === 'playing'
        ? 'playing'
        : this.state === 'paused'
          ? 'paused'
          : 'none';
    } catch {
      /* Playback state is optional on older browsers. */
    }
    if (!this.audio || !Number.isFinite(this.audio.duration) || this.audio.duration <= 0) return;
    try {
      navigator.mediaSession.setPositionState({
        duration: this.audio.duration,
        playbackRate: this.audio.playbackRate || 1,
        position: Math.min(this.audio.currentTime, this.audio.duration),
      });
    } catch {
      /* Position state is optional on older browsers. */
    }
  }

  private syncTimeline(shouldEmit = true) {
    if (!this.audio || !this.currentId) return;
    const currentTime = Number.isFinite(this.audio.currentTime)
      ? Math.max(0, Math.floor(this.audio.currentTime))
      : 0;
    const duration = Number.isFinite(this.audio.duration)
      ? Math.max(0, Math.round(this.audio.duration))
      : 0;
    if (currentTime === this.currentTime && duration === this.duration) return;
    this.currentTime = currentTime;
    this.duration = duration;
    this.syncMediaSession();
    if (shouldEmit) this.emit();
  }

  private onPlay() {
    // Browser audio-unlock events may arrive after the first TTS request starts.
    // Only a genuinely paused message can be resumed by an external Play event.
    if (!this.currentId || this.state !== 'paused') return;
    this.state = 'playing';
    this.syncTimeline(false);
    this.syncMediaSession();
    this.emit();
  }

  private onPause() {
    if (!this.currentId || this.state !== 'playing') return;
    this.state = 'paused';
    this.syncTimeline(false);
    this.syncMediaSession();
    this.emit();
  }

  // Call synchronously from the click handler so iOS grants the (reused) element playback.
  unlock() {
    if (this.unlocked) return;
    const audio = this.ensureAudio();
    try {
      const p = audio.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
      audio.pause();
    } catch {
      /* priming attempt; ignore */
    }
    this.unlocked = true;
  }

  toggle(content: string) {
    const id = voiceId(content);
    if (this.currentId === id && this.state === 'playing') {
      this.pause();
      return;
    }
    if (this.currentId === id && this.state === 'paused') {
      void this.resume();
      return;
    }
    if (this.currentId === id && this.state === 'loading') {
      this.stop();
      return;
    }
    void this.play(id, content);
  }

  pause() {
    if (!this.audio || this.state !== 'playing') return;
    this.state = 'paused';
    this.syncTimeline(false);
    this.audio.pause();
    this.syncMediaSession();
    this.emit();
  }

  async resume() {
    if (!this.audio || !this.currentId || this.state !== 'paused') return;
    const id = this.currentId;
    const myToken = this.token;
    try {
      await this.audio.play();
      if (myToken !== this.token || this.currentId !== id) return;
      this.state = 'playing';
      this.syncTimeline(false);
      this.syncMediaSession();
      this.emit();
    } catch (error) {
      if (myToken !== this.token || this.currentId !== id) return;
      this.setError(id, error instanceof Error ? error.message : 'Read-aloud failed');
    }
  }

  restart() {
    if (!this.audio || !this.currentId || (this.state !== 'playing' && this.state !== 'paused')) return;
    this.audio.currentTime = 0;
    this.currentTime = 0;
    if (this.state === 'paused') {
      void this.resume();
    } else {
      this.syncMediaSession();
      this.emit();
    }
  }

  stop() {
    this.token++; // ignore any stale in-flight result
    void this.cancelActiveGeneration();
    this.stopGenerationTimer();
    this.state = 'idle';
    this.currentId = null;
    this.currentTime = 0;
    this.duration = 0;
    this.generationElapsedSeconds = 0;
    if (this.audio) this.audio.pause();
    this.syncMediaSession();
    this.emit();
  }

  private async cancelActiveGeneration() {
    const controller = this.activeController;
    const jobId = this.activeJobId;
    this.activeController = null;
    this.activeJobId = null;
    controller?.abort();
    const cancel = async () => {
      if (!jobId) return;
      try {
        await this.cancelSynthesis(jobId);
      } catch {
        // The disconnected TTS request also triggers server-side cancellation.
      }
    };
    this.pendingCancellation = this.pendingCancellation.then(cancel, cancel);
    await this.pendingCancellation;
  }

  private onEnded() {
    this.state = 'idle';
    this.currentId = null;
    this.currentTime = 0;
    this.duration = 0;
    this.generationElapsedSeconds = 0;
    this.stopGenerationTimer();
    this.syncMediaSession();
    this.emit();
    // (queue auto-advance would hook in here)
  }

  private setError(id: string, msg: string) {
    this.state = 'idle';
    this.currentId = id;
    this.currentTime = 0;
    this.duration = 0;
    this.generationElapsedSeconds = 0;
    this.stopGenerationTimer();
    this.errorId = id;
    this.errorMsg = msg;
    this.syncMediaSession();
    this.emit();
    if (this.errorTimer) clearTimeout(this.errorTimer);
    this.errorTimer = setTimeout(() => {
      if (this.errorId === id) {
        this.errorId = null;
        this.errorMsg = null;
        if (this.currentId === id) this.currentId = null;
        this.emit();
      }
    }, 6000);
  }

  private async play(id: string, content: string) {
    const audio = this.ensureAudio();
    this.currentId = id;
    this.errorId = null;
    this.errorMsg = null;
    this.state = 'loading';
    this.currentTime = 0;
    this.duration = 0;
    this.startGenerationTimer();
    audio.pause();
    this.syncMediaSession();
    this.emit();

    const myToken = ++this.token;
    await this.cancelActiveGeneration();
    if (myToken !== this.token) return;

    try {
      let url = this.cache.get(id);
      if (!url) {
        const controller = new AbortController();
        const jobId = createVoiceJobId();
        this.activeController = controller;
        this.activeJobId = jobId;
        const timer = setTimeout(() => {
          controller.abort();
          void this.cancelSynthesis(jobId).catch(() => {});
        }, CLIENT_TIMEOUT_MS);
        const res = await this.synthesize(content, controller.signal, jobId).finally(() => {
          clearTimeout(timer);
          if (this.activeController === controller) this.activeController = null;
          if (this.activeJobId === jobId) this.activeJobId = null;
        });
        if (myToken !== this.token) return; // superseded by another play/stop
        if (!res.ok) {
          let msg = `Read-aloud failed (${res.status})`;
          try {
            const j = await res.json();
            if (j?.error) msg = String(j.error);
          } catch {
            /* non-JSON error body */
          }
          throw new Error(msg);
        }
        const blob = await res.blob();
        if (myToken !== this.token) return;
        url = URL.createObjectURL(blob);
        this.cacheSet(id, url);
      }
      if (myToken !== this.token) return;
      audio.src = url;
      audio.load();
      await audio.play();
      if (myToken !== this.token) return;
      this.state = 'playing';
      this.stopGenerationTimer();
      this.syncTimeline(false);
      this.syncMediaSession();
      this.emit();
    } catch (e) {
      if (myToken !== this.token) return;
      const aborted = e instanceof Error && e.name === 'AbortError';
      this.setError(id, aborted ? 'Read-aloud timed out.' : e instanceof Error ? e.message : 'Read-aloud failed');
    }
  }

  private cacheSet(id: string, url: string) {
    this.cache.set(id, url);
    while (this.cache.size > CACHE_MAX) {
      const oldest = this.cache.keys().next().value as string | undefined;
      if (oldest === undefined) break;
      const oldUrl = this.cache.get(oldest);
      this.cache.delete(oldest);
      if (oldUrl && oldUrl !== this.audio?.src) URL.revokeObjectURL(oldUrl);
    }
  }
}

export const voicePlayer = new VoicePlayer();
