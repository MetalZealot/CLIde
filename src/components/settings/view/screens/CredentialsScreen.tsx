import { useTranslation } from 'react-i18next';

import { useCredentialsSettings } from '../../hooks/useCredentialsSettings';
import ApiKeysSection from '../tabs/api-settings/sections/ApiKeysSection';
import GithubCredentialsSection from '../tabs/api-settings/sections/GithubCredentialsSection';
import NewApiKeyAlert from '../tabs/api-settings/sections/NewApiKeyAlert';
import { SettingsScreen } from '../primitives';

export default function CredentialsScreen() {
  const { t } = useTranslation('settings');
  const {
    apiKeys,
    githubCredentials,
    loading,
    showNewKeyForm,
    setShowNewKeyForm,
    newKeyName,
    setNewKeyName,
    showNewGithubForm,
    setShowNewGithubForm,
    newGithubName,
    setNewGithubName,
    newGithubToken,
    setNewGithubToken,
    newGithubDescription,
    setNewGithubDescription,
    showToken,
    copiedKey,
    newlyCreatedKey,
    createApiKey,
    deleteApiKey,
    toggleApiKey,
    createGithubCredential,
    deleteGithubCredential,
    toggleGithubCredential,
    copyToClipboard,
    dismissNewlyCreatedKey,
    cancelNewApiKeyForm,
    cancelNewGithubForm,
    toggleNewGithubTokenVisibility,
  } = useCredentialsSettings({
    confirmDeleteApiKeyText: t('apiKeys.confirmDelete'),
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
      {newlyCreatedKey && (
        <NewApiKeyAlert
          apiKey={newlyCreatedKey}
          copiedKey={copiedKey}
          onCopy={copyToClipboard}
          onDismiss={dismissNewlyCreatedKey}
        />
      )}

      <ApiKeysSection
        apiKeys={apiKeys}
        showNewKeyForm={showNewKeyForm}
        newKeyName={newKeyName}
        onShowNewKeyFormChange={setShowNewKeyForm}
        onNewKeyNameChange={setNewKeyName}
        onCreateApiKey={createApiKey}
        onCancelCreateApiKey={cancelNewApiKeyForm}
        onToggleApiKey={toggleApiKey}
        onDeleteApiKey={deleteApiKey}
      />

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
