import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import ProviderLoginModal from '../../provider-auth/view/ProviderLoginModal';
import { useDeviceSettings } from '../../../hooks/useDeviceSettings';
import { useSettingsController } from '../hooks/useSettingsController';
import { useSettingsNavigation } from '../hooks/useSettingsNavigation';
import { getScreen, parseAgentScreenId } from '../registry/registry';
import { searchSettings } from '../registry/search';
import { useWebPush } from '../../../hooks/useWebPush';
import type { SettingsProps } from '../types/types';
import { PageScrollLock } from '../../../shared/view/ui';

import AboutScreen from './screens/AboutScreen';
import AccountScreen from './screens/AccountScreen';
import AgentMcpScreen from './screens/AgentMcpScreen';
import AgentAutoCompactScreen from './screens/AgentAutoCompactScreen';
import AgentClaudeAdvancedScreen from './screens/AgentClaudeAdvancedScreen';
import AgentClaudeCategoryScreen from './screens/AgentClaudeCategoryScreen';
import AgentConfigurationScreen from './screens/AgentConfigurationScreen';
import AgentDefaultEffortScreen from './screens/AgentDefaultEffortScreen';
import AgentDefaultModelScreen from './screens/AgentDefaultModelScreen';
import AgentPermissionsScreen from './screens/AgentPermissionsScreen';
import AgentProviderScreen from './screens/AgentProviderScreen';
import AgentToolsScreen from './screens/AgentToolsScreen';
import AppearanceEditorScreen from './screens/AppearanceEditorScreen';
import AppearanceScreen from './screens/AppearanceScreen';
import ChatScreen from './screens/ChatScreen';
import ChatVoiceBackendScreen from './screens/ChatVoiceBackendScreen';
import ChatVoiceLibraryScreen from './screens/ChatVoiceLibraryScreen';
import CredentialsScreen from './screens/CredentialsScreen';
import ExtensionsBrowserScreen from './screens/ExtensionsBrowserScreen';
import NotificationsScreen from './screens/NotificationsScreen';
import ProjectsGitScreen from './screens/ProjectsGitScreen';
import SettingsHeader from './shell/SettingsHeader';
import SettingsRail from './shell/SettingsRail';
import SettingsRootList from './shell/SettingsRootList';

function Settings({ isOpen, onClose, projects = [], initialTab, onOpenUsage }: SettingsProps) {
  const { t } = useTranslation('settings');
  const { isMobile } = useDeviceSettings({ trackPWA: false });

  const nav = useSettingsNavigation({
    isOpen,
    initialScreenId: initialTab,
    mode: isMobile ? 'stack' : 'panes',
    onClose,
  });

  // Search lives here rather than in the two shells so both read one query, and
  // so it survives the rail's re-render on selection.
  const [searchQuery, setSearchQuery] = useState('');
  const searchResults = useMemo(
    () => searchSettings(searchQuery, (key: string) => t(key)),
    [searchQuery, t],
  );

  useEffect(() => {
    if (!isOpen) setSearchQuery('');
  }, [isOpen]);

  /**
   * Choosing a destination clears the query on both surfaces: on mobile the back
   * gesture should return to the whole list, and on desktop the rail then shows
   * the selection in context instead of a stale result list.
   *
   * `jump` is for search results, which may sit at depth 2 — `push` only accepts
   * a child of the current screen, by design.
   */
  const openFromSearch = (screenId: string, jump: boolean) => {
    setSearchQuery('');
    if (jump) {
      nav.jumpTo(screenId);
    } else {
      nav.select(screenId);
    }
  };

  // Drives the push/pop slide direction; depth is the only thing that decides it.
  const previousDepthRef = useRef(nav.depth);
  const transitionClass = nav.depth >= previousDepthRef.current
    ? 'settings-screen-push'
    : 'settings-screen-pop';
  useEffect(() => {
    previousDepthRef.current = nav.depth;
  }, [nav.depth]);

  const {
    loginResult,
    codeEditorSettings,
    updateCodeEditorSetting,
    claudePermissions,
    setClaudePermissions,
    notificationPreferences,
    setNotificationPreferences,
    cursorPermissions,
    setCursorPermissions,
    codexPermissionMode,
    setCodexPermissionMode,
    providerAuthStatus,
    openLoginForProvider,
    showLoginModal,
    setShowLoginModal,
    loginProvider,
    handleLoginComplete,
  } = useSettingsController({ isOpen });

  const {
    permission: pushPermission,
    isSubscribed: isPushSubscribed,
    isLoading: isPushLoading,
    subscribe: pushSubscribe,
    unsubscribe: pushUnsubscribe,
  } = useWebPush();

  const handleEnablePush = async () => {
    await pushSubscribe();
    // Server sets webPush: true in preferences on subscribe; sync local state
    setNotificationPreferences({
      ...notificationPreferences,
      channels: { ...notificationPreferences.channels, webPush: true },
    });
  };

  const handleDisablePush = async () => {
    await pushUnsubscribe();
    // Server sets webPush: false in preferences on unsubscribe; sync local state
    setNotificationPreferences({
      ...notificationPreferences,
      channels: { ...notificationPreferences.channels, webPush: false },
    });
  };

  if (!isOpen) {
    return null;
  }

  const isAuthenticated = Boolean(loginProvider && providerAuthStatus[loginProvider].authenticated);
  const activeScreen = getScreen(nav.screenId);
  const parentScreen = getScreen(nav.parentId);
  const agentScreen = parseAgentScreenId(nav.screenId);

  /**
   * Every destination is now a screen built from the shared primitives, so this
   * is a plain id switch. The Agents group resolves through
   * `parseAgentScreenId` instead of fourteen cases, since its screens differ
   * only by provider and subsystem.
   */
  const renderScreen = () => {
    if (agentScreen) {
      const { provider, subsystem } = agentScreen;

      switch (subsystem) {
        case 'model':
          return <AgentDefaultModelScreen provider={provider} />;

        case 'effort':
          return <AgentDefaultEffortScreen />;

        case 'autoCompact':
          return <AgentAutoCompactScreen />;

        case 'configuration':
          return <AgentConfigurationScreen projects={projects} />;

        case 'modelThinking':
        case 'responses':
        case 'memory':
        case 'git':
        case 'history':
          return (
            <AgentClaudeCategoryScreen
              category={subsystem}
              projects={projects}
              onOpenScreen={isMobile ? nav.push : nav.select}
            />
          );

        case 'advanced':
          return <AgentClaudeAdvancedScreen projects={projects} onOpenScreen={isMobile ? nav.push : nav.select} />;

        case 'permissions':
          return (
            <AgentPermissionsScreen
              provider={provider}
              claudePermissions={claudePermissions}
              onClaudePermissionsChange={setClaudePermissions}
              cursorPermissions={cursorPermissions}
              onCursorPermissionsChange={setCursorPermissions}
              codexPermissionMode={codexPermissionMode}
              onCodexPermissionModeChange={setCodexPermissionMode}
            />
          );

        case 'mcp':
          return <AgentMcpScreen provider={provider} projects={projects} />;

        case 'tools':
          return (
            <AgentToolsScreen
              provider={provider}
              projects={projects}
              onOpenScreen={isMobile ? nav.push : nav.select}
            />
          );

        default:
          return (
            <AgentProviderScreen
              provider={provider}
              authStatus={providerAuthStatus[provider]}
              onLogin={() => openLoginForProvider(provider)}
              loginSucceeded={loginResult?.provider === provider ? loginResult.succeeded : null}
              projects={projects}
              onOpenScreen={isMobile ? nav.push : nav.select}
              notificationPreferences={notificationPreferences}
              onNotificationPreferencesChange={setNotificationPreferences}
              onOpenNotifications={() => nav.jumpTo('notifications')}
              onOpenUsage={() => { onClose(); onOpenUsage(); }}
              permissions={{ claude: claudePermissions, cursor: cursorPermissions, codex: codexPermissionMode }}
            />
          );
      }
    }

    switch (nav.screenId) {
      case 'appearance':
        return (
          <AppearanceScreen
            onOpenScreen={isMobile ? nav.push : nav.select}
          />
        );

      case 'appearance.editor':
        return (
          <AppearanceEditorScreen
            codeEditorSettings={codeEditorSettings}
            onWordWrapChange={(value) => updateCodeEditorSetting('wordWrap', value)}
            onShowMinimapChange={(value) => updateCodeEditorSetting('showMinimap', value)}
            onLineNumbersChange={(value) => updateCodeEditorSetting('lineNumbers', value)}
            onFontSizeChange={(value) => updateCodeEditorSetting('fontSize', value)}
          />
        );

      case 'chat':
        return <ChatScreen onOpenScreen={isMobile ? nav.push : nav.select} />;


      case 'chat.voice':
        return (
          <ChatVoiceBackendScreen
            onOpenLibrary={() => (isMobile ? nav.push : nav.select)('chat.voice.library')}
          />
        );

      case 'chat.voice.library':
        return <ChatVoiceLibraryScreen />;

      case 'notifications':
        return (
          <NotificationsScreen
            notificationPreferences={notificationPreferences}
            onNotificationPreferencesChange={setNotificationPreferences}
            pushPermission={pushPermission}
            isPushSubscribed={isPushSubscribed}
            isPushLoading={isPushLoading}
            onEnablePush={handleEnablePush}
            onDisablePush={handleDisablePush}
          />
        );

      case 'projects-git':
        return <ProjectsGitScreen />;


      case 'browser':
        return <ExtensionsBrowserScreen />;

      case 'account':
        return <AccountScreen />;

      case 'credentials':
        return <CredentialsScreen />;

      case 'about':
        return <AboutScreen />;

      default:
        return null;
    }
  };

  // Mobile shows one screen at a time; desktop always shows the rail beside a
  // detail pane, and falls back to a prompt when nothing is selected yet.
  const showRootList = isMobile && nav.atRoot;
  const headerTitle = !isMobile || nav.atRoot
    ? t('title')
    : t(activeScreen?.labelKey ?? 'title');

  return (
    <div className="modal-backdrop safe-top fixed inset-0 z-[9999] flex items-center justify-center bg-background/80 md:p-4">
      <PageScrollLock />
      <div className="flex h-full w-full flex-col overflow-hidden border border-border bg-background shadow-2xl md:h-[90vh] md:max-w-4xl md:rounded-xl">
        <SettingsHeader
          title={headerTitle}
          backLabel={isMobile && !nav.atRoot ? t(parentScreen?.labelKey ?? 'title') : null}
          onBack={isMobile && !nav.atRoot ? nav.goBack : undefined}
          onClose={nav.close}
        />

        <div className="flex min-h-0 min-w-0 flex-1 flex-col md:flex-row">
          {!isMobile && (
            <SettingsRail
              stack={nav.stack}
              onSelect={(screenId) => openFromSearch(screenId, false)}
              providerAuthStatus={providerAuthStatus}
              searchQuery={searchQuery}
              onSearchQueryChange={setSearchQuery}
              searchResults={searchResults}
            />
          )}

          {showRootList ? (
            <SettingsRootList
              onSelect={nav.push}
              onSelectResult={(screenId) => openFromSearch(screenId, true)}
              providerAuthStatus={providerAuthStatus}
              searchQuery={searchQuery}
              onSearchQueryChange={setSearchQuery}
              searchResults={searchResults}
            />
          ) : (
            <div
              key={nav.screenId ?? 'root'}
              className={`flex min-h-0 min-w-0 flex-1 flex-col ${transitionClass}`}
            >
              {activeScreen ? renderScreen() : (
                <div className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground">
                  {t('nav.emptyPane')}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <ProviderLoginModal
        key={loginProvider || 'claude'}
        isOpen={showLoginModal}
        onClose={() => setShowLoginModal(false)}
        provider={loginProvider || 'claude'}
        onComplete={handleLoginComplete}
        isAuthenticated={isAuthenticated}
      />

    </div>
  );
}

export default Settings;
