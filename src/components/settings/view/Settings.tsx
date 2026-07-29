import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import ProviderLoginModal from '../../provider-auth/view/ProviderLoginModal';
import { useDeviceSettings } from '../../../hooks/useDeviceSettings';
import AgentsSettingsTab from '../view/tabs/agents-settings/AgentsSettingsTab';
import CredentialsSettingsTab from '../view/tabs/api-settings/CredentialsSettingsTab';
import VoiceSettingsTab from '../view/tabs/VoiceSettingsTab';
import GitSettingsTab from '../view/tabs/git-settings/GitSettingsTab';
import BrowserUseSettingsTab from '../view/tabs/browser-use-settings/BrowserUseSettingsTab';
import NotificationsSettingsTab from '../view/tabs/NotificationsSettingsTab';
import TasksSettingsTab from '../view/tabs/tasks-settings/TasksSettingsTab';
import PluginSettingsTab from '../../plugins/view/PluginSettingsTab';
import AboutTab from '../view/tabs/AboutTab';
import { useSettingsController } from '../hooks/useSettingsController';
import { useSettingsNavigation } from '../hooks/useSettingsNavigation';
import { getScreen } from '../registry/registry';
import { useWebPush } from '../../../hooks/useWebPush';
import type { SettingsProps } from '../types/types';

import AppearanceEditorScreen from './screens/AppearanceEditorScreen';
import AppearanceScreen from './screens/AppearanceScreen';
import { SettingsScreen } from './primitives';
import SettingsHeader from './shell/SettingsHeader';
import SettingsRail from './shell/SettingsRail';
import SettingsRootList from './shell/SettingsRootList';

type DesktopNotificationsState = {
  enabled: boolean;
  supported: boolean;
  connectedCount?: number;
  targetCount?: number;
  lastError?: string | null;
};

function Settings({ isOpen, onClose, projects = [], initialTab }: SettingsProps) {
  const { t } = useTranslation('settings');
  const { isMobile } = useDeviceSettings({ trackPWA: false });
  const desktopNotificationsBridge = useMemo(() => (
    typeof window === 'undefined'
      ? null
      : ((window as any).cloudcliDesktopNotifications || null)
  ), []);
  const [desktopNotificationsState, setDesktopNotificationsState] = useState<DesktopNotificationsState | null>(null);

  const nav = useSettingsNavigation({
    isOpen,
    initialScreenId: initialTab,
    mode: isMobile ? 'stack' : 'panes',
    onClose,
  });

  // Drives the push/pop slide direction; depth is the only thing that decides it.
  const previousDepthRef = useRef(nav.depth);
  const transitionClass = nav.depth >= previousDepthRef.current
    ? 'settings-screen-push'
    : 'settings-screen-pop';
  useEffect(() => {
    previousDepthRef.current = nav.depth;
  }, [nav.depth]);

  const {
    saveStatus,
    projectSortOrder,
    setProjectSortOrder,
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

  useEffect(() => {
    if (!desktopNotificationsBridge) return undefined;
    let mounted = true;
    desktopNotificationsBridge.getState().then((state: any) => {
      if (mounted) {
        setDesktopNotificationsState(state?.desktopNotifications || null);
      }
    }).catch(() => {});
    const unsubscribe = desktopNotificationsBridge.onStateUpdated?.((state: any) => {
      if (mounted) {
        setDesktopNotificationsState(state?.desktopNotifications || null);
      }
    });
    return () => {
      mounted = false;
      unsubscribe?.();
    };
  }, [desktopNotificationsBridge]);

  const handleEnableDesktopNotifications = async () => {
    if (!desktopNotificationsBridge) return;
    const state = await desktopNotificationsBridge.update({ enabled: true });
    setDesktopNotificationsState(state?.desktopNotifications || null);
    setNotificationPreferences({
      ...notificationPreferences,
      channels: { ...notificationPreferences.channels, desktop: true },
    });
  };

  const handleDisableDesktopNotifications = async () => {
    if (!desktopNotificationsBridge) return;
    const state = await desktopNotificationsBridge.update({ enabled: false });
    setDesktopNotificationsState(state?.desktopNotifications || null);
    setNotificationPreferences({
      ...notificationPreferences,
      channels: { ...notificationPreferences.channels, desktop: false },
    });
  };

  if (!isOpen) {
    return null;
  }

  const isAuthenticated = Boolean(loginProvider && providerAuthStatus[loginProvider].authenticated);
  const activeScreen = getScreen(nav.screenId);
  const parentScreen = getScreen(nav.parentId);

  /**
   * Screens not yet ported to the primitives render their existing tab
   * component inside a `SettingsScreen`, so that every destination stays
   * reachable while the ports land packet by packet. Each one drops off this
   * list as its packet completes; Agents keeps its own nested scroller — and
   * therefore its known scrolling bugs — until P4 restructures it.
   */
  const renderScreen = () => {
    switch (nav.screenId) {
      case 'appearance':
        return (
          <AppearanceScreen
            projectSortOrder={projectSortOrder}
            onProjectSortOrderChange={setProjectSortOrder}
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

      case 'agents':
        return (
          <SettingsScreen>
            <AgentsSettingsTab
              providerAuthStatus={providerAuthStatus}
              onProviderLogin={openLoginForProvider}
              claudePermissions={claudePermissions}
              onClaudePermissionsChange={setClaudePermissions}
              cursorPermissions={cursorPermissions}
              onCursorPermissionsChange={setCursorPermissions}
              codexPermissionMode={codexPermissionMode}
              onCodexPermissionModeChange={setCodexPermissionMode}
              projects={projects}
            />
          </SettingsScreen>
        );

      case 'voice':
        return <SettingsScreen><VoiceSettingsTab /></SettingsScreen>;

      case 'notifications':
        return (
          <SettingsScreen>
            <NotificationsSettingsTab
              notificationPreferences={notificationPreferences}
              onNotificationPreferencesChange={setNotificationPreferences}
              pushPermission={pushPermission}
              isPushSubscribed={isPushSubscribed}
              isPushLoading={isPushLoading}
              onEnablePush={handleEnablePush}
              onDisablePush={handleDisablePush}
              isDesktop={Boolean(desktopNotificationsBridge)}
              desktopNotifications={desktopNotificationsState}
              onEnableDesktopNotifications={handleEnableDesktopNotifications}
              onDisableDesktopNotifications={handleDisableDesktopNotifications}
            />
          </SettingsScreen>
        );

      case 'git':
        return <SettingsScreen><GitSettingsTab /></SettingsScreen>;

      case 'plugins':
        return <SettingsScreen><PluginSettingsTab /></SettingsScreen>;

      case 'browser':
        return <SettingsScreen><BrowserUseSettingsTab /></SettingsScreen>;

      case 'tasks':
        return <SettingsScreen><TasksSettingsTab /></SettingsScreen>;

      case 'credentials':
        return <SettingsScreen><CredentialsSettingsTab /></SettingsScreen>;

      case 'about':
        return <SettingsScreen><AboutTab /></SettingsScreen>;

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
    <div className="modal-backdrop fixed inset-0 z-[9999] flex items-center justify-center bg-background/80 md:p-4">
      <div className="flex h-full w-full flex-col overflow-hidden border border-border bg-background shadow-2xl md:h-[90vh] md:max-w-4xl md:rounded-xl">
        <SettingsHeader
          title={headerTitle}
          backLabel={isMobile && !nav.atRoot ? t(parentScreen?.labelKey ?? 'title') : null}
          onBack={isMobile && !nav.atRoot ? nav.goBack : undefined}
          onClose={nav.close}
          showSavedIndicator={saveStatus === 'success'}
        />

        <div className="flex min-h-0 min-w-0 flex-1 flex-col md:flex-row">
          {!isMobile && <SettingsRail stack={nav.stack} onSelect={nav.select} />}

          {showRootList ? (
            <SettingsRootList onSelect={nav.push} />
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
