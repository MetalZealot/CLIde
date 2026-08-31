import { useEffect, useRef, useState } from "react";
import {
  ChevronDown,
  Cog,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";

import { useTts } from "../../../chat/hooks/useTts";
import { useVoiceConfig } from "../../../../hooks/useVoiceConfig";
import {
  fetchVoiceSettings,
  updateSpeechPace,
  updateVoiceSelection,
  updateVoiceSttSettings,
  updateVoiceTuning,
  type VoiceRuntimeSettings,
} from "../../../../lib/voiceApi";
import { formatPlaybackTime, voicePlayer } from "../../../../lib/voicePlayer";
import {
  SettingsGroup,
  SettingsChoicePopover,
  SettingsNavRow,
  SettingsRow,
  SettingsScreen,
  SettingsSegmentedControl,
  SettingsSelect,
  SettingsTextField,
  SettingsToggle,
} from "../primitives";

const PREVIEW_SCRIPT =
  "Welcome to CLIde. This preview checks natural pacing, sentence breaks, and the pause between ideas.";

type TuningDraft = {
  lengthScale: string;
  sentenceSilenceSeconds: string;
  structureSilenceSeconds: string;
};

const EMPTY_TUNING: TuningDraft = {
  lengthScale: "1",
  sentenceSilenceSeconds: "0",
  structureSilenceSeconds: "0",
};

function displayModelName(
  model: VoiceRuntimeSettings["tts"]["installedModels"][number],
): string {
  const source = model.id
    .replace(/^[a-z]{2}_[A-Z]{2}-/, "")
    .replace(/-(?:x-low|low|medium|high)$/, "");
  return source
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toLocaleUpperCase())
    .replace(/\bHfc\b/g, "HFC")
    .replace(/\bLibritts\b/g, "LibriTTS")
    .replace(/\bLjspeech\b/g, "LJSpeech");
}

function selectedVoiceLabel(
  settings: VoiceRuntimeSettings,
  voiceId: string | null,
): string | null {
  if (!voiceId) return null;
  const favorite = settings.tts.favorites.find((voice) => voice.id === voiceId);
  const sourceKey = favorite?.sourceKey ?? voiceId;
  const displayName = settings.tts.displayNames[sourceKey];
  if (displayName) return displayName;
  if (favorite) return favorite.label;
  const catalogVoice = settings.tts.catalog.find(
    (voice) => voice.id === voiceId,
  );
  if (catalogVoice) return catalogVoice.label;
  const [modelId, speakerId] = voiceId.split("#");
  const model = settings.tts.installedModels.find(
    (entry) => entry.id === modelId,
  );
  if (!model) return voiceId;
  const speakerNumber = speakerId === undefined ? null : Number(speakerId);
  const speakerName =
    speakerNumber === null || !Number.isInteger(speakerNumber)
      ? null
      : (model.speakers[speakerNumber] ?? `Speaker ${speakerNumber}`);
  return [displayModelName(model), speakerName].filter(Boolean).join(" · ");
}

function modelMetadata(
  settings: VoiceRuntimeSettings,
  modelId: string,
): { language: string; quality: string } {
  const model = settings.tts.installedModels.find(
    (entry) => entry.id === modelId,
  );
  if (!model) return { language: "", quality: "" };
  const knownQualities = new Set(["x-low", "low", "medium", "high"]);
  return {
    language: model.language.replace("_", "-"),
    quality: knownQualities.has(model.quality)
      ? model.quality.replace("-", " ")
      : "",
  };
}

function PreviewPlayer({ text }: { text: string }) {
  const { t } = useTranslation("settings");
  const {
    state,
    toggle,
    restart,
    error,
    currentTime,
    duration,
    generationElapsedSeconds,
  } = useTts(() => text);
  const actionLabel =
    state === "playing"
      ? t("voiceSettings.preview.pause")
      : state === "paused"
        ? t("voiceSettings.preview.resume")
        : state === "loading"
          ? t("voiceSettings.preview.cancel")
          : t("voiceSettings.preview.play");

  return (
    <div className="space-y-2">
      {(state === "loading" ||
        generationElapsedSeconds > 0 ||
        duration > 0) && (
        <div className="flex min-h-5 items-center justify-between gap-3 text-xs tabular-nums text-muted-foreground">
          <span>
            {state === "loading"
              ? t("voiceSettings.preview.generating", {
                  seconds: generationElapsedSeconds,
                })
              : generationElapsedSeconds > 0
                ? t("voiceSettings.preview.generated", {
                    seconds: generationElapsedSeconds,
                  })
                : null}
          </span>
          {duration > 0 && (
            <span className="flex-shrink-0">
              {formatPlaybackTime(currentTime)} / {formatPlaybackTime(duration)}
            </span>
          )}
        </div>
      )}
      <div className="flex min-h-11 items-center gap-2">
        <button
          type="button"
          onClick={toggle}
          disabled={!text.trim()}
          aria-label={actionLabel}
          className="inline-flex min-h-11 touch-manipulation items-center gap-2 rounded-lg border border-input bg-card px-3 py-2 text-sm font-medium text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
        >
          {state === "playing" ? (
            <Pause className="h-4 w-4" />
          ) : state === "loading" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Play className="h-4 w-4" />
          )}
          {actionLabel}
          {state === "loading" && <X className="h-4 w-4" />}
        </button>
        {(state === "playing" || state === "paused") && (
          <button
            type="button"
            onClick={restart}
            aria-label={t("voiceSettings.preview.restart")}
            className="inline-flex min-h-11 min-w-11 touch-manipulation items-center justify-center rounded-lg text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <RotateCcw className="h-4 w-4" />
          </button>
        )}
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </div>
  );
}

/** Runtime-owned daily voice controls; generic OpenAI fields stay under Custom backend. */
type ChatVoiceBackendScreenProps = {
  onOpenLibrary: () => void;
};

export default function ChatVoiceBackendScreen({
  onOpenLibrary,
}: ChatVoiceBackendScreenProps) {
  const { t } = useTranslation("settings");
  const { config, update } = useVoiceConfig();
  const [settings, setSettings] = useState<VoiceRuntimeSettings | null>(null);
  const [previewText, setPreviewText] = useState(PREVIEW_SCRIPT);
  const [paceDraft, setPaceDraft] = useState(1);
  const [tuningDraft, setTuningDraft] = useState<TuningDraft>(EMPTY_TUNING);
  const [isSavingTuning, setIsSavingTuning] = useState(false);
  const [initialPrompt, setInitialPrompt] = useState("");
  const [isSavingStt, setIsSavingStt] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const migratedLocalVoice = useRef(false);
  const paceSaveInFlight = useRef<number | null>(null);
  const usesServerBackend = !config.baseUrl.trim();
  const savedSpeechPace = settings?.tts.speechPace;
  const savedTuning = settings?.tts.tuning;
  const savedInitialPrompt = settings?.stt.settings.initialPrompt;

  useEffect(() => {
    if (!usesServerBackend) {
      setSettings(null);
      setIsLoading(false);
      return undefined;
    }
    let active = true;
    setIsLoading(true);
    setError(null);
    void fetchVoiceSettings()
      .then(async (loaded) => {
        if (!active) return;
        if (
          config.ttsVoice &&
          loaded.capabilities.voiceSelection &&
          !migratedLocalVoice.current
        ) {
          migratedLocalVoice.current = true;
          const migrated = await updateVoiceSelection(config.ttsVoice);
          if (!active) return;
          update({ ttsVoice: "" });
          setSettings(migrated);
          return;
        }
        setSettings(loaded);
      })
      .catch((cause) => {
        if (active)
          setError(
            cause instanceof Error
              ? cause.message
              : t("voiceSettings.loadError"),
          );
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });
    return () => {
      active = false;
    };
  }, [config.ttsVoice, t, update, usesServerBackend]);

  useEffect(() => {
    if (savedSpeechPace !== undefined) setPaceDraft(savedSpeechPace);
  }, [savedSpeechPace]);

  useEffect(() => {
    if (!savedTuning) return;
    setTuningDraft({
      lengthScale: String(savedTuning.lengthScale),
      sentenceSilenceSeconds: String(savedTuning.sentenceSilenceSeconds),
      structureSilenceSeconds: String(savedTuning.structureSilenceSeconds),
    });
  }, [savedTuning]);

  useEffect(() => {
    if (savedInitialPrompt !== undefined) setInitialPrompt(savedInitialPrompt);
  }, [savedInitialPrompt]);

  const selectedIsDailyChoice =
    settings?.tts.selectedVoice === null ||
    Boolean(
      settings?.tts.favorites.some(
        (voice) => voice.id === settings.tts.selectedVoice,
      ),
    );
  const currentVoiceLabel = settings
    ? selectedVoiceLabel(settings, settings.tts.selectedVoice)
    : null;
  const defaultVoiceLabel = settings
    ? selectedVoiceLabel(settings, settings.tts.defaultVoice)
    : null;
  const tuningVoiceLabel = settings?.tts.tuning
    ? selectedVoiceLabel(settings, settings.tts.tuning.voiceId)
    : null;
  const voiceOptions = settings
    ? [
        {
          value: "",
          label: defaultVoiceLabel ?? t("voiceSettings.picker.runtimeDefault"),
          detail: t("voiceSettings.picker.runtimeDefault"),
          group: t("voiceSettings.picker.defaultGroup"),
        },
        ...(!selectedIsDailyChoice &&
        settings.tts.selectedVoice &&
        currentVoiceLabel
          ? [
              {
                value: settings.tts.selectedVoice,
                label: currentVoiceLabel,
                group: t("voiceSettings.picker.currentGroup"),
              },
            ]
          : []),
        ...settings.tts.favorites.map((voice) => {
          const metadata = modelMetadata(settings, voice.modelId);
          const speakerLabel =
            voice.speakerName ??
            (voice.speakerId === null ? null : `Speaker ${voice.speakerId}`);
          const label =
            speakerLabel &&
            !voice.label
              .toLocaleLowerCase()
              .includes(speakerLabel.toLocaleLowerCase())
              ? `${voice.label} · ${speakerLabel}`
              : voice.label;
          const displayName = settings.tts.displayNames[voice.sourceKey];
          return {
            value: voice.id,
            label: displayName ?? label,
            detail: [
              displayName ? label : "",
              metadata.language,
              metadata.quality,
            ]
              .filter(Boolean)
              .join(" · "),
            keywords: label,
            group: t("voiceSettings.picker.favoritesGroup"),
          };
        }),
      ]
    : [];

  const selectVoice = async (value: string) => {
    if (!settings || (value || null) === settings.tts.selectedVoice) return;
    voicePlayer.stop();
    setIsSaving(true);
    setError(null);
    try {
      const updated = await updateVoiceSelection(value || null);
      update({ ttsVoice: "" });
      setSettings(updated);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : t("voiceSettings.saveError"),
      );
    } finally {
      setIsSaving(false);
    }
  };

  const updatePreviewText = (value: string) => {
    voicePlayer.stop();
    setPreviewText(value);
  };

  const savePace = async (value: number) => {
    if (
      !settings ||
      Math.abs(settings.tts.speechPace - value) < 0.001 ||
      paceSaveInFlight.current === value
    )
      return;
    voicePlayer.stop();
    paceSaveInFlight.current = value;
    setError(null);
    try {
      const updated = await updateSpeechPace(value);
      setSettings(updated);
    } catch (cause) {
      setPaceDraft(settings.tts.speechPace);
      setError(
        cause instanceof Error ? cause.message : t("voiceSettings.saveError"),
      );
    } finally {
      paceSaveInFlight.current = null;
    }
  };

  const saveTuning = async (reset: boolean) => {
    if (!settings?.tts.tuning) return;
    const values = {
      lengthScale: Number(tuningDraft.lengthScale),
      sentenceSilenceSeconds: Number(tuningDraft.sentenceSilenceSeconds),
      structureSilenceSeconds: Number(tuningDraft.structureSilenceSeconds),
    };
    if (
      !reset &&
      (!Number.isFinite(values.lengthScale) ||
        values.lengthScale < 0.35 ||
        values.lengthScale > 2.5 ||
        !Number.isFinite(values.sentenceSilenceSeconds) ||
        values.sentenceSilenceSeconds < 0 ||
        values.sentenceSilenceSeconds > 1.5 ||
        !Number.isFinite(values.structureSilenceSeconds) ||
        values.structureSilenceSeconds < 0 ||
        values.structureSilenceSeconds > 2)
    ) {
      setError(t("voiceSettings.tuning.invalid"));
      return;
    }
    if (reset && !window.confirm(t("voiceSettings.tuning.resetConfirm")))
      return;
    voicePlayer.stop();
    setIsSavingTuning(true);
    setError(null);
    try {
      setSettings(await updateVoiceTuning(reset ? null : values));
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : t("voiceSettings.saveError"),
      );
    } finally {
      setIsSavingTuning(false);
    }
  };

  const saveStt = async (
    patch: Partial<Omit<VoiceRuntimeSettings["stt"]["settings"], "capture">> & {
      capture?: Partial<VoiceRuntimeSettings["stt"]["settings"]["capture"]>;
    },
  ) => {
    if (!settings) return;
    const next = {
      ...settings.stt.settings,
      ...patch,
      capture: {
        ...settings.stt.settings.capture,
        ...patch.capture,
      },
    };
    setIsSavingStt(true);
    setError(null);
    try {
      setSettings(await updateVoiceSttSettings(next));
    } catch (cause) {
      setInitialPrompt(settings.stt.settings.initialPrompt);
      setError(
        cause instanceof Error ? cause.message : t("voiceSettings.saveError"),
      );
    } finally {
      setIsSavingStt(false);
    }
  };

  return (
    <SettingsScreen>
      {usesServerBackend && (
        <>
          <SettingsGroup title={t("voiceSettings.picker.sectionTitle")} divided>
            {isLoading ? (
              <div className="flex min-h-14 items-center gap-2 px-4 py-3 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("voiceSettings.loadingVoices")}
              </div>
            ) : !settings?.capabilities.voiceSelection ? (
              <p className="px-4 py-4 text-sm text-muted-foreground">
                {t("voiceSettings.picker.unavailable")}
              </p>
            ) : (
              <SettingsRow stacked label={t("voiceSettings.picker.selected")}>
                <SettingsChoicePopover
                  value={settings.tts.selectedVoice ?? ""}
                  options={voiceOptions}
                  onChange={(voice) => void selectVoice(voice)}
                  ariaLabel={t("voiceSettings.picker.selected")}
                  searchable={voiceOptions.length > 8}
                  searchPlaceholder={t("voiceSettings.picker.searchFavorites")}
                  disabled={isSaving}
                  showSelectedDetail={false}
                  stackedOptionDetails
                  className="w-full"
                />
              </SettingsRow>
            )}

            {settings?.capabilities.installedVoices && (
              <SettingsNavRow
                label={t("voiceSettings.library.title")}
                description={t("voiceSettings.library.description")}
                onClick={onOpenLibrary}
              />
            )}
          </SettingsGroup>

          {isSaving && (
            <p className="text-xs text-muted-foreground">
              {t("voiceSettings.saving")}
            </p>
          )}

          {settings?.capabilities.voiceTuning && (
            <SettingsGroup title={t("voiceSettings.pace.sectionTitle")} divided>
              <SettingsRow
                stacked
                label={t("voiceSettings.pace.label")}
                description={t("voiceSettings.pace.description")}
              >
                <div className="flex w-full items-center gap-2">
                  <input
                    type="range"
                    min="0.75"
                    max="1.5"
                    step="0.05"
                    value={paceDraft}
                    onChange={(event) =>
                      setPaceDraft(Number(event.target.value))
                    }
                    onPointerUp={(event) =>
                      void savePace(Number(event.currentTarget.value))
                    }
                    onKeyUp={(event) =>
                      void savePace(Number(event.currentTarget.value))
                    }
                    onBlur={(event) =>
                      void savePace(Number(event.currentTarget.value))
                    }
                    aria-label={t("voiceSettings.pace.label")}
                    className="h-11 min-w-12 flex-1 touch-manipulation accent-primary"
                  />
                  <output className="w-14 text-right text-sm font-medium tabular-nums text-foreground">
                    {paceDraft.toFixed(2)}×
                  </output>
                  <button
                    type="button"
                    onClick={() => {
                      setPaceDraft(1);
                      void savePace(1);
                    }}
                    aria-label={t("voiceSettings.pace.reset")}
                    className="flex min-h-11 min-w-11 touch-manipulation items-center justify-center rounded-lg text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <RotateCcw className="h-4 w-4" />
                  </button>
                </div>
              </SettingsRow>

              {settings.tts.tuning && (
                <details className="group">
                  <summary className="flex min-h-12 cursor-pointer touch-manipulation list-none items-center gap-3 px-4 py-3 text-sm font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                    {t("voiceSettings.tuning.title")}
                    <span className="ml-auto max-w-[50%] truncate text-xs font-normal text-muted-foreground">
                      {tuningVoiceLabel ?? settings.tts.tuning.voiceId}
                    </span>
                    <ChevronDown className="h-4 w-4 flex-shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
                  </summary>
                  <div className="space-y-4 border-t border-border p-4">
                    <div className="grid gap-4 sm:grid-cols-3">
                      <label className="space-y-1 text-sm font-medium text-foreground">
                        <span>{t("voiceSettings.tuning.lengthScale")}</span>
                        <input
                          type="number"
                          min="0.35"
                          max="2.5"
                          step="0.05"
                          value={tuningDraft.lengthScale}
                          onChange={(event) =>
                            setTuningDraft((current) => ({
                              ...current,
                              lengthScale: event.target.value,
                            }))
                          }
                          className="w-full rounded-lg border border-input bg-card p-2.5 text-base text-foreground focus:border-primary focus:ring-1 focus:ring-primary"
                        />
                        <span className="block text-xs font-normal text-muted-foreground">
                          {t("voiceSettings.tuning.lengthScaleHint")}
                        </span>
                      </label>
                      <label className="space-y-1 text-sm font-medium text-foreground">
                        <span>{t("voiceSettings.tuning.sentenceSilence")}</span>
                        <input
                          type="number"
                          min="0"
                          max="1.5"
                          step="0.05"
                          value={tuningDraft.sentenceSilenceSeconds}
                          onChange={(event) =>
                            setTuningDraft((current) => ({
                              ...current,
                              sentenceSilenceSeconds: event.target.value,
                            }))
                          }
                          className="w-full rounded-lg border border-input bg-card p-2.5 text-base text-foreground focus:border-primary focus:ring-1 focus:ring-primary"
                        />
                        <span className="block text-xs font-normal text-muted-foreground">
                          {t("voiceSettings.tuning.seconds")}
                        </span>
                      </label>
                      <label className="space-y-1 text-sm font-medium text-foreground">
                        <span>
                          {t("voiceSettings.tuning.structureSilence")}
                        </span>
                        <input
                          type="number"
                          min="0"
                          max="2"
                          step="0.05"
                          value={tuningDraft.structureSilenceSeconds}
                          onChange={(event) =>
                            setTuningDraft((current) => ({
                              ...current,
                              structureSilenceSeconds: event.target.value,
                            }))
                          }
                          className="w-full rounded-lg border border-input bg-card p-2.5 text-base text-foreground focus:border-primary focus:ring-1 focus:ring-primary"
                        />
                        <span className="block text-xs font-normal text-muted-foreground">
                          {t("voiceSettings.tuning.seconds")}
                        </span>
                      </label>
                    </div>
                    <div className="flex flex-wrap justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => void saveTuning(true)}
                        disabled={isSavingTuning}
                        className="min-h-11 touch-manipulation rounded-lg px-3 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                      >
                        {t("voiceSettings.tuning.reset")}
                      </button>
                      <button
                        type="button"
                        onClick={() => void saveTuning(false)}
                        disabled={isSavingTuning}
                        className="min-h-11 touch-manipulation rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
                      >
                        {isSavingTuning
                          ? t("voiceSettings.saving")
                          : t("voiceSettings.tuning.save")}
                      </button>
                    </div>
                  </div>
                </details>
              )}
            </SettingsGroup>
          )}

          <SettingsGroup title={t("voiceSettings.preview.title")}>
            <SettingsRow stacked label={t("voiceSettings.preview.script")}>
              <textarea
                value={previewText}
                onChange={(event) => updatePreviewText(event.target.value)}
                aria-label={t("voiceSettings.preview.script")}
                rows={4}
                className="w-full resize-y rounded-lg border border-input bg-card p-3 text-base text-foreground placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary"
              />
              <div className="mt-3">
                <PreviewPlayer text={previewText} />
              </div>
            </SettingsRow>
          </SettingsGroup>

          {settings?.capabilities.sttSettings && (
            <SettingsGroup
              title={t("voiceSettings.dictation.title")}
              divided
              action={
                isSavingStt ? (
                  <span className="text-xs text-muted-foreground">
                    {t("voiceSettings.saving")}
                  </span>
                ) : undefined
              }
            >
              <SettingsRow stacked label={t("voiceSettings.dictation.model")}>
                <SettingsSelect
                  value={settings.stt.settings.model}
                  options={settings.stt.models
                    .filter((model) => model.installed)
                    .map((model) => ({
                      value: model.id,
                      label:
                        model.id === "tiny.en"
                          ? t("voiceSettings.dictation.fastModel", {
                              model: model.id,
                            })
                          : model.id === "base.en"
                            ? t("voiceSettings.dictation.accurateModel", {
                                model: model.id,
                              })
                            : model.id,
                    }))}
                  onChange={(model) => void saveStt({ model })}
                  ariaLabel={t("voiceSettings.dictation.model")}
                  disabled={isSavingStt}
                />
              </SettingsRow>
              <SettingsRow
                stacked
                label={t("voiceSettings.dictation.decoder")}
                description={t("voiceSettings.dictation.decoderDescription")}
              >
                <SettingsSegmentedControl
                  value={settings.stt.settings.decoderPreset}
                  options={[
                    {
                      value: "standard",
                      label: t("voiceSettings.dictation.standard"),
                    },
                    {
                      value: "careful",
                      label: t("voiceSettings.dictation.careful"),
                    },
                  ]}
                  onChange={(decoderPreset) => void saveStt({ decoderPreset })}
                  ariaLabel={t("voiceSettings.dictation.decoder")}
                  className="w-full"
                />
              </SettingsRow>
              <SettingsRow
                stacked
                label={t("voiceSettings.dictation.vocabulary")}
                description={t("voiceSettings.dictation.vocabularyDescription")}
              >
                <textarea
                  value={initialPrompt}
                  onChange={(event) => setInitialPrompt(event.target.value)}
                  onBlur={() => {
                    if (initialPrompt !== settings.stt.settings.initialPrompt) {
                      void saveStt({ initialPrompt });
                    }
                  }}
                  maxLength={400}
                  rows={2}
                  placeholder={t(
                    "voiceSettings.dictation.vocabularyPlaceholder",
                  )}
                  aria-label={t("voiceSettings.dictation.vocabulary")}
                  className="w-full resize-y rounded-lg border border-input bg-card p-3 text-base text-foreground placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary"
                />
              </SettingsRow>

              <details className="group">
                <summary className="flex min-h-12 cursor-pointer touch-manipulation list-none items-center gap-3 px-4 py-3 text-sm font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
                  {t("voiceSettings.dictation.advanced")}
                  <ChevronDown className="ml-auto h-4 w-4 flex-shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
                </summary>
                <div className="divide-y divide-border border-t border-border">
                  <SettingsRow
                    label={t("voiceSettings.dictation.noiseSuppression")}
                  >
                    <SettingsToggle
                      checked={settings.stt.settings.capture.noiseSuppression}
                      onChange={(noiseSuppression) =>
                        void saveStt({ capture: { noiseSuppression } })
                      }
                      ariaLabel={t("voiceSettings.dictation.noiseSuppression")}
                    />
                  </SettingsRow>
                  <SettingsRow
                    label={t("voiceSettings.dictation.echoCancellation")}
                  >
                    <SettingsToggle
                      checked={settings.stt.settings.capture.echoCancellation}
                      onChange={(echoCancellation) =>
                        void saveStt({ capture: { echoCancellation } })
                      }
                      ariaLabel={t("voiceSettings.dictation.echoCancellation")}
                    />
                  </SettingsRow>
                  <SettingsRow
                    stacked
                    label={t("voiceSettings.dictation.threads")}
                  >
                    <SettingsSelect
                      value={String(settings.stt.settings.threads)}
                      options={[1, 2, 3, 4].map((threads) => ({
                        value: String(threads),
                        label: String(threads),
                      }))}
                      onChange={(threads) =>
                        void saveStt({ threads: Number(threads) })
                      }
                      ariaLabel={t("voiceSettings.dictation.threads")}
                      disabled={isSavingStt}
                    />
                  </SettingsRow>
                  <SettingsRow label={t("voiceSettings.dictation.autoGain")}>
                    <SettingsToggle
                      checked={settings.stt.settings.capture.autoGainControl}
                      onChange={(autoGainControl) =>
                        void saveStt({ capture: { autoGainControl } })
                      }
                      ariaLabel={t("voiceSettings.dictation.autoGain")}
                    />
                  </SettingsRow>
                </div>
              </details>
            </SettingsGroup>
          )}
        </>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <details
        open={!usesServerBackend}
        className="group rounded-xl border border-border bg-card/50"
      >
        <summary className="flex min-h-12 cursor-pointer touch-manipulation list-none items-center gap-3 px-4 py-3 text-sm font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring [&::-webkit-details-marker]:hidden">
          <Cog className="h-4 w-4 text-muted-foreground" />
          {t("voiceSettings.custom.title")}
          <span className="ml-auto text-xs font-normal text-muted-foreground">
            {usesServerBackend
              ? t("voiceSettings.custom.inactive")
              : t("voiceSettings.custom.active")}
          </span>
          <ChevronDown className="h-4 w-4 flex-shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
        </summary>
        <div className="divide-y divide-border border-t border-border">
          <SettingsRow stacked label={t("voiceSettings.baseUrl")}>
            <SettingsTextField
              value={config.baseUrl}
              onChange={(value) => update({ baseUrl: value })}
              placeholder="https://api.openai.com/v1"
              ariaLabel={t("voiceSettings.baseUrl")}
            />
          </SettingsRow>
          <SettingsRow stacked label={t("voiceSettings.apiKey")}>
            <SettingsTextField
              value={config.apiKey}
              onChange={(value) => update({ apiKey: value })}
              type="password"
              autoComplete="off"
              placeholder="sk-…"
              ariaLabel={t("voiceSettings.apiKey")}
            />
          </SettingsRow>
          <SettingsRow stacked label={t("voiceSettings.sttModel")}>
            <SettingsTextField
              value={config.sttModel}
              onChange={(value) => update({ sttModel: value })}
              placeholder="whisper-1"
              ariaLabel={t("voiceSettings.sttModel")}
            />
          </SettingsRow>
          <SettingsRow stacked label={t("voiceSettings.ttsModel")}>
            <SettingsTextField
              value={config.ttsModel}
              onChange={(value) => update({ ttsModel: value })}
              placeholder="tts-1"
              ariaLabel={t("voiceSettings.ttsModel")}
            />
          </SettingsRow>
          <SettingsRow stacked label={t("voiceSettings.voice")}>
            <SettingsTextField
              value={config.ttsVoice}
              onChange={(value) => update({ ttsVoice: value })}
              placeholder="alloy"
              ariaLabel={t("voiceSettings.voice")}
            />
          </SettingsRow>
          <SettingsRow stacked label={t("voiceSettings.format")}>
            <SettingsTextField
              value={config.ttsFormat}
              onChange={(value) => update({ ttsFormat: value })}
              placeholder="mp3"
              ariaLabel={t("voiceSettings.format")}
            />
          </SettingsRow>
          <p className="px-4 py-3 text-xs text-muted-foreground">
            {t("voiceSettings.note")}
          </p>
        </div>
      </details>
    </SettingsScreen>
  );
}
