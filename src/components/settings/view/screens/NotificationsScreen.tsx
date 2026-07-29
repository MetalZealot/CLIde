import { BellOff, BellRing, Loader2, Play } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Button } from '../../../../shared/view/ui';
import { playChatCompletionSound } from '../../../../utils/notificationSound';
import type { NotificationPreferencesState } from '../../types/types';
import { SettingsGroup, SettingsRow, SettingsScreen, SettingsToggle } from '../primitives';

type DesktopNotificationsState = {
  enabled: boolean;
  supported: boolean;
  connectedCount?: number;
  targetCount?: number;
  lastError?: string | null;
};

type NotificationsScreenProps = {
  notificationPreferences: NotificationPreferencesState;
  onNotificationPreferencesChange: (value: NotificationPreferencesState) => void;
  pushPermission: NotificationPermission | 'unsupported';
  isPushSubscribed: boolean;
  isPushLoading: boolean;
  onEnablePush: () => void;
  onDisablePush: () => void;
  isDesktop?: boolean;
  desktopNotifications?: DesktopNotificationsState | null;
  onEnableDesktopNotifications?: () => void;
  onDisableDesktopNotifications?: () => void;
};

export default function NotificationsScreen({
  notificationPreferences,
  onNotificationPreferencesChange,
  pushPermission,
  isPushSubscribed,
  isPushLoading,
  onEnablePush,
  onDisablePush,
  isDesktop = false,
  desktopNotifications = null,
  onEnableDesktopNotifications,
  onDisableDesktopNotifications,
}: NotificationsScreenProps) {
  const { t } = useTranslation('settings');

  const pushSupported = pushPermission !== 'unsupported';
  const pushDenied = pushPermission === 'denied';

  const setChannel = (key: keyof NotificationPreferencesState['channels'], value: boolean) => {
    onNotificationPreferencesChange({
      ...notificationPreferences,
      channels: { ...notificationPreferences.channels, [key]: value },
    });
  };

  const setEvent = (key: keyof NotificationPreferencesState['events'], value: boolean) => {
    onNotificationPreferencesChange({
      ...notificationPreferences,
      events: { ...notificationPreferences.events, [key]: value },
    });
  };

  return (
    <SettingsScreen description={t('notifications.description')}>
      {isDesktop ? (
        <SettingsGroup title={t('notifications.desktop.title')}>
          {desktopNotifications?.supported === false ? (
            <p className="p-4 text-sm text-muted-foreground">{t('notifications.desktop.unsupported')}</p>
          ) : (
            <div className="space-y-3 p-4">
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  size="sm"
                  variant={desktopNotifications?.enabled ? 'destructive' : 'default'}
                  onClick={() => {
                    if (desktopNotifications?.enabled) {
                      onDisableDesktopNotifications?.();
                    } else {
                      onEnableDesktopNotifications?.();
                    }
                  }}
                >
                  {desktopNotifications?.enabled ? <BellOff className="h-4 w-4" /> : <BellRing className="h-4 w-4" />}
                  {desktopNotifications?.enabled
                    ? t('notifications.desktop.disable')
                    : t('notifications.desktop.enable')}
                </Button>
                {desktopNotifications?.enabled && (
                  <span className="text-sm text-primary">{t('notifications.desktop.enabled')}</span>
                )}
              </div>
              {desktopNotifications?.lastError && (
                <p className="text-sm text-destructive">{desktopNotifications.lastError}</p>
              )}
            </div>
          )}
        </SettingsGroup>
      ) : (
        <SettingsGroup title={t('notifications.webPush.title')}>
          {!pushSupported ? (
            <p className="p-4 text-sm text-muted-foreground">{t('notifications.webPush.unsupported')}</p>
          ) : pushDenied ? (
            <p className="p-4 text-sm text-muted-foreground">{t('notifications.webPush.denied')}</p>
          ) : (
            <div className="flex flex-wrap items-center gap-3 p-4">
              <Button
                type="button"
                size="sm"
                variant={isPushSubscribed ? 'destructive' : 'default'}
                disabled={isPushLoading}
                onClick={() => (isPushSubscribed ? onDisablePush() : onEnablePush())}
              >
                {isPushLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : isPushSubscribed ? (
                  <BellOff className="h-4 w-4" />
                ) : (
                  <BellRing className="h-4 w-4" />
                )}
                {isPushLoading
                  ? t('notifications.webPush.loading')
                  : isPushSubscribed
                    ? t('notifications.webPush.disable')
                    : t('notifications.webPush.enable')}
              </Button>
              {isPushSubscribed && (
                <span className="text-sm text-primary">{t('notifications.webPush.enabled')}</span>
              )}
            </div>
          )}
        </SettingsGroup>
      )}

      <SettingsGroup>
        <SettingsRow label={t('notifications.sound.title')} description={t('notifications.sound.description')}>
          <SettingsToggle
            checked={notificationPreferences.channels.sound}
            onChange={(value) => setChannel('sound', value)}
            ariaLabel={t('notifications.sound.title')}
          />
        </SettingsRow>
        <div className="border-t border-border p-4">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              void playChatCompletionSound({ force: true });
            }}
          >
            <Play className="h-4 w-4" />
            {t('notifications.sound.test')}
          </Button>
        </div>
      </SettingsGroup>

      <SettingsGroup title={t('notifications.events.title')} divided>
        <SettingsRow label={t('notifications.events.actionRequired')}>
          <SettingsToggle
            checked={notificationPreferences.events.actionRequired}
            onChange={(value) => setEvent('actionRequired', value)}
            ariaLabel={t('notifications.events.actionRequired')}
          />
        </SettingsRow>
        <SettingsRow label={t('notifications.events.stop')}>
          <SettingsToggle
            checked={notificationPreferences.events.stop}
            onChange={(value) => setEvent('stop', value)}
            ariaLabel={t('notifications.events.stop')}
          />
        </SettingsRow>
        <SettingsRow label={t('notifications.events.error')}>
          <SettingsToggle
            checked={notificationPreferences.events.error}
            onChange={(value) => setEvent('error', value)}
            ariaLabel={t('notifications.events.error')}
          />
        </SettingsRow>
      </SettingsGroup>
    </SettingsScreen>
  );
}
