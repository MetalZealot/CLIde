import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  useAppearancePreferences,
  type ChatLineSpacing,
  type ChatReadingSize,
  type FontFamilyPreference,
  type ThemePreference,
} from '../../../../contexts/AppearancePreferencesContext';
import { useTheme } from '../../../../contexts/ThemeContext';
import { languages } from '../../../../i18n/languages';
import { getScreen } from '../../registry/registry';
import {
  SETTINGS_ICONS,
  SettingsChoicePopover,
  SettingsGroup,
  SettingsNavRow,
  SettingsRow,
  SettingsScreen,
  SettingsSegmentedControl,
} from '../primitives';

const WIDE_READING_QUERY = '(min-width: 640px)';

const READING_METRICS: Record<'phone' | 'wide', Record<ChatReadingSize, { size: number; lineHeight: number }>> = {
  phone: {
    smallest: { size: 14, lineHeight: 21 },
    small: { size: 15, lineHeight: 22 },
    default: { size: 16, lineHeight: 24 },
    large: { size: 17, lineHeight: 26 },
  },
  wide: {
    smallest: { size: 13, lineHeight: 21 },
    small: { size: 14, lineHeight: 24 },
    default: { size: 15, lineHeight: 24 },
    large: { size: 16, lineHeight: 26 },
  },
};

const LINE_SPACING_OFFSETS: Record<ChatLineSpacing, number> = {
  condensed: -2,
  standard: 0,
  relaxed: 2,
  spacious: 4,
};

const useWideReadingMetrics = () => {
  const [isWide, setIsWide] = useState(() =>
    typeof window !== 'undefined' && Boolean(window.matchMedia?.(WIDE_READING_QUERY).matches));

  useEffect(() => {
    if (!window.matchMedia) return undefined;
    const query = window.matchMedia(WIDE_READING_QUERY);
    const update = (event: MediaQueryListEvent) => setIsWide(event.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  return isWide;
};

type AppearanceScreenProps = {
  onOpenScreen: (screenId: string) => void;
};

/**
 * The reference port. Every other screen should read like this one: a
 * `SettingsScreen` wrapper, `SettingsGroup` sections, rows built from shared
 * primitives, and bespoke row content styled only with theme tokens.
 *
 * Project sorting moved to Projects & Git in P3b, per the IA spec.
 */
export default function AppearanceScreen({
  onOpenScreen,
}: AppearanceScreenProps) {
  const { t, i18n } = useTranslation('settings');
  const { theme, setTheme } = useTheme();
  const {
    chatReadingSize,
    chatLineSpacing,
    fontFamily,
    setChatLineSpacing,
    setChatReadingSize,
    setFontFamily,
  } = useAppearancePreferences();
  const isWide = useWideReadingMetrics();
  const readingMetrics = READING_METRICS[isWide ? 'wide' : 'phone'];
  const selectedMetrics = readingMetrics[chatReadingSize];
  const selectedLanguage = languages.find((language) =>
    language.value === (i18n.resolvedLanguage ?? i18n.language)) ?? languages[0];

  const readingSizeOptions = (['smallest', 'small', 'default', 'large'] as ChatReadingSize[])
    .map((value) => ({
      value,
      label: t(`appearanceSettings.typography.readingSize.${value}`),
      detail: `${readingMetrics[value].size} px`,
    }));

  const lineSpacingOptions = (['condensed', 'standard', 'relaxed', 'spacious'] as ChatLineSpacing[])
    .map((value) => {
      const offset = LINE_SPACING_OFFSETS[value];
      const offsetLabel = offset === 0 ? '' : ` (${offset > 0 ? '+' : '−'}${Math.abs(offset)})`;
      return {
        value,
        label: t(`appearanceSettings.typography.lineSpacing.${value}`),
        detail: `${selectedMetrics.lineHeight + offset} px${offsetLabel}`,
      };
    });

  const editorScreen = getScreen('appearance.editor');

  return (
    <SettingsScreen>
      <SettingsGroup>
        <SettingsRow
          stacked
          label={t('appearanceSettings.theme.title')}
          description={t('appearanceSettings.theme.description')}
        >
          <SettingsSegmentedControl<ThemePreference>
            value={theme}
            className="w-full justify-between"
            ariaLabel={t('appearanceSettings.theme.title')}
            onChange={setTheme}
            options={[
              { value: 'light', label: t('appearanceSettings.theme.light') },
              { value: 'dark', label: t('appearanceSettings.theme.dark') },
              { value: 'system', label: t('appearanceSettings.theme.system') },
            ]}
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title={t('appearanceSettings.typography.title')}>
        <SettingsRow
          stacked
          label={t('appearanceSettings.typography.fontFamily.label')}
          description={t('appearanceSettings.typography.fontFamily.description')}
        >
          <SettingsSegmentedControl<FontFamilyPreference>
            value={fontFamily}
            className="w-full justify-between"
            ariaLabel={t('appearanceSettings.typography.fontFamily.label')}
            onChange={setFontFamily}
            options={[
              { value: 'clide', label: t('appearanceSettings.typography.fontFamily.clide') },
              { value: 'system', label: t('appearanceSettings.typography.fontFamily.system') },
            ]}
          />
        </SettingsRow>

        <SettingsRow
          stacked
          label={t('appearanceSettings.typography.preview.label')}
        >
          <div className="rounded-lg border border-border bg-background/60 p-4">
            <p className="chat-reading text-foreground">
              {t('appearanceSettings.typography.preview.text')}
            </p>
          </div>
        </SettingsRow>

        <SettingsRow
          label={t('appearanceSettings.typography.readingSize.label')}
        >
          <SettingsChoicePopover<ChatReadingSize>
            value={chatReadingSize}
            options={readingSizeOptions}
            ariaLabel={t('appearanceSettings.typography.readingSize.label')}
            onChange={setChatReadingSize}
          />
        </SettingsRow>

        <SettingsRow label={t('appearanceSettings.typography.lineSpacing.label')}>
          <SettingsChoicePopover<ChatLineSpacing>
            value={chatLineSpacing}
            options={lineSpacingOptions}
            ariaLabel={t('appearanceSettings.typography.lineSpacing.label')}
            onChange={setChatLineSpacing}
          />
        </SettingsRow>
      </SettingsGroup>

      <SettingsGroup title={t('appearanceSettings.language.title')}>
        <SettingsRow
          label={t('account.languageLabel')}
          description={t('account.languageDescription')}
        >
          <SettingsChoicePopover<string>
            value={selectedLanguage?.value ?? 'en'}
            options={languages.map((language) => ({
              value: language.value,
              label: language.nativeName,
            }))}
            ariaLabel={t('account.languageLabel')}
            onChange={(language) => void i18n.changeLanguage(language)}
          />
        </SettingsRow>
      </SettingsGroup>

      {editorScreen && (
        <SettingsGroup>
          <SettingsNavRow
            label={t(editorScreen.labelKey)}
            description={t('appearanceSettings.codeEditor.description')}
            icon={SETTINGS_ICONS[editorScreen.icon]}
            onClick={() => onOpenScreen(editorScreen.id)}
          />
        </SettingsGroup>
      )}
    </SettingsScreen>
  );
}
