const NOTIFICATION_SOUND_ENABLED_STORAGE_KEY = 'notificationSoundEnabled';
const NOTIFICATION_SOUND_VOLUME_STORAGE_KEY = 'notificationSoundVolume';
export const isNotificationSoundEnabled = (): boolean => {
  if (typeof localStorage === 'undefined') {
    return true;
  }

  return localStorage.getItem(NOTIFICATION_SOUND_ENABLED_STORAGE_KEY) !== 'false';
};

export const setNotificationSoundEnabled = (enabled: boolean): void => {
  if (typeof localStorage === 'undefined') {
    return;
  }

  localStorage.setItem(NOTIFICATION_SOUND_ENABLED_STORAGE_KEY, String(enabled));
};

// Per device: phone and laptop speakers differ. 0-100, squared so the slider's
// middle sounds like the middle; 29 is the 7.5% peak picked from the chime probe.
export const DEFAULT_NOTIFICATION_SOUND_VOLUME = 29;
const MAX_PEAK = 0.9;

export const getNotificationSoundVolume = (): number => {
  if (typeof localStorage === 'undefined') {
    return DEFAULT_NOTIFICATION_SOUND_VOLUME;
  }

  const stored = localStorage.getItem(NOTIFICATION_SOUND_VOLUME_STORAGE_KEY);
  const volume = stored === null ? NaN : Number(stored);
  return Number.isFinite(volume) ? Math.min(100, Math.max(0, volume)) : DEFAULT_NOTIFICATION_SOUND_VOLUME;
};

export const setNotificationSoundVolume = (volume: number): void => {
  if (typeof localStorage === 'undefined') {
    return;
  }

  localStorage.setItem(NOTIFICATION_SOUND_VOLUME_STORAGE_KEY, String(Math.round(Math.min(100, Math.max(0, volume)))));
};

type Tap = { at: number; frequency: number; duration: number };

// Softened square taps; picked on the S20 from the chime probe, 2026-10-12.
const LOWPASS_HZ = 2600;
// Silence before the first tap so other apps have ducked by the time it lands; 300 ms picked on the S20.
const LEAD_IN_SECONDS = 0.3;
const SAMPLE_RATE = 44100;
const FINISHED: Tap[] = [
  { at: 0, frequency: 880, duration: 0.12 },
  { at: 0.12, frequency: 1320, duration: 0.18 },
];
const NEEDS_YOU: Tap[] = [
  { at: 0, frequency: 1320, duration: 0.1 },
  { at: 0.14, frequency: 1320, duration: 0.1 },
  { at: 0.28, frequency: 1320, duration: 0.16 },
];

const scheduleTap = (context: BaseAudioContext, { at, frequency, duration }: Tap, peak: number): void => {
  const oscillator = context.createOscillator();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();
  const startsAt = LEAD_IN_SECONDS + at;

  oscillator.type = 'square';
  oscillator.frequency.setValueAtTime(frequency, startsAt);
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(LOWPASS_HZ, startsAt);

  // Shape the volume so the synthesized tone starts and stops cleanly.
  gain.gain.setValueAtTime(0.0001, startsAt);
  gain.gain.exponentialRampToValueAtTime(peak, startsAt + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, startsAt + duration);

  oscillator.connect(filter);
  filter.connect(gain);
  gain.connect(context.destination);
  oscillator.start(startsAt);
  oscillator.stop(startsAt + duration + 0.05);
};

const encodeWav = (samples: Float32Array): Blob => {
  const view = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const writeText = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
  };
  writeText(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeText(8, 'WAVE');
  writeText(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, SAMPLE_RATE, true);
  view.setUint32(28, SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, i) => view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, sample)) * 0x7fff, true));
  return new Blob([view], { type: 'audio/wav' });
};

// Rendered once per volume. Played through an <audio> element because media
// elements ask Android for audio focus, so other apps duck; Web Audio never does.
const clipCache = new Map<string, Promise<string>>();

const renderClip = (taps: Tap[], volume: number): Promise<string> => {
  const key = `${taps === FINISHED ? 'finished' : 'needs-you'}:${volume}`;
  let clip = clipCache.get(key);
  if (!clip) {
    const length = LEAD_IN_SECONDS + Math.max(...taps.map((tap) => tap.at + tap.duration)) + 0.1;
    const context = new OfflineAudioContext(1, Math.ceil(SAMPLE_RATE * length), SAMPLE_RATE);
    const peak = MAX_PEAK * (volume / 100) ** 2;
    taps.forEach((tap) => scheduleTap(context, tap, peak));
    clip = context.startRendering().then((buffer) => URL.createObjectURL(encodeWav(buffer.getChannelData(0))));
    clipCache.set(key, clip);
  }
  return clip;
};

const playTaps = async (taps: Tap[], force: boolean): Promise<void> => {
  const volume = getNotificationSoundVolume();
  if ((!force && !isNotificationSoundEnabled()) || volume === 0 || typeof OfflineAudioContext === 'undefined') {
    return;
  }

  try {
    await new Audio(await renderClip(taps, volume)).play();
  } catch (error) {
    // Browsers may block audio until the page receives a user gesture.
    console.warn('Unable to play notification sound:', error);
  }
};

/** Three quick taps: a session is blocked on you. */
export const playNotificationSound = ({ force = false } = {}): Promise<void> => playTaps(NEEDS_YOU, force);

/** Two rising taps: a run finished. */
export const playChatCompletionSound = ({ force = false } = {}): Promise<void> => playTaps(FINISHED, force);
