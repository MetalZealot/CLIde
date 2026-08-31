import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Loader2, Search, Star } from "lucide-react";
import { useTranslation } from "react-i18next";

import {
  fetchVoiceSettings,
  updateVoiceDefault,
  updateVoiceFavorite,
  updateVoiceSelection,
  type VoiceRuntimeSettings,
} from "../../../../lib/voiceApi";
import { cn } from "../../../../lib/utils";
import {
  SettingsGroup,
  SettingsScreen,
  SettingsSegmentedControl,
} from "../primitives";

type InstalledModel = VoiceRuntimeSettings["tts"]["installedModels"][number];

type VoiceFamily = {
  key: string;
  name: string;
  language: string;
  models: InstalledModel[];
};

type SpeakerChoice = {
  id: number | null;
  voiceId: string;
  label: string;
};

type SpeakerView = "all" | "favorites";

type VoiceChoiceRowProps = {
  choice: SpeakerChoice;
  detail?: string;
  selected: boolean;
  runtimeDefault: boolean;
  favorite: boolean;
  disabled: boolean;
  onSelect: () => void;
  onToggleFavorite: () => void;
};

const SPEAKER_PAGE_SIZE = 32;
const QUALITY_ORDER = new Map([
  ["x-low", 0],
  ["low", 1],
  ["medium", 2],
  ["high", 3],
]);

function modelName(model: InstalledModel): string {
  return model.id
    .replace(/^[a-z]{2}_[A-Z]{2}-/, "")
    .replace(/-(?:x-low|low|medium|high)$/, "")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toLocaleUpperCase())
    .replace(/\bHfc\b/g, "HFC")
    .replace(/\bLibritts\b/g, "LibriTTS")
    .replace(/\bLjspeech\b/g, "LJSpeech");
}

function qualityLabel(model: InstalledModel): string {
  if (!QUALITY_ORDER.has(model.quality)) return model.quality || model.id;
  return model.quality
    .replace("-", " ")
    .replace(/\b\w/g, (letter) => letter.toLocaleUpperCase());
}

function languageLabel(model: InstalledModel): string {
  return model.language.replace("_", "-") || model.region;
}

function groupModelFamilies(models: InstalledModel[]): VoiceFamily[] {
  const families = new Map<string, VoiceFamily>();
  models.forEach((model) => {
    const name = modelName(model);
    const language = languageLabel(model);
    const key = `${language.toLocaleLowerCase()}::${name.toLocaleLowerCase()}`;
    const family = families.get(key) ?? { key, name, language, models: [] };
    family.models.push(model);
    families.set(key, family);
  });
  return [...families.values()]
    .map((family) => ({
      ...family,
      models: family.models.sort(
        (left, right) =>
          (QUALITY_ORDER.get(left.quality) ?? 99) -
            (QUALITY_ORDER.get(right.quality) ?? 99) ||
          left.id.localeCompare(right.id),
      ),
    }))
    .sort(
      (left, right) =>
        left.name.localeCompare(right.name) ||
        left.language.localeCompare(right.language),
    );
}

function sourceKeyForVoice(
  settings: VoiceRuntimeSettings,
  voiceId: string | null,
): string | null {
  if (!voiceId) return null;
  return (
    settings.tts.favorites.find((favorite) => favorite.id === voiceId)
      ?.sourceKey ?? voiceId
  );
}

function modelIdForVoice(
  settings: VoiceRuntimeSettings,
  voiceId: string | null,
): string | null {
  return sourceKeyForVoice(settings, voiceId)?.split("#")[0] ?? null;
}

function speakerChoices(
  model: InstalledModel,
  page: number,
  query: string,
): SpeakerChoice[] {
  if (model.numSpeakers <= 1) {
    return [{ id: null, voiceId: model.id, label: qualityLabel(model) }];
  }

  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (model.speakers.length > 0) {
    return model.speakers
      .map((speaker, id) => ({
        id,
        voiceId: `${model.id}#${id}`,
        label: speaker,
      }))
      .filter(
        (speaker) =>
          !normalizedQuery ||
          speaker.label.toLocaleLowerCase().includes(normalizedQuery) ||
          String(speaker.id) === normalizedQuery,
      );
  }

  if (normalizedQuery) {
    const speakerId = Number(normalizedQuery);
    return Number.isInteger(speakerId) &&
      speakerId >= 0 &&
      speakerId < model.numSpeakers
      ? [
          {
            id: speakerId,
            voiceId: `${model.id}#${speakerId}`,
            label: `Speaker ${speakerId}`,
          },
        ]
      : [];
  }

  const start = page * SPEAKER_PAGE_SIZE;
  const end = Math.min(start + SPEAKER_PAGE_SIZE, model.numSpeakers);
  return Array.from({ length: end - start }, (_, index) => {
    const id = start + index;
    return { id, voiceId: `${model.id}#${id}`, label: `Speaker ${id}` };
  });
}

function favoriteSpeakerChoices(
  settings: VoiceRuntimeSettings,
  model: InstalledModel,
  query: string,
): SpeakerChoice[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return settings.tts.favorites
    .filter(
      (favorite) =>
        favorite.modelId === model.id && favorite.speakerId !== null,
    )
    .map((favorite) => {
      const id = favorite.speakerId as number;
      const label =
        favorite.speakerName ?? model.speakers[id] ?? `Speaker ${id}`;
      return { id, voiceId: favorite.sourceKey, label };
    })
    .filter(
      (speaker) =>
        !normalizedQuery ||
        speaker.label.toLocaleLowerCase().includes(normalizedQuery) ||
        String(speaker.id) === normalizedQuery,
    )
    .sort((left, right) => (left.id ?? 0) - (right.id ?? 0));
}

function VoiceChoiceRow({
  choice,
  detail,
  selected,
  runtimeDefault,
  favorite,
  disabled,
  onSelect,
  onToggleFavorite,
}: VoiceChoiceRowProps) {
  const { t } = useTranslation("settings");
  return (
    <div className="flex min-h-14 items-center">
      <button
        type="button"
        onClick={onSelect}
        disabled={disabled}
        className="flex min-h-14 min-w-0 flex-1 touch-manipulation items-center gap-3 px-4 py-3 text-left hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-60"
      >
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-foreground">
            {choice.label}
          </span>
          {detail && (
            <span className="mt-0.5 block text-xs text-muted-foreground">
              {detail}
            </span>
          )}
        </span>
        {selected && (
          <span className="text-xs font-medium text-primary">
            {t("voiceSettings.library.selected")}
          </span>
        )}
        {runtimeDefault && (
          <span className="text-xs text-muted-foreground">
            {t("voiceSettings.library.runtimeDefault")}
          </span>
        )}
      </button>
      <button
        type="button"
        onClick={onToggleFavorite}
        disabled={disabled}
        aria-label={t(
          favorite
            ? "voiceSettings.library.unfavorite"
            : "voiceSettings.library.favorite",
          { voice: choice.label },
        )}
        className="flex min-h-12 min-w-12 touch-manipulation items-center justify-center text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring disabled:opacity-60"
      >
        <Star
          className={cn("h-5 w-5", favorite && "fill-current text-primary")}
        />
      </button>
    </div>
  );
}

export default function ChatVoiceLibraryScreen() {
  const { t } = useTranslation("settings");
  const [settings, setSettings] = useState<VoiceRuntimeSettings | null>(null);
  const [selectedFamilyKey, setSelectedFamilyKey] = useState<string | null>(
    null,
  );
  const [activeModelId, setActiveModelId] = useState<string | null>(null);
  const [modelQuery, setModelQuery] = useState("");
  const [speakerQuery, setSpeakerQuery] = useState("");
  const [speakerPage, setSpeakerPage] = useState(0);
  const [speakerView, setSpeakerView] = useState<SpeakerView>("all");
  const [busyVoiceId, setBusyVoiceId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void fetchVoiceSettings()
      .then((loaded) => {
        if (active) setSettings(loaded);
      })
      .catch((cause) => {
        if (active)
          setError(
            cause instanceof Error
              ? cause.message
              : t("voiceSettings.loadError"),
          );
      });
    return () => {
      active = false;
    };
  }, [t]);

  const families = useMemo(
    () => groupModelFamilies(settings?.tts.installedModels ?? []),
    [settings],
  );
  const filteredFamilies = useMemo(() => {
    const query = modelQuery.trim().toLocaleLowerCase();
    return families.filter(
      (family) =>
        !query ||
        [
          family.name,
          family.language,
          ...family.models.flatMap((model) => [
            model.id,
            model.region,
            model.quality,
          ]),
        ].some((value) => value.toLocaleLowerCase().includes(query)),
    );
  }, [families, modelQuery]);
  const selectedFamily =
    families.find((family) => family.key === selectedFamilyKey) ?? null;
  const activeModel =
    selectedFamily?.models.find((model) => model.id === activeModelId) ??
    selectedFamily?.models[0] ??
    null;
  const selectedSourceKey = settings
    ? sourceKeyForVoice(settings, settings.tts.selectedVoice)
    : null;
  const defaultSourceKey = settings
    ? sourceKeyForVoice(settings, settings.tts.defaultVoice)
    : null;
  const selectedModelId = settings
    ? modelIdForVoice(settings, settings.tts.selectedVoice)
    : null;
  const defaultModelId = settings
    ? modelIdForVoice(settings, settings.tts.defaultVoice)
    : null;
  const favoriteKeys = new Set(
    settings?.tts.favorites.map((favorite) => favorite.sourceKey) ?? [],
  );
  const familyHasMultipleSpeakers =
    selectedFamily?.models.some((model) => model.numSpeakers > 1) ?? false;
  const choices =
    settings && selectedFamily && activeModel
      ? familyHasMultipleSpeakers
        ? speakerView === "favorites"
          ? favoriteSpeakerChoices(settings, activeModel, speakerQuery)
          : speakerChoices(activeModel, speakerPage, speakerQuery)
        : selectedFamily.models.map((model) => ({
            id: null,
            voiceId: model.id,
            label: qualityLabel(model),
          }))
      : [];

  const chooseVoice = async (voiceId: string) => {
    setBusyVoiceId(voiceId);
    setError(null);
    setNotice(null);
    try {
      setSettings(await updateVoiceSelection(voiceId));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t("voiceSettings.library.selectFailed"),
      );
    } finally {
      setBusyVoiceId(null);
    }
  };

  const toggleFavorite = async (voiceId: string, favorite: boolean) => {
    setBusyVoiceId(voiceId);
    setError(null);
    setNotice(null);
    try {
      await updateVoiceFavorite(voiceId, favorite);
      setSettings(await fetchVoiceSettings());
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t("voiceSettings.library.favoriteFailed"),
      );
    } finally {
      setBusyVoiceId(null);
    }
  };

  const setDefault = async () => {
    if (!selectedSourceKey) return;
    setBusyVoiceId(selectedSourceKey);
    setError(null);
    setNotice(null);
    try {
      setSettings(await updateVoiceDefault(selectedSourceKey));
      setNotice(t("voiceSettings.library.defaultSaved"));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : t("voiceSettings.library.defaultFailed"),
      );
    } finally {
      setBusyVoiceId(null);
    }
  };

  const openFamily = (family: VoiceFamily) => {
    const currentModel =
      family.models.find((model) => model.id === selectedModelId) ??
      family.models.find((model) => model.id === defaultModelId) ??
      family.models[0];
    setSelectedFamilyKey(family.key);
    setActiveModelId(currentModel.id);
    setSpeakerQuery("");
    setSpeakerPage(0);
    setSpeakerView("all");
    setError(null);
    setNotice(null);
  };

  const defaultAction =
    selectedSourceKey && selectedSourceKey !== defaultSourceKey ? (
      <button
        type="button"
        onClick={() => void setDefault()}
        disabled={busyVoiceId !== null}
        className="min-h-11 w-full touch-manipulation rounded-lg border border-input bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
      >
        {t("voiceSettings.library.setDefault")}
      </button>
    ) : null;

  if (!settings) {
    return (
      <SettingsScreen>
        <div className="flex min-h-32 items-center justify-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          {t("voiceSettings.loadingVoices")}
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
      </SettingsScreen>
    );
  }

  if (selectedFamily && activeModel) {
    const pageStart = speakerPage * SPEAKER_PAGE_SIZE + 1;
    const pageEnd = Math.min(
      (speakerPage + 1) * SPEAKER_PAGE_SIZE,
      activeModel.numSpeakers,
    );
    const hasNumericPages =
      activeModel.numSpeakers > 1 &&
      activeModel.speakers.length === 0 &&
      speakerView === "all" &&
      !speakerQuery.trim();
    const activeFavoriteCount = settings.tts.favorites.filter(
      (favorite) => favorite.modelId === activeModel.id,
    ).length;
    const selectedBelongsToFamily = selectedFamily.models.some(
      (model) => model.id === selectedModelId,
    );
    return (
      <SettingsScreen>
        <button
          type="button"
          onClick={() => {
            setSelectedFamilyKey(null);
            setActiveModelId(null);
            setSpeakerQuery("");
            setSpeakerPage(0);
            setSpeakerView("all");
            setError(null);
            setNotice(null);
          }}
          className="inline-flex min-h-11 touch-manipulation items-center gap-1 rounded-lg px-2 text-sm font-medium text-muted-foreground hover:bg-accent/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronLeft className="h-4 w-4" />
          {t("voiceSettings.library.allModels")}
        </button>

        <div className="px-1">
          <h3 className="text-base font-semibold text-foreground">
            {selectedFamily.name}
          </h3>
          <p className="text-sm text-muted-foreground">
            {selectedFamily.language}
          </p>
        </div>

        {familyHasMultipleSpeakers && selectedFamily.models.length > 1 && (
          <SettingsSegmentedControl
            value={activeModel.id}
            options={selectedFamily.models.map((model) => ({
              value: model.id,
              label: qualityLabel(model),
            }))}
            onChange={(modelId) => {
              setActiveModelId(modelId);
              setSpeakerQuery("");
              setSpeakerPage(0);
              setSpeakerView("all");
            }}
            ariaLabel={t("voiceSettings.library.size")}
            className="w-full"
          />
        )}

        {activeModel.numSpeakers > 1 && (
          <>
            <SettingsSegmentedControl
              value={speakerView}
              options={[
                { value: "all", label: t("voiceSettings.library.allSpeakers") },
                {
                  value: "favorites",
                  label: t("voiceSettings.library.favorites", {
                    count: activeFavoriteCount,
                  }),
                },
              ]}
              onChange={(view) => {
                setSpeakerView(view);
                setSpeakerQuery("");
                setSpeakerPage(0);
              }}
              ariaLabel={t("voiceSettings.library.speakerView")}
              className="w-full"
            />
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                type="search"
                value={speakerQuery}
                onChange={(event) => {
                  setSpeakerQuery(event.target.value);
                  setSpeakerPage(0);
                }}
                placeholder={t("voiceSettings.library.searchSpeakers")}
                aria-label={t("voiceSettings.library.searchSpeakers")}
                className="w-full touch-manipulation rounded-lg border border-input bg-card py-2 pl-9 pr-3 text-base text-foreground placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary"
              />
            </div>
          </>
        )}

        <SettingsGroup divided>
          {choices.length > 0 ? (
            choices.map((choice) => (
              <VoiceChoiceRow
                key={choice.voiceId}
                choice={choice}
                selected={choice.voiceId === selectedSourceKey}
                runtimeDefault={choice.voiceId === defaultSourceKey}
                favorite={favoriteKeys.has(choice.voiceId)}
                disabled={busyVoiceId !== null}
                onSelect={() => void chooseVoice(choice.voiceId)}
                onToggleFavorite={() =>
                  void toggleFavorite(
                    choice.voiceId,
                    !favoriteKeys.has(choice.voiceId),
                  )
                }
              />
            ))
          ) : (
            <p className="px-4 py-4 text-sm text-muted-foreground">
              {t(
                speakerView === "favorites"
                  ? "voiceSettings.library.emptyFavorites"
                  : "voiceSettings.library.emptySpeakers",
              )}
            </p>
          )}
        </SettingsGroup>

        {hasNumericPages && (
          <div className="flex items-center justify-between gap-3">
            <button
              type="button"
              disabled={speakerPage === 0}
              onClick={() => setSpeakerPage((page) => Math.max(0, page - 1))}
              className="min-h-11 touch-manipulation rounded-lg px-3 text-sm text-muted-foreground hover:bg-accent/50 disabled:opacity-40"
            >
              {t("voiceSettings.library.previous")}
            </button>
            <span className="text-xs tabular-nums text-muted-foreground">
              {t("voiceSettings.library.page", {
                start: pageStart,
                end: pageEnd,
                count: activeModel.numSpeakers,
              })}
            </span>
            <button
              type="button"
              disabled={pageEnd >= activeModel.numSpeakers}
              onClick={() => setSpeakerPage((page) => page + 1)}
              className="min-h-11 touch-manipulation rounded-lg px-3 text-sm text-muted-foreground hover:bg-accent/50 disabled:opacity-40"
            >
              {t("voiceSettings.library.next")}
            </button>
          </div>
        )}

        {selectedBelongsToFamily && defaultAction}
        {notice && <p className="text-sm text-primary">{notice}</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </SettingsScreen>
    );
  }

  return (
    <SettingsScreen>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={modelQuery}
          onChange={(event) => setModelQuery(event.target.value)}
          placeholder={t("voiceSettings.library.searchModels")}
          aria-label={t("voiceSettings.library.searchModels")}
          className="w-full touch-manipulation rounded-lg border border-input bg-card py-2 pl-9 pr-3 text-base text-foreground placeholder:text-muted-foreground focus:border-primary focus:ring-1 focus:ring-primary"
        />
      </div>

      {defaultAction}
      {notice && <p className="text-sm text-primary">{notice}</p>}
      {error && <p className="text-sm text-destructive">{error}</p>}

      <SettingsGroup divided>
        {filteredFamilies.length > 0 ? (
          filteredFamilies.map((family) => {
            const directModel =
              family.models.length === 1 && family.models[0].numSpeakers === 1
                ? family.models[0]
                : null;
            const familyModelIds = new Set(
              family.models.map((model) => model.id),
            );
            const isSelectedFamily = selectedModelId
              ? familyModelIds.has(selectedModelId)
              : false;
            const isDefaultFamily = defaultModelId
              ? familyModelIds.has(defaultModelId)
              : false;
            const favoriteCount = settings.tts.favorites.filter((favorite) =>
              familyModelIds.has(favorite.modelId),
            ).length;
            const qualities = [
              ...new Set(family.models.map(qualityLabel)),
            ].join(" / ");
            const speakers = Math.max(
              ...family.models.map((model) => model.numSpeakers),
            );

            if (directModel) {
              const choice = {
                id: null,
                voiceId: directModel.id,
                label: family.name,
              };
              return (
                <VoiceChoiceRow
                  key={family.key}
                  choice={choice}
                  detail={[family.language, qualityLabel(directModel)]
                    .filter(Boolean)
                    .join(" · ")}
                  selected={directModel.id === selectedSourceKey}
                  runtimeDefault={directModel.id === defaultSourceKey}
                  favorite={favoriteKeys.has(directModel.id)}
                  disabled={busyVoiceId !== null}
                  onSelect={() => void chooseVoice(directModel.id)}
                  onToggleFavorite={() =>
                    void toggleFavorite(
                      directModel.id,
                      !favoriteKeys.has(directModel.id),
                    )
                  }
                />
              );
            }

            return (
              <button
                key={family.key}
                type="button"
                onClick={() => openFamily(family)}
                className="flex min-h-16 w-full touch-manipulation items-center gap-3 px-4 py-3 text-left hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">
                    {family.name}
                  </span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">
                    {[
                      family.language,
                      qualities,
                      speakers > 1
                        ? t("voiceSettings.library.speakers", {
                            count: speakers,
                          })
                        : "",
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                </span>
                <span className="flex flex-shrink-0 items-center gap-2 text-xs text-muted-foreground">
                  {isSelectedFamily && (
                    <span className="text-primary">
                      {t("voiceSettings.library.selected")}
                    </span>
                  )}
                  {isDefaultFamily && (
                    <span>{t("voiceSettings.library.runtimeDefault")}</span>
                  )}
                  {favoriteCount > 0 && (
                    <span className="inline-flex items-center gap-1 text-primary">
                      <Star className="h-5 w-5 fill-current" />
                      <span>
                        {t("voiceSettings.library.favorites", {
                          count: favoriteCount,
                        })}
                      </span>
                    </span>
                  )}
                </span>
                <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
              </button>
            );
          })
        ) : (
          <p className="px-4 py-4 text-sm text-muted-foreground">
            {t("voiceSettings.library.emptyModels")}
          </p>
        )}
      </SettingsGroup>
    </SettingsScreen>
  );
}
