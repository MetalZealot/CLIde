import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useVoiceConfig } from '../../../../hooks/useVoiceConfig';
import { fetchVoiceHealth, type VoiceHealth } from '../../../../lib/voiceApi';
import {
  SettingsChoicePopover,
  SettingsGroup,
  SettingsRow,
  SettingsScreen,
  SettingsTextField,
} from '../primitives';

/**
 * Chat › Voice › Backend. `baseUrl` is a real, working field, not the dead one
 * the original TODO note describes: the server proxy ignores client input (a
 * deliberate SSRF defense), but `voiceApi.ts` calls a non-blank `baseUrl`
 * directly from the browser, bypassing the proxy entirely — a legitimate
 * bring-your-own-backend path, already documented in `voiceSettings.note`.
 */
export default function ChatVoiceBackendScreen() {
  const { t } = useTranslation('settings');
  const { config, update } = useVoiceConfig();
  const [serverHealth, setServerHealth] = useState<VoiceHealth | null>(null);
  const [isLoadingVoices, setIsLoadingVoices] = useState(false);
  const usesServerBackend = !config.baseUrl.trim();

  useEffect(() => {
    if (!usesServerBackend) {
      setServerHealth(null);
      setIsLoadingVoices(false);
      return undefined;
    }

    let active = true;
    setIsLoadingVoices(true);
    void fetchVoiceHealth()
      .then((health) => {
        if (active) setServerHealth(health);
      })
      .catch(() => {
        if (active) setServerHealth(null);
      })
      .finally(() => {
        if (active) setIsLoadingVoices(false);
      });
    return () => {
      active = false;
    };
  }, [usesServerBackend]);

  const voiceOptions = useMemo(() => serverHealth?.voices.map((voice) => ({
    value: voice.id,
    label: voice.label,
    detail: `${t(`voiceSettings.catalog.gender.${voice.gender}`)} · ${t(`voiceSettings.catalog.tier.${voice.tier}`)}`,
  })) ?? [], [serverHealth, t]);

  const selectedVoice = voiceOptions.some((option) => option.value === config.ttsVoice)
    ? config.ttsVoice
    : voiceOptions.some((option) => option.value === serverHealth?.defaultVoice)
      ? serverHealth?.defaultVoice ?? voiceOptions[0]?.value ?? ''
      : voiceOptions[0]?.value ?? '';

  useEffect(() => {
    if (voiceOptions.length > 0
      && config.ttsVoice
      && !voiceOptions.some((option) => option.value === config.ttsVoice)) {
      update({ ttsVoice: '' });
    }
  }, [config.ttsVoice, update, voiceOptions]);

  return (
    <SettingsScreen>
      <SettingsGroup divided>
        <SettingsRow stacked label={t('voiceSettings.baseUrl')}>
          <SettingsTextField
            value={config.baseUrl}
            onChange={(value) => update({ baseUrl: value })}
            placeholder="https://api.openai.com/v1"
            ariaLabel={t('voiceSettings.baseUrl')}
          />
        </SettingsRow>

        <SettingsRow stacked label={t('voiceSettings.apiKey')}>
          <SettingsTextField
            value={config.apiKey}
            onChange={(value) => update({ apiKey: value })}
            type="password"
            autoComplete="off"
            placeholder="sk-…"
            ariaLabel={t('voiceSettings.apiKey')}
          />
        </SettingsRow>

        <SettingsRow stacked label={t('voiceSettings.sttModel')}>
          <SettingsTextField
            value={config.sttModel}
            onChange={(value) => update({ sttModel: value })}
            placeholder="whisper-1"
            ariaLabel={t('voiceSettings.sttModel')}
          />
        </SettingsRow>

        <SettingsRow stacked label={t('voiceSettings.ttsModel')}>
          <SettingsTextField
            value={config.ttsModel}
            onChange={(value) => update({ ttsModel: value })}
            placeholder="tts-1"
            ariaLabel={t('voiceSettings.ttsModel')}
          />
        </SettingsRow>

        <SettingsRow stacked label={t('voiceSettings.voice')}>
          {usesServerBackend && isLoadingVoices ? (
            <SettingsTextField
              value=""
              onChange={() => {}}
              placeholder={t('voiceSettings.loadingVoices')}
              ariaLabel={t('voiceSettings.voice')}
              disabled
            />
          ) : usesServerBackend && voiceOptions.length > 0 ? (
            <SettingsChoicePopover
              value={selectedVoice}
              options={voiceOptions}
              onChange={(value) => update({ ttsVoice: value })}
              ariaLabel={t('voiceSettings.voice')}
              className="w-full"
            />
          ) : (
            <SettingsTextField
              value={config.ttsVoice}
              onChange={(value) => update({ ttsVoice: value })}
              placeholder="alloy"
              ariaLabel={t('voiceSettings.voice')}
            />
          )}
        </SettingsRow>

        <SettingsRow stacked label={t('voiceSettings.format')}>
          <SettingsTextField
            value={config.ttsFormat}
            onChange={(value) => update({ ttsFormat: value })}
            placeholder="mp3"
            ariaLabel={t('voiceSettings.format')}
          />
        </SettingsRow>
      </SettingsGroup>

      <p className="text-xs text-muted-foreground">{t('voiceSettings.note')}</p>
    </SettingsScreen>
  );
}
