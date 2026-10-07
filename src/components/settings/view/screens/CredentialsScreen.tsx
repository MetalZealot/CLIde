import { useTranslation } from 'react-i18next';

import { useCredentialsSettings } from '../../hooks/useCredentialsSettings';
import GithubCredentialsSection from '../tabs/api-settings/sections/GithubCredentialsSection';
import { SettingsScreen } from '../primitives';

export default function CredentialsScreen() {
  const { t } = useTranslation('settings');
  const {
    githubCredentials,
    loading,
    showNewGithubForm,
    setShowNewGithubForm,
    newGithubName,
    setNewGithubName,
    newGithubToken,
    setNewGithubToken,
    newGithubDescription,
    setNewGithubDescription,
    showToken,
    createGithubCredential,
    deleteGithubCredential,
    toggleGithubCredential,
    cancelNewGithubForm,
    toggleNewGithubTokenVisibility,
  } = useCredentialsSettings({
    confirmDeleteGithubCredentialText: t('apiKeys.github.confirmDelete'),
  });

  if (loading) {
    return (
      <SettingsScreen>
        <p className="text-sm text-muted-foreground">{t('apiKeys.loading')}</p>
      </SettingsScreen>
    );
  }

  return (
    <SettingsScreen>
      <GithubCredentialsSection
        githubCredentials={githubCredentials}
        showNewGithubForm={showNewGithubForm}
        showNewTokenPlainText={Boolean(showToken.new)}
        newGithubName={newGithubName}
        newGithubToken={newGithubToken}
        newGithubDescription={newGithubDescription}
        onShowNewGithubFormChange={setShowNewGithubForm}
        onNewGithubNameChange={setNewGithubName}
        onNewGithubTokenChange={setNewGithubToken}
        onNewGithubDescriptionChange={setNewGithubDescription}
        onToggleNewTokenVisibility={toggleNewGithubTokenVisibility}
        onCreateGithubCredential={createGithubCredential}
        onCancelCreateGithubCredential={cancelNewGithubForm}
        onToggleGithubCredential={toggleGithubCredential}
        onDeleteGithubCredential={deleteGithubCredential}
      />
    </SettingsScreen>
  );
}
