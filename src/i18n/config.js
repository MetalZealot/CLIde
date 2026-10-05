/**
 * i18n configuration: English strings, grouped by namespace, read through t().
 */

import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import enAuth from './locales/en/auth.json';
import enChat from './locales/en/chat.json';
import enCodeEditor from './locales/en/codeEditor.json';
import enCommon from './locales/en/common.json';
import enSettings from './locales/en/settings.json';
import enSidebar from './locales/en/sidebar.json';
import { languages } from './languages.js';

i18n
  .use(initReactI18next)
  .init({
    resources: {
      en: {
        common: enCommon,
        settings: enSettings,
        auth: enAuth,
        sidebar: enSidebar,
        chat: enChat,
        codeEditor: enCodeEditor,
      },
    },
    lng: 'en',
    fallbackLng: 'en',
    supportedLngs: languages.map((language) => language.value),
    debug: false,
    ns: ['common', 'settings', 'auth', 'sidebar', 'chat', 'codeEditor'],
    defaultNS: 'common',
    keySeparator: '.',
    nsSeparator: ':',
    saveMissing: false,
    interpolation: {
      escapeValue: false, // React already escapes values
    },
    react: {
      useSuspense: true,
      bindI18n: 'languageChanged',
      bindI18nStore: false,
    },
  });

export default i18n;
