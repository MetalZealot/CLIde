import { useTranslation } from 'react-i18next';

import { useGitSettings } from '../../hooks/useGitSettings';
import { SettingsGroup, SettingsRow, SettingsScreen, SettingsTextField } from '../primitives';

/**
 * Git identity saves on blur — debounced, so tabbing
 * from name straight into email coalesces into one write — rather than the
 * old explicit Save button, since these are real `git config --global` writes
 * and never per-keystroke.
 */
export default function ProjectsGitScreen() {
  const { t } = useTranslation('settings');
  const {
    gitName,
    setGitName,
    gitEmail,
    setGitEmail,
    isLoading,
    saveStatus,
    handleFieldBlur,
  } = useGitSettings();

  return (
    <SettingsScreen>
      <SettingsGroup title={t('git.title')} description={t('git.description')} divided>
        <SettingsRow stacked label={t('git.name.label')} description={t('git.name.help')}>
          <SettingsTextField
            value={gitName}
            onChange={setGitName}
            onBlur={handleFieldBlur}
            disabled={isLoading}
            placeholder="John Doe"
            ariaLabel={t('git.name.label')}
          />
        </SettingsRow>
        <SettingsRow stacked label={t('git.email.label')} description={t('git.email.help')}>
          <SettingsTextField
            type="email"
            value={gitEmail}
            onChange={setGitEmail}
            onBlur={handleFieldBlur}
            disabled={isLoading}
            placeholder="john@example.com"
            ariaLabel={t('git.email.label')}
          />
        </SettingsRow>
        {saveStatus && (
          <div className="px-4 pb-4">
            <span className={`text-xs ${saveStatus === 'success' ? 'text-primary' : 'text-destructive'}`}>
              {saveStatus === 'success' ? t('git.status.success') : t('saveStatus.error')}
            </span>
          </div>
        )}
      </SettingsGroup>
    </SettingsScreen>
  );
}
