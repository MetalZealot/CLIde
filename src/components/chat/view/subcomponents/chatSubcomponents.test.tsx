import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test, { after, afterEach, before, describe } from 'node:test';

import i18next from 'i18next';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { initReactI18next } from 'react-i18next';

import { PROMPT_INPUT_TEXT_LAYOUT, PromptInputTextarea } from '../../../../shared/view/ui';
import { QuestionAnswerContent } from '../../tools/components/ContentRenderers/QuestionAnswerContent';
import { adaptUserInputAnswers } from '../../tools/components/InteractiveRenderers/user-input-request.adapter';
import { UserInputRequestPanel } from '../../tools/components/InteractiveRenderers/UserInputRequestPanel';
import { getNextRoutinePermissionMode } from '../../utils/chatPermissions';

import ChatExportMenu from './ChatExportMenu';
import ChatMessageImages from './ChatMessageImages';
import CompactBoundaryDivider from './CompactBoundaryDivider';
import { ComposerAttachmentGallery } from './ComposerAttachment';
import ComposerModelMenu from './ComposerModelMenu';
import ComposerPermissionMenu from './ComposerPermissionMenu';
import NativeImageAttachmentPicker from './NativeImageAttachmentPicker';
import TokenUsageSummary from './TokenUsageSummary';

describe('chatSubcomponents', () => {
  describe('configurable chat typography', () => {
    test('keeps composer text and its highlight overlay on one layout contract', () => {
      const composerSource = readFileSync(new URL('./ChatComposer.tsx', import.meta.url), 'utf8');
      const textareaMarkup = renderToStaticMarkup(<PromptInputTextarea />);

      assert.match(composerSource, /PROMPT_INPUT_TEXT_LAYOUT/);
      assert.ok(textareaMarkup.includes(PROMPT_INPUT_TEXT_LAYOUT));
      assert.equal(PROMPT_INPUT_TEXT_LAYOUT, 'font-sans px-4 pb-1 pt-3 text-base leading-6');
    });

    test('only ordinary user and assistant content opts into the reading scale', () => {
      const messageSource = readFileSync(new URL('./MessageComponent.tsx', import.meta.url), 'utf8');
      const markdownSource = readFileSync(new URL('./Markdown.tsx', import.meta.url), 'utf8');
      const globalStyles = readFileSync(new URL('../../../../index.css', import.meta.url), 'utf8');

      assert.equal((messageSource.match(/readingTypography/g) || []).length, 2);
      assert.equal((messageSource.match(/className="chat-reading [^"]*prose/g) || []).length, 2);
      assert.match(messageSource, /className="chat-reading prose/);
      assert.match(messageSource, /className="chat-reading prose-on-accent prose/);
      assert.doesNotMatch(messageSource, /className="chat-reading break-words"/);
      assert.match(messageSource, /className="chat-reading-code/);
      assert.doesNotMatch(messageSource, /mobileReadingDensity/);
      assert.match(markdownSource, /fontSize: readingTypography \? 'var\(--chat-code-size\)'/);
      assert.match(markdownSource, /chat-reading-table-cell/);
      assert.match(markdownSource, /chat-reading-paragraph/);
      assert.match(globalStyles, /--chat-prose-size: 16px;/);
      assert.match(globalStyles, /--chat-prose-base-line-height: 24px;/);
      assert.match(globalStyles, /--chat-prose-line-height: calc\(var\(--chat-prose-base-line-height\) \+ var\(--chat-line-height-offset\)\);/);
      assert.match(globalStyles, /data-chat-line-spacing="condensed"[^}]+--chat-line-height-offset: -2px;/s);
      assert.match(globalStyles, /data-chat-line-spacing="relaxed"[^}]+--chat-line-height-offset: 2px;/s);
      assert.match(globalStyles, /data-chat-line-spacing="spacious"[^}]+--chat-line-height-offset: 4px;/s);
    });
  });

  describe('composer voice controls', () => {
    test('keeps the mic between usage and Send and bounds readable errors inside the composer', () => {
      const composerSource = readFileSync(new URL('./ChatComposer.tsx', import.meta.url), 'utf8');
      const voiceInputSource = readFileSync(new URL('../../hooks/useVoiceInput.ts', import.meta.url), 'utf8');
      const micMarkup = composerSource.lastIndexOf('<VoiceInputButton');
      const usageMarkup = composerSource.lastIndexOf('<TokenUsageSummary');

      assert.ok(micMarkup > 0);
      assert.ok(micMarkup > usageMarkup);
      assert.match(composerSource, /<PromptInputTools className="min-w-0 flex-1 overflow-hidden">/);
      assert.match(composerSource, /className="ml-auto flex shrink-0 items-center gap-0\.5 sm:gap-1"/);
      assert.match(composerSource, /role="alert"/);
      assert.match(composerSource, /\[overflow-wrap:anywhere\]/);
      assert.doesNotMatch(composerSource, /isTranscribing\s*\?\s*\(\s*<Loader2/);
      assert.match(voiceInputSource, /navigator\.mediaDevices\?\.getUserMedia/);
      assert.match(voiceInputSource, /fetchDictationCaptureSettings/);
      assert.match(voiceInputSource, /getUserMedia\(\{ audio: captureSettings \}\)/);
      assert.match(voiceInputSource, /Microphone requires a secure HTTPS connection\./);
      assert.match(voiceInputSource, /rec\.onstart = \(\) => \{[\s\S]+setState\('recording'\)/);
      assert.doesNotMatch(voiceInputSource, /rec\.start\(\);\s+setState\('recording'\)/);
    });
  });

  describe('assistant message voice controls', () => {
    test('keeps the speaker beside the copy control on narrow screens', () => {
      const messageSource = readFileSync(new URL('./MessageComponent.tsx', import.meta.url), 'utf8');
      const copyControlSource = readFileSync(new URL('./MessageCopyControl.tsx', import.meta.url), 'utf8');
      const speakControlSource = readFileSync(new URL('./MessageSpeakControl.tsx', import.meta.url), 'utf8');
      const copyMarkup = messageSource.lastIndexOf('<MessageCopyControl content={assistantCopyContent}');
      const speakerMarkup = messageSource.lastIndexOf('<MessageSpeakControl');

      assert.ok(copyMarkup > 0);
      assert.ok(speakerMarkup > copyMarkup);
      assert.doesNotMatch(copyControlSource, /min-w-0 flex-1 items-center/);
      assert.match(speakControlSource, /voice\.generating/);
      assert.match(speakControlSource, /voice\.cancelGeneration/);
      assert.match(speakControlSource, /generationElapsedSeconds/);
      assert.match(speakControlSource, /max-w-\[min\(240px,calc\(100vw-2rem\)\)\]/);
    });
  });

  describe('image attachment galleries', () => {
    const mount = async (element: React.ReactNode) => {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const root = createRoot(container);
      await React.act(async () => {
        root.render(element);
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      });
      return { container, root };
    };

    test('navigates only viewable images in one chat message and stops at the ends', async () => {
      const { container, root } = await mount(
        <ChatMessageImages
          images={[
            { name: 'first.png', data: 'data:image/png;base64,first' },
            { name: 'unavailable.png' },
            { name: 'last.png', data: 'data:image/png;base64,last' },
          ]}
        />,
      );

      try {
        const firstThumbnail = container.querySelector<HTMLButtonElement>('[aria-label="Expand first.png"]');
        assert.ok(firstThumbnail);
        await React.act(async () => firstThumbnail.click());

        let dialog = document.querySelector<HTMLElement>('[role="dialog"]');
        assert.equal(dialog?.getAttribute('aria-label'), 'first.png');
        assert.equal(dialog?.querySelector('[aria-label="Previous image"]'), null);
        const nextButton = dialog?.querySelector<HTMLButtonElement>('[aria-label="Next image"]');
        assert.ok(nextButton);

        await React.act(async () => nextButton.click());
        dialog = document.querySelector<HTMLElement>('[role="dialog"]');
        assert.equal(dialog?.getAttribute('aria-label'), 'last.png');
        assert.equal(dialog?.querySelector('[aria-label="Next image"]'), null);
        assert.ok(dialog?.querySelector('[aria-label="Previous image"]'));

        await React.act(async () => {
          document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }));
        });
        assert.equal(document.querySelector('[role="dialog"]')?.getAttribute('aria-label'), 'first.png');

        await React.act(async () => {
          document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        });
        assert.equal(document.querySelector('[role="dialog"]'), null);
      } finally {
        await React.act(async () => root.unmount());
        container.remove();
      }
    });

    test('keeps a single-image preview free of navigation and closes from the backdrop', async () => {
      const { container, root } = await mount(
        <ChatMessageImages images={[{ name: 'only.png', data: 'data:image/png;base64,only' }]} />,
      );

      try {
        const thumbnail = container.querySelector<HTMLButtonElement>('[aria-label="Expand only.png"]');
        assert.ok(thumbnail);
        await React.act(async () => thumbnail.click());

        const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
        assert.ok(dialog);
        assert.equal(dialog.querySelector('[aria-label="Previous image"]'), null);
        assert.equal(dialog.querySelector('[aria-label="Next image"]'), null);

        await React.act(async () => dialog.click());
        assert.equal(document.querySelector('[role="dialog"]'), null);
      } finally {
        await React.act(async () => root.unmount());
        container.remove();
      }
    });

    test('keeps mixed composer files out of navigation and revokes image previews', async () => {
      const originalCreateObjectURL = URL.createObjectURL;
      const originalRevokeObjectURL = URL.revokeObjectURL;
      const revokedUrls: string[] = [];
      URL.createObjectURL = (value) => `blob:${(value as File).name}`;
      URL.revokeObjectURL = (url) => revokedUrls.push(url);

      const first = new File(['first'], 'first.png', { type: 'image/png', lastModified: 1 });
      const documentFile = new File(['document'], 'notes.pdf', { type: 'application/pdf', lastModified: 2 });
      const last = new File(['last'], 'last.png', { type: 'image/png', lastModified: 3 });
      const { container, root } = await mount(
        <ComposerAttachmentGallery
          files={[first, documentFile, last]}
          onRemove={() => {}}
          uploadingFiles={new Map()}
          fileErrors={new Map()}
        />,
      );

      try {
        const firstThumbnail = container.querySelector<HTMLButtonElement>('[aria-label="Expand first.png"]');
        assert.ok(firstThumbnail);
        await React.act(async () => firstThumbnail.click());

        let dialog = document.querySelector<HTMLElement>('[role="dialog"]');
        assert.equal(dialog?.getAttribute('aria-label'), 'first.png');
        const nextButton = dialog?.querySelector<HTMLButtonElement>('[aria-label="Next image"]');
        assert.ok(nextButton);
        await React.act(async () => nextButton.click());

        dialog = document.querySelector<HTMLElement>('[role="dialog"]');
        assert.equal(dialog?.getAttribute('aria-label'), 'last.png');
        assert.equal(dialog?.querySelector('[aria-label="Next image"]'), null);
      } finally {
        await React.act(async () => root.unmount());
        container.remove();
        URL.createObjectURL = originalCreateObjectURL;
        URL.revokeObjectURL = originalRevokeObjectURL;
      }

      assert.deepEqual(revokedUrls.sort(), ['blob:first.png', 'blob:last.png']);
    });
  });

  describe('ChatExportMenu', () => {
    test('enables results only with tool calls and loads complete history before export', async () => {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const root = createRoot(container);
      let loadAllCalls = 0;
      const originalCreateObjectURL = URL.createObjectURL;
      const originalRevokeObjectURL = URL.revokeObjectURL;
      const originalAnchorClick = window.HTMLAnchorElement.prototype.click;
      URL.createObjectURL = () => 'blob:chat-export-test';
      URL.revokeObjectURL = () => undefined;
      window.HTMLAnchorElement.prototype.click = () => undefined;

      try {
        await React.act(async () => {
          root.render(
            <ChatExportMenu
              messages={[{ type: 'assistant', content: 'Loaded page', timestamp: '2026-08-17T12:00:00.000Z' }]}
              sessionTitle="Export test"
              assistantLabel="Codex"
              hasMoreMessages
              isLoadingAllMessages={false}
              loadAllMessages={async () => {
                loadAllCalls += 1;
                return [{ type: 'assistant', content: 'Complete session', timestamp: '2026-08-17T12:00:00.000Z' }];
              }}
            />,
          );
        });

        await React.act(async () => {
          container.querySelector<HTMLButtonElement>('button[aria-label="Export chat"]')?.click();
        });

        const checkboxes = container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]');
        assert.equal(checkboxes.length, 3);
        assert.equal(checkboxes[1]?.disabled, true);

        await React.act(async () => {
          checkboxes[0]?.click();
        });
        assert.equal(container.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')[1]?.disabled, false);

        const markdownButton = Array.from(container.querySelectorAll<HTMLButtonElement>('button'))
          .find((button) => button.textContent?.includes('Markdown'));
        await React.act(async () => {
          markdownButton?.click();
          await Promise.resolve();
        });
        assert.equal(loadAllCalls, 1);
      } finally {
        await React.act(async () => root.unmount());
        container.remove();
        URL.createObjectURL = originalCreateObjectURL;
        URL.revokeObjectURL = originalRevokeObjectURL;
        window.HTMLAnchorElement.prototype.click = originalAnchorClick;
      }
    });
  });

  describe('TokenUsageSummary', () => {
    let root: Root | null = null;
    let container: HTMLDivElement | null = null;
    const originalFetch = globalThis.fetch;
    let claudeCreditSpend = 0;
    const providerUsageRequests: string[] = [];

    /** Reset labels are countdowns, so fixtures must sit in the future at run time. */
    const inMinutes = (minutes: number) => new Date(Date.now() + minutes * 60_000).toISOString();

    const usageByProvider = {
      claude: {
        provider: 'claude',
        supported: true,
        windows: [
          {
            id: 'seven_day',
            utilization: 25,
            resetsAt: inMinutes(3 * 1440 + 120),
            durationMinutes: 10_080,
          },
          {
            id: 'five_hour',
            utilization: 75,
            resetsAt: inMinutes(90),
            durationMinutes: 300,
          },
        ],
        credits: {
          kind: 'spend',
          enabled: true,
          usedAmount: 0,
          limitAmount: 50,
          currency: 'USD',
          utilization: 0,
        },
      },
      codex: {
        provider: 'codex',
        supported: true,
        windows: [
          {
            id: 'seven_day',
            utilization: 52,
            resetsAt: inMinutes(5 * 1440),
            durationMinutes: 10_080,
          },
        ],
        credits: {
          kind: 'balance',
          hasCredits: true,
          unlimited: false,
          balance: '$25.00',
        },
        activity: {
          lifetimeTokens: 1_250_000,
          peakDailyTokens: 250_000,
          currentStreakDays: 4,
          daily: [
            { date: '2026-08-08', tokens: 120_000 },
            { date: '2026-08-09', tokens: 80_000 },
          ],
        },
      },
    } as const;

    before(async () => {
      const commonTranslations = JSON.parse(readFileSync(
        new URL('../../../../i18n/locales/en/common.json', import.meta.url),
        'utf8',
      )) as Record<string, unknown>;
      await i18next.use(initReactI18next).init({
        lng: 'en',
        fallbackLng: false,
        defaultNS: 'common',
        resources: { en: { common: commonTranslations } },
      });

      globalThis.fetch = (async (input: RequestInfo | URL) => {
        providerUsageRequests.push(String(input));
        if (String(input).includes('/context-ceiling')) {
          return new Response(JSON.stringify({
            success: true,
            data: {
              total: 200_000,
              autoCompactThreshold: 167_000,
              isAutoCompactEnabled: true,
              ceilingSource: 'settings',
              ceilingCap: 200_000,
              modelContextWindow: 1_000_000,
            },
          }), { status: 200, headers: { 'Content-Type': 'application/json' } });
        }
        const provider = String(input).includes('/codex/') ? 'codex' : 'claude';
        const data = provider === 'claude'
          ? {
              ...usageByProvider.claude,
              credits: {
                ...usageByProvider.claude.credits,
                usedAmount: claudeCreditSpend,
                utilization: (claudeCreditSpend / usageByProvider.claude.credits.limitAmount) * 100,
              },
            }
          : usageByProvider.codex;
        return new Response(JSON.stringify({ success: true, data }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }) as typeof fetch;
    });

    after(() => {
      globalThis.fetch = originalFetch;
    });

    afterEach(async () => {
      await React.act(async () => root?.unmount());
      container?.remove();
      document.querySelectorAll('[role="dialog"]').forEach((dialog) => dialog.remove());
      root = null;
      container = null;
    });

    const mount = async (element: React.ReactNode) => {
      container = document.createElement('div');
      document.body.appendChild(container);
      root = createRoot(container);
      await React.act(async () => {
        root?.render(element);
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      });
      return container;
    };

    const openPopover = async (host: HTMLElement) => {
      const trigger = host.querySelector<HTMLButtonElement>('button');
      assert.ok(trigger);
      trigger.getBoundingClientRect = () => ({
        x: 340,
        y: 700,
        left: 340,
        right: 372,
        top: 700,
        bottom: 732,
        width: 32,
        height: 32,
        toJSON: () => ({}),
      });
      Object.defineProperty(window, 'innerWidth', { value: 384, configurable: true });
      Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
      await React.act(async () => trigger.click());
      const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
      assert.ok(dialog);
      return { trigger, dialog };
    };

    test('Claude usage follows the compact mockup order and drills into only its breakdown', async () => {
      let breakdownOpens = 0;
      const summary = (
        <TokenUsageSummary
          provider="claude"
          usage={{
            used: 117_721,
            total: 967_000,
            autoCompactThreshold: 934_000,
            isAutoCompactEnabled: true,
            ceilingSource: 'auto',
          }}
          request={{ id: 0, view: 'summary' }}
          onRequestBreakdown={() => { breakdownOpens += 1; }}
          onRefreshBreakdown={() => {}}
          isRefreshingBreakdown={false}
          canRefreshBreakdown={false}
        />
      );
      const host = await mount(summary);
      const { trigger, dialog } = await openPopover(host);
      const text = dialog.textContent || '';

      assert.equal(trigger.getAttribute('aria-label'), 'Show usage; credits available');
      assert.match(text, /Context & Usage/);
      assert.match(trigger.textContent || '', /\$/);
      assert.match(text, /Session118k \/ 934k · Auto13%/);
      // Label, reset and percentage on one line.
      assert.match(text, /5-hour limitResets in \d+h \d+m75%/);
      assert.match(text, /WeeklyResets in \d+d \d+h25%/);
      assert.ok(text.indexOf('5-hour limit') < text.indexOf('Weekly'));
      assert.match(text, /Credits\/Tokens\$0\.00/);
      assert.doesNotMatch(text, /Plan usage limits|Full usage|Refresh/);

      const refreshButton = dialog.querySelector<HTMLButtonElement>('button[aria-label="Refresh"]');
      assert.ok(refreshButton);
      const requestCountBeforeRefresh = providerUsageRequests.length;
      await React.act(async () => {
        refreshButton.click();
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      });
      assert.equal(providerUsageRequests.length, requestCountBeforeRefresh + 1);
      assert.match(providerUsageRequests.at(-1) || '', /[?&]refresh=true/);

      const link = dialog.querySelector<HTMLAnchorElement>('a');
      assert.equal(link?.textContent?.trim(), 'Manage Plan and Balance');
      assert.equal(link?.href, 'https://claude.ai/new#settings/usage');

      const breakdown = dialog.querySelector<HTMLButtonElement>(
        'button[aria-label="Session breakdown"]',
      );
      assert.ok(breakdown);
      await React.act(async () => breakdown.click());
      assert.equal(breakdownOpens, 1);
      assert.match(document.querySelector('[role="dialog"]')?.textContent || '', /Loading session breakdown/);

      await React.act(async () => root?.render(
        <TokenUsageSummary
          provider="claude"
          usage={{
            used: 117_721,
            total: 967_000,
            autoCompactThreshold: 934_000,
            isAutoCompactEnabled: true,
          }}
          request={{
            id: 1,
            view: 'breakdown',
            context: {
              provider: 'claude',
              detail: 'full',
              maxTokens: 967_000,
              autoCompactThreshold: 934_000,
              isAutoCompactEnabled: true,
              breakdown: {
                categories: [
                  { name: 'System prompt', tokens: 20_000 },
                  { name: 'Messages', tokens: 97_721 },
                  { name: 'Free space', tokens: 816_279 },
                  { name: 'Autocompact buffer', tokens: 33_000 },
                ],
                messageBreakdown: {
                  toolCallTokens: 0,
                  toolResultTokens: 10_000,
                  attachmentTokens: 0,
                  assistantMessageTokens: 40_000,
                  userMessageTokens: 47_721,
                  redirectedContextTokens: 0,
                  unattributedTokens: 0,
                },
              },
            },
          }}
          onRequestBreakdown={() => { breakdownOpens += 1; }}
          onRefreshBreakdown={() => {}}
          isRefreshingBreakdown={false}
          canRefreshBreakdown={false}
        />,
      ));
      const breakdownText = document.querySelector('[role="dialog"]')?.textContent || '';
      assert.match(breakdownText, /What is in the window/);
      assert.match(breakdownText, /Messages97,721/);
      // Expanded in place, so the session line it explains and the plan windows
      // stay on screen beside it rather than being swapped out.
      assert.match(breakdownText, /118k \/ 934k13%/);
      assert.match(breakdownText, /5-hour limit|Weekly/);
    });

    test('a session with no live frame derives its ceiling, and never lends it to another provider', async () => {
      const props = {
        request: { id: 0, view: 'summary' as const },
        onRequestBreakdown: () => {},
        onRefreshBreakdown: () => {},
        isRefreshingBreakdown: false,
        canRefreshBreakdown: false,
      };
      const host = await mount(
        <TokenUsageSummary provider="claude" usage={{ used: 0 }} model="opus" {...props} />,
      );
      const { dialog } = await openPopover(host);

      // Nothing has streamed, so the numbers come from the model and settings.json
      // rather than reading as a bare "0 tokens".
      assert.match(dialog.textContent || '', /Session0 \/ 167k · Custom0%/);

      // The composer survives a session switch; the Claude ceiling must not.
      await React.act(async () => {
        root?.render(<TokenUsageSummary provider="codex" usage={{ used: 0 }} {...props} />);
        await new Promise((resolve) => window.setTimeout(resolve, 0));
      });
      const codexText = document.querySelector('[role="dialog"]')?.textContent || '';
      assert.match(codexText, /Session0 tokens0%/);
      assert.doesNotMatch(codexText, /167k|Custom/);
    });

    test('a capped ceiling names its source and the model window behind it', async () => {
      const host = await mount(
        <TokenUsageSummary
          provider="claude"
          usage={{
            used: 114_222,
            total: 200_000,
            autoCompactThreshold: 167_000,
            isAutoCompactEnabled: true,
            ceilingSource: 'settings',
            ceilingCap: 200_000,
            modelContextWindow: 1_000_000,
          }}
          request={{ id: 0, view: 'summary' }}
          onRequestBreakdown={() => {}}
          onRefreshBreakdown={() => {}}
          isRefreshingBreakdown={false}
          canRefreshBreakdown={false}
        />,
      );
      const { dialog } = await openPopover(host);
      const text = dialog.textContent || '';

      assert.match(text, /114k \/ 167k · Custom/);
      // The cap belongs to the breakdown, so no row gains a second line here.
      assert.doesNotMatch(text, /capped at/);
      assert.doesNotMatch(text, /· Auto/);
      // The source word is the way in to the setting that produced it.
      assert.ok(dialog.querySelector('button[title^="Auto-compact"]'));
    });

    test('an uncapped ceiling says auto and shows no cap line', async () => {
      const host = await mount(
        <TokenUsageSummary
          provider="claude"
          usage={{
            used: 122_942,
            total: 1_000_000,
            autoCompactThreshold: 967_000,
            isAutoCompactEnabled: true,
            ceilingSource: 'auto',
            modelContextWindow: 1_000_000,
          }}
          request={{ id: 0, view: 'summary' }}
          onRequestBreakdown={() => {}}
          onRefreshBreakdown={() => {}}
          isRefreshingBreakdown={false}
          canRefreshBreakdown={false}
        />,
      );
      const { dialog } = await openPopover(host);
      const text = dialog.textContent || '';

      assert.match(text, /123k \/ 967k · Auto/);
      assert.doesNotMatch(text, /capped at/);
    });

    test('Codex omits breakdown and links weekly usage to account activity', async () => {
      const host = await mount(
        <TokenUsageSummary
          provider="codex"
          usage={{ used: 42_000, total: 258_400, isAutoCompactEnabled: false }}
          request={{ id: 0, view: 'summary' }}
          onRequestBreakdown={() => {}}
          onRefreshBreakdown={() => {}}
          isRefreshingBreakdown={false}
          canRefreshBreakdown={false}
        />,
      );
      const { dialog } = await openPopover(host);
      const text = dialog.textContent || '';

      assert.match(text, /Context & Usage/);
      assert.match(text, /Session42k \/ 258k16%/);
      assert.equal(dialog.querySelector('button[aria-label="Session breakdown"]'), null);
      assert.match(text, /WeeklyResets in \d+d \d+h52%/);
      // The per-window usage link is a chevron now, so it is named, not labelled.
      const labels = [...dialog.querySelectorAll('[aria-label]')]
        .map((node) => node.getAttribute('aria-label'));
      assert.ok(labels.includes('View Weekly usage'));
      assert.doesNotMatch(text, /5-hour/);
      assert.doesNotMatch(text, /Auto(?: off)?/);
      assert.match(text, /Credits\/Tokens\$25\.00/);
      assert.equal(
        dialog.querySelector<HTMLAnchorElement>('a')?.href,
        'https://chatgpt.com/#settings/Usage',
      );

      const usageButton = [...dialog.querySelectorAll<HTMLButtonElement>('button')]
        .find((button) => button.getAttribute('aria-label') === 'View Weekly usage');
      assert.ok(usageButton);
      await React.act(async () => usageButton.click());
      const activityText = document.querySelector('[role="dialog"]')?.textContent || '';
      assert.match(activityText, /Usage activity/);
      assert.match(activityText, /Lifetime tokens1\.25M/);
      assert.match(activityText, /Recent daily activity/);
      assert.doesNotMatch(activityText, /Session16%|Weekly52%|Credits\/Tokens/);
    });

    test('Claude does not claim exhausted spend credits are available', async () => {
      claudeCreditSpend = usageByProvider.claude.credits.limitAmount;
      const realDateNow = Date.now;
      Date.now = () => realDateNow() + 61_000;
      try {
        const host = await mount(
          <TokenUsageSummary
            provider="claude"
            usage={{ used: 10_000, total: 200_000 }}
            request={{ id: 0, view: 'summary' }}
            onRequestBreakdown={() => {}}
            onRefreshBreakdown={() => {}}
            isRefreshingBreakdown={false}
            canRefreshBreakdown={false}
          />,
        );
        const { trigger } = await openPopover(host);

        assert.equal(trigger.getAttribute('aria-label'), 'Show usage');
        assert.doesNotMatch(trigger.textContent || '', /\$/);
      } finally {
        claudeCreditSpend = 0;
        Date.now = realDateNow;
      }
    });

    test('an expanded breakdown does not carry one session\'s reading into the next', async () => {
      const summary = (sessionKey: string) => (
        <TokenUsageSummary
          provider="claude"
          usage={{ used: 10_000, total: 200_000 }}
          request={{
            id: 1,
            view: 'breakdown',
            context: {
              provider: 'claude',
              detail: 'full',
              usedTokens: 10_000,
              breakdown: { categories: [{ name: 'Session A memory', tokens: 4_000 }] },
            },
          }}
          onRequestBreakdown={() => {}}
          onRefreshBreakdown={() => {}}
          isRefreshingBreakdown={false}
          canRefreshBreakdown={false}
          sessionKey={sessionKey}
        />
      );
      // The `/context` request opens the panel itself, so no trigger click here.
      await mount(summary('session-a'));
      const dialog = document.querySelector('[role="dialog"]');
      assert.ok(dialog);
      assert.match(dialog.textContent || '', /Session A memory/);

      await React.act(async () => root?.render(summary('session-b')));
      const switched = document.querySelector('[role="dialog"]');
      assert.ok(switched);
      assert.doesNotMatch(switched.textContent || '', /Session A memory/);
      assert.equal(
        switched.querySelector('button[aria-label="Session breakdown"]')?.getAttribute('aria-expanded'),
        'false',
      );
    });
  });

  describe('ComposerMenus', () => {
    let root: Root | null = null;
    let container: HTMLDivElement | null = null;

    before(async () => {
      const chatTranslations = JSON.parse(readFileSync(
        new URL('../../../../i18n/locales/en/chat.json', import.meta.url),
        'utf8',
      )) as Record<string, unknown>;
      await i18next.use(initReactI18next).init({
        lng: 'en',
        fallbackLng: false,
        defaultNS: 'chat',
        resources: { en: { chat: chatTranslations } },
      });
    });

    afterEach(async () => {
      await React.act(async () => root?.unmount());
      container?.remove();
      document.querySelectorAll('[role="menu"]').forEach((menu) => menu.remove());
      Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true });
      window.dispatchEvent(new window.Event('resize'));
      root = null;
      container = null;
    });

    const mount = async (element: React.ReactNode) => {
      container = document.createElement('div');
      document.body.appendChild(container);
      root = createRoot(container);
      await React.act(async () => root?.render(element));
      return container;
    };

    test('routine permission toggle includes provider Auto but excludes elevated and special modes', () => {
      const modes = ['default', 'auto', 'acceptEdits', 'bypassPermissions', 'plan'];
      assert.equal(getNextRoutinePermissionMode('default', modes), 'auto');
      assert.equal(getNextRoutinePermissionMode('auto', modes), 'acceptEdits');
      assert.equal(getNextRoutinePermissionMode('acceptEdits', modes), 'default');
      assert.equal(getNextRoutinePermissionMode('plan', modes), 'default');
      assert.equal(getNextRoutinePermissionMode('bypassPermissions', modes), 'default');
      assert.equal(
        getNextRoutinePermissionMode('default', ['default', 'acceptEdits', 'bypassPermissions']),
        'acceptEdits',
      );
    });

    test('dragging across the effort track previews locally and commits once on release', async () => {
      const effortSelections: string[] = [];
      const host = await mount(
        <ComposerModelMenu
          effort="high"
          effortOptions={[{ value: 'low' }, { value: 'high' }]}
          onSelectEffort={(value) => effortSelections.push(value)}
          model="model-a"
          modelOptions={[{ value: 'model-a', label: 'Model A' }]}
          onSelectModel={async () => {}}
          modelsLoading={false}
          openRequest={0}
          provider="claude"
          providerLabel="Claude"
        />,
      );

      const trigger = host.querySelector('button');
      assert.ok(trigger);
      await React.act(async () => trigger.click());

      // Three stops across 208px: default 0-69, low 69-138, high 138-208.
      const effortTrack = document.querySelector<HTMLElement>('[role="radiogroup"]');
      assert.ok(effortTrack);
      effortTrack.getBoundingClientRect = () => ({
        x: 0, y: 0, left: 0, right: 208, top: 0, bottom: 32, width: 208, height: 32,
        toJSON: () => ({}),
      });
      const checkedLabel = () => document
        .querySelector<HTMLElement>('[role="radio"][aria-checked="true"]')
        ?.getAttribute('aria-label');

      await React.act(async () => {
        effortTrack.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 190 }));
        effortTrack.dispatchEvent(new window.MouseEvent('pointermove', { bubbles: true, button: 0, clientX: 10 }));
      });
      assert.equal(checkedLabel(), 'Default', 'the track paints the dragged-over stop');
      assert.deepEqual(effortSelections, [], 'a drag in progress writes nothing');

      await React.act(async () => {
        effortTrack.dispatchEvent(new window.MouseEvent('pointermove', { bubbles: true, button: 0, clientX: 100 }));
      });
      assert.equal(checkedLabel(), 'low');
      assert.deepEqual(effortSelections, [], 'crossing three stops is still one choice');

      await React.act(async () => {
        effortTrack.dispatchEvent(new window.MouseEvent('pointerup', { bubbles: true, button: 0, clientX: 100 }));
      });
      assert.deepEqual(effortSelections, ['low'], 'release commits exactly once');
    });

    test('tapping an effort stop snaps to that exact value once', async () => {
      const effortSelections: string[] = [];
      const host = await mount(
        <ComposerModelMenu
          effort="high"
          effortOptions={[{ value: 'low' }, { value: 'high' }]}
          onSelectEffort={(value) => effortSelections.push(value)}
          model="model-a"
          modelOptions={[{ value: 'model-a', label: 'Model A' }]}
          onSelectModel={async () => {}}
          modelsLoading={false}
          openRequest={0}
          provider="claude"
          providerLabel="Claude"
        />,
      );

      const trigger = host.querySelector('button');
      assert.ok(trigger);
      await React.act(async () => trigger.click());

      const effortTrack = document.querySelector<HTMLElement>('[role="radiogroup"]');
      assert.ok(effortTrack);
      effortTrack.getBoundingClientRect = () => ({
        x: 0, y: 0, left: 0, right: 208, top: 0, bottom: 32, width: 208, height: 32,
        toJSON: () => ({}),
      });

      await React.act(async () => {
        effortTrack.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 100 }));
        effortTrack.dispatchEvent(new window.MouseEvent('pointerup', { bubbles: true, button: 0, clientX: 100 }));
      });

      assert.deepEqual(effortSelections, ['low']);

      const defaultStop = document.querySelector<HTMLButtonElement>('[role="radio"][aria-label="Default"]');
      assert.ok(defaultStop);
      await React.act(async () => defaultStop.click());
      assert.deepEqual(effortSelections, ['low', 'default'], 'keyboard-style activation stays available');
    });

    test('a drag returning to where it started commits nothing', async () => {
      const effortSelections: string[] = [];
      const host = await mount(
        <ComposerModelMenu
          effort="high"
          effortOptions={[{ value: 'low' }, { value: 'high' }]}
          onSelectEffort={(value) => effortSelections.push(value)}
          model="model-a"
          modelOptions={[{ value: 'model-a', label: 'Model A' }]}
          onSelectModel={async () => {}}
          modelsLoading={false}
          openRequest={0}
          provider="claude"
          providerLabel="Claude"
        />,
      );

      const trigger = host.querySelector('button');
      assert.ok(trigger);
      await React.act(async () => trigger.click());

      const effortTrack = document.querySelector<HTMLElement>('[role="radiogroup"]');
      assert.ok(effortTrack);
      effortTrack.getBoundingClientRect = () => ({
        x: 0, y: 0, left: 0, right: 208, top: 0, bottom: 32, width: 208, height: 32,
        toJSON: () => ({}),
      });

      await React.act(async () => {
        effortTrack.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 190 }));
        effortTrack.dispatchEvent(new window.MouseEvent('pointermove', { bubbles: true, button: 0, clientX: 10 }));
        effortTrack.dispatchEvent(new window.MouseEvent('pointermove', { bubbles: true, button: 0, clientX: 190 }));
        effortTrack.dispatchEvent(new window.MouseEvent('pointerup', { bubbles: true, button: 0, clientX: 190 }));
      });
      assert.deepEqual(effortSelections, []);
      assert.equal(
        document.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]')?.getAttribute('aria-label'),
        'high',
        'the preview clears back to the committed value',
      );
    });

    test('model trigger opens one menu containing reasoning and model choices', async () => {
      const effortSelections: string[] = [];
      const modelSelections: string[] = [];
      const host = await mount(
        <ComposerModelMenu
          effort="high"
          effortOptions={[{ value: 'low' }, { value: 'high' }]}
          onSelectEffort={(value) => effortSelections.push(value)}
          model="model-b"
          modelOptions={[
            { value: 'model-a', label: 'Model A', description: 'A long model description' },
            { value: 'model-b', label: 'Model B', description: 'Another long model description' },
          ]}
          onSelectModel={async (value) => { modelSelections.push(value); }}
          modelsLoading={false}
          openRequest={0}
          provider="claude"
          providerLabel="Claude"
        />,
      );

      const trigger = host.querySelector('button');
      assert.ok(trigger);
      trigger.getBoundingClientRect = () => ({
        x: 16,
        y: 700,
        left: 16,
        right: 176,
        top: 700,
        bottom: 732,
        width: 160,
        height: 32,
        toJSON: () => ({}),
      });
      Object.defineProperty(window, 'innerWidth', { value: 384, configurable: true });
      assert.match(trigger.textContent || '', /Model B/);
      assert.match(trigger.textContent || '', /high/);

      await React.act(async () => trigger.click());
      const menu = document.querySelector('[role="menu"]');
      assert.match(menu?.textContent || '', /Model A/);
      assert.match(menu?.textContent || '', /Effort/);
      assert.match(menu?.textContent || '', /high/);
      assert.doesNotMatch(menu?.textContent || '', /long model description/);
      const menuRight = Number.parseFloat((menu as HTMLElement).style.right);
      const menuMaxWidth = Number.parseFloat((menu as HTMLElement).style.maxWidth);
      assert.ok(window.innerWidth - menuRight - menuMaxWidth >= 8, 'menu stays inside the left viewport edge');

      const effortTrack = document.querySelector<HTMLElement>('[role="radiogroup"]');
      assert.ok(effortTrack);
      effortTrack.getBoundingClientRect = () => ({
        x: 0,
        y: 0,
        left: 0,
        right: 208,
        top: 0,
        bottom: 32,
        width: 208,
        height: 32,
        toJSON: () => ({}),
      });
      await React.act(async () => {
        effortTrack.dispatchEvent(new window.MouseEvent('pointerdown', { bubbles: true, button: 0, clientX: 190 }));
        effortTrack.dispatchEvent(new window.MouseEvent('pointermove', { bubbles: true, button: 0, clientX: 10 }));
        effortTrack.dispatchEvent(new window.MouseEvent('pointerup', { bubbles: true, button: 0, clientX: 10 }));
      });
      assert.deepEqual(effortSelections, ['default']);

      const lowEffortButton = document.querySelector<HTMLButtonElement>('[role="radio"][aria-label="low"]');
      assert.ok(lowEffortButton);
      await React.act(async () => lowEffortButton.click());
      assert.deepEqual(effortSelections, ['default', 'low']);
      assert.ok(document.querySelector('[role="menu"]'), 'effort selection keeps the combined menu open');

      const modelAButton = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')]
        .find((button) => button.textContent?.includes('Model A'));
      assert.ok(modelAButton);
      await React.act(async () => modelAButton.click());
      assert.deepEqual(modelSelections, ['model-a']);
    });

    test('model selection stays open and reports a failed session update', async () => {
      const host = await mount(
        <ComposerModelMenu
          effort="default"
          effortOptions={[]}
          onSelectEffort={() => {}}
          model="model-a"
          modelOptions={[
            { value: 'model-a', label: 'Model A' },
            { value: 'model-b', label: 'Model B' },
          ]}
          onSelectModel={async () => {
            throw new Error('Unable to change the active model for this session.');
          }}
          modelsLoading={false}
          openRequest={0}
          provider="claude"
          providerLabel="Claude"
        />,
      );

      const trigger = host.querySelector<HTMLButtonElement>('button');
      assert.ok(trigger);
      await React.act(async () => trigger.click());
      const modelBButton = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')]
        .find((button) => button.textContent?.includes('Model B'));
      assert.ok(modelBButton);

      await React.act(async () => modelBButton.click());

      assert.ok(document.querySelector('[role="menu"]'), 'failed selection leaves the menu open');
      assert.match(
        document.querySelector('[role="alert"]')?.textContent || '',
        /Unable to change the active model for this session/,
      );
    });

    const mountModelMenu = (overrides: Partial<React.ComponentProps<typeof ComposerModelMenu>> = {}) => mount(
      <ComposerModelMenu
        effort="default"
        effortOptions={[]}
        onSelectEffort={() => {}}
        model="model-a"
        modelOptions={[{ value: 'model-a', label: 'Model A' }]}
        onSelectModel={async () => {}}
        modelsLoading={false}
        openRequest={0}
        provider="claude"
        providerLabel="Claude"
        providerOptions={[
          { value: 'claude', label: 'Claude', connected: true, loading: false },
          { value: 'codex', label: 'Codex', connected: true, loading: false },
          { value: 'cursor', label: 'Cursor', connected: false, loading: false },
          { value: 'opencode', label: 'OpenCode', connected: false, loading: false },
        ]}
        {...overrides}
      />,
    );

    test('a new chat can switch provider from the model menu', async () => {
      const providerSelections: string[] = [];
      const host = await mountModelMenu({ onSelectProvider: (next) => providerSelections.push(next) });

      const trigger = host.querySelector<HTMLButtonElement>('button');
      assert.ok(trigger);
      await React.act(async () => trigger.click());

      const providerRow = document.querySelector<HTMLButtonElement>('[role="menu"] [aria-label="Select model provider"]');
      assert.ok(providerRow, 'the model menu heads with the provider');
      assert.match(providerRow.textContent || '', /Claude/);
      assert.ok(providerRow.querySelector('svg[aria-label="Claude"]'), 'the provider row carries its logo');
      await React.act(async () => providerRow.click());

      const menu = document.querySelector('[role="menu"]');
      assert.match(menu?.textContent || '', /Codex/);
      assert.doesNotMatch(menu?.textContent || '', /Cursor/);
      assert.doesNotMatch(menu?.textContent || '', /OpenCode/);
      assert.ok(menu?.querySelector('svg[aria-label="Claude"]'), 'the current provider choice carries its logo');
      assert.ok(menu?.querySelector('svg[aria-label="Codex"]'), 'the other provider choice carries its logo');
      assert.doesNotMatch(menu?.textContent || '', /Model A/, 'the provider list replaces the model list');

      const codexButton = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')]
        .find((button) => button.textContent?.includes('Codex'));
      assert.ok(codexButton);
      await React.act(async () => codexButton.click());

      assert.deepEqual(providerSelections, ['codex']);
      assert.match(
        document.querySelector('[role="menu"]')?.textContent || '',
        /Model A/,
        'picking a provider returns to the model list',
      );
    });

    test('an established session shows its provider without offering a switch', async () => {
      const host = await mountModelMenu({ onSelectProvider: null });

      const trigger = host.querySelector<HTMLButtonElement>('button');
      assert.ok(trigger);
      await React.act(async () => trigger.click());

      const menu = document.querySelector('[role="menu"]');
      assert.match(menu?.textContent || '', /Claude/, 'the provider stays visible as a label');
      assert.ok(menu?.querySelector('svg[aria-label="Claude"]'), 'the static provider row carries its logo');
      assert.equal(
        document.querySelector('[role="menu"] [aria-label="Select model provider"]'),
        null,
        'no provider switcher once the session exists',
      );
    });

    test('a disconnected new-chat provider can switch to the sole connected provider', async () => {
      const host = await mountModelMenu({
        provider: 'claude',
        providerLabel: 'Claude',
        providerOptions: [
          { value: 'claude', label: 'Claude', connected: false, loading: false },
          { value: 'codex', label: 'Codex', connected: true, loading: false },
        ],
        onSelectProvider: () => {},
      });

      const trigger = host.querySelector<HTMLButtonElement>('button');
      assert.ok(trigger);
      await React.act(async () => trigger.click());

      const providerRow = document.querySelector<HTMLButtonElement>('[role="menu"] [aria-label="Select model provider"]');
      assert.ok(providerRow, 'the sole connected alternative remains reachable');
      await React.act(async () => providerRow.click());

      const menu = document.querySelector('[role="menu"]');
      assert.match(menu?.textContent || '', /Codex/);
      assert.doesNotMatch(menu?.textContent || '', /Claude/);
    });

    test('a new chat retains provider selection while connection checks load', async () => {
      const host = await mountModelMenu({
        providerOptions: [
          { value: 'claude', label: 'Claude', connected: false, loading: true },
          { value: 'codex', label: 'Codex', connected: false, loading: true },
        ],
        onSelectProvider: () => {},
      });

      const trigger = host.querySelector<HTMLButtonElement>('button');
      assert.ok(trigger);
      await React.act(async () => trigger.click());

      const providerRow = document.querySelector<HTMLButtonElement>('[role="menu"] [aria-label="Select model provider"]');
      assert.ok(providerRow, 'connection loading never removes provider selection');
      await React.act(async () => providerRow.click());

      assert.match(document.querySelector('[role="menu"]')?.textContent || '', /Checking connected providers/);
    });

    test('desktop permission trigger toggles routine access while the chevron opens every mode', async () => {
      Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true });
      const selections: string[] = [];
      const host = await mount(
        <ComposerPermissionMenu
          permissionMode="default"
          permissionModes={['default', 'auto', 'acceptEdits', 'bypassPermissions']}
          onSelectPermissionMode={(mode) => selections.push(mode)}
          collaborationMode={null}
          collaborationModes={[]}
          onSelectCollaborationMode={() => {}}
          provider="claude"
          providerLabel="Claude"
        />,
      );

      const trigger = host.querySelector<HTMLButtonElement>('button');
      assert.ok(trigger);
      await React.act(async () => trigger.click());
      assert.deepEqual(selections, ['auto']);
      assert.equal(document.querySelector('[role="menu"]'), null, 'quick toggle does not open the full picker');

      const menuTrigger = host.querySelector<HTMLButtonElement>('[aria-label="Show all access modes"]');
      assert.ok(menuTrigger);
      assert.match(menuTrigger.className, /hidden.*sm:flex/, 'the picker arrow remains desktop-only');
      await React.act(async () => menuTrigger.click());

      const menu = document.querySelector('[role="menu"]');
      assert.match(menu?.textContent || '', /Permissions/);
      assert.match(menu?.textContent || '', /Ask Before Tools/);
      assert.doesNotMatch(menu?.textContent || '', /Default Mode/);

      const bypassButton = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')]
        .find((button) => button.textContent?.toLowerCase().includes('bypass'));
      assert.ok(bypassButton);
      await React.act(async () => bypassButton.click());
      assert.deepEqual(selections, ['auto', 'bypassPermissions']);
    });

    test('mobile permission tap opens the complete picker without cycling access', async () => {
      Object.defineProperty(window, 'innerWidth', { value: 384, configurable: true });
      const permissionSelections: string[] = [];
      const collaborationSelections: string[] = [];
      const host = await mount(
        <ComposerPermissionMenu
          permissionMode="default"
          permissionModes={['default', 'acceptEdits', 'bypassPermissions']}
          onSelectPermissionMode={(mode) => permissionSelections.push(mode)}
          collaborationMode="build"
          collaborationModes={['build', 'plan']}
          onSelectCollaborationMode={(mode) => collaborationSelections.push(mode)}
          provider="codex"
          providerLabel="Codex"
        />,
      );

      const trigger = host.querySelector<HTMLButtonElement>('button');
      assert.ok(trigger);
      await React.act(async () => trigger.click());

      const menu = document.querySelector<HTMLElement>('[role="menu"]');
      assert.ok(menu, 'one tap opens the complete picker');
      assert.match(menu.textContent || '', /Permissions/);
      assert.match(menu.textContent || '', /Build/);
      assert.match(menu.textContent || '', /Plan/);
      assert.deepEqual(permissionSelections, [], 'opening the picker does not cycle access');
      assert.deepEqual(collaborationSelections, []);
      assert.equal(trigger.getAttribute('aria-haspopup'), 'menu');
      assert.equal(trigger.getAttribute('aria-expanded'), 'true');

      const menuTrigger = host.querySelector<HTMLButtonElement>('[aria-label="Show all access modes"]');
      assert.ok(menuTrigger);
      assert.match(menuTrigger.className, /hidden.*sm:flex/, 'mobile still has no separate chevron');
    });

    test('Codex access presets stay independent from Build and Plan collaboration', async () => {
      Object.defineProperty(window, 'innerWidth', { value: 1024, configurable: true });
      const permissionSelections: string[] = [];
      const collaborationSelections: string[] = [];
      const host = await mount(
        <ComposerPermissionMenu
          permissionMode="acceptEdits"
          permissionModes={['default', 'acceptEdits', 'bypassPermissions']}
          onSelectPermissionMode={(mode) => permissionSelections.push(mode)}
          collaborationMode="build"
          collaborationModes={['build', 'plan']}
          onSelectCollaborationMode={(mode) => collaborationSelections.push(mode)}
          provider="codex"
          providerLabel="Codex"
        />,
      );

      const menuTrigger = host.querySelector<HTMLButtonElement>('[aria-label="Show all access modes"]');
      assert.ok(menuTrigger);
      await React.act(async () => menuTrigger.click());

      const menu = document.querySelector('[role="menu"]');
      assert.match(menu?.textContent || '', /Permissions/);
      assert.match(menu?.textContent || '', /Ask When Needed/);
      assert.match(menu?.textContent || '', /Auto in Workspace/);
      assert.match(menu?.textContent || '', /Full Access/);
      assert.doesNotMatch(menu?.textContent || '', /Default Mode|Accept Edits|Bypass Permissions/);

      const mobileModeGroup = document.querySelector<HTMLElement>('[role="menu"] [role="group"]');
      assert.ok(mobileModeGroup);
      assert.match(mobileModeGroup.className, /sm:hidden/, 'mobile keeps collaboration in the complete picker');
      assert.match(mobileModeGroup.textContent || '', /Build/);
      assert.match(mobileModeGroup.textContent || '', /Plan/);

      const modeToggle = host.querySelector<HTMLButtonElement>(
        '[aria-label^="Collaboration mode Build. Switch to Plan"]',
      );
      assert.ok(modeToggle);
      assert.match(modeToggle.parentElement?.className || '', /hidden.*sm:flex/, 'the split mode control is desktop-only');
      assert.match(modeToggle.textContent || '', /Build/, 'desktop names the active collaboration mode');
      assert.ok(!modeToggle.className.split(/\s+/).includes('bg-muted'), 'Build is not permanently highlighted');
      await React.act(async () => modeToggle.click());

      assert.deepEqual(collaborationSelections, ['plan']);
      assert.deepEqual(permissionSelections, []);

      const modeMenuTrigger = host.querySelector<HTMLButtonElement>('[aria-label="Show collaboration modes"]');
      assert.ok(modeMenuTrigger);
      assert.ok(!modeMenuTrigger.className.split(/\s+/).includes('bg-muted'), 'the closed chevron is not highlighted');
      await React.act(async () => modeMenuTrigger.click());

      assert.ok(modeMenuTrigger.className.split(/\s+/).includes('bg-muted'), 'the open chevron is highlighted');

      const modeMenu = document.querySelector<HTMLElement>('[role="menu"]');
      assert.match(modeMenu?.textContent || '', /Collaboration mode/);
      assert.match(modeMenu?.textContent || '', /Implement changes and complete the task/);
      assert.match(modeMenu?.textContent || '', /Investigate and agree an approach before implementation/);
      assert.match(modeMenu?.textContent || '', /Shift\+Tab cycles Build and Plan/);
    });
  });

  describe('NativeImageAttachmentPicker', () => {
    test('renders the real file input over the visible attachment control', () => {
      let requestedProps: Record<string, unknown> | undefined;
      const html = renderToStaticMarkup(
        React.createElement(NativeImageAttachmentPicker, {
          label: 'Attach images',
          getInputProps: (props: unknown) => {
            requestedProps = props as Record<string, unknown>;
            return { ...requestedProps, accept: 'image/*', multiple: true, type: 'file' };
          },
        }),
      );

      assert.equal(requestedProps?.['aria-label'], 'Attach images');
      assert.equal(requestedProps?.tabIndex, 0);
      assert.deepEqual(requestedProps?.style, {
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        opacity: 0,
        cursor: 'pointer',
      });
      assert.match(html, /<input[^>]+type="file"/);
      assert.match(html, /<input[^>]+aria-label="Attach images"/);
      assert.doesNotMatch(html, /<button/);
      assert.match(html, /lucide-plus/);
      assert.doesNotMatch(html, /lucide-paperclip/);
    });
  });

  describe('CompactBoundaryDivider', () => {
    test('states the trigger, the tokens saved, and how long it took', () => {
      const html = renderToStaticMarkup(
        <CompactBoundaryDivider
          boundary={{ trigger: 'auto', preTokens: 122537, postTokens: 15517, durationMs: 119489 }}
        />,
      );
      assert.match(html, /123K → 16K/);
      assert.match(html, /1m 59s/);
      assert.match(html, /auto-compacted/i);
    });

    test('renders the divider with whatever the provider reported, and nothing more', () => {
      const html = renderToStaticMarkup(<CompactBoundaryDivider boundary={{ trigger: 'manual', preTokens: null, postTokens: null, durationMs: null }} />);
      assert.doesNotMatch(html, /→|NaN|null/);
      assert.doesNotMatch(html, /auto-compacted/i);
    });
  });
});

describe('QuestionAnswerContent', () => {
  // Regression coverage for the chat-interface crash where an AskUserQuestion
  // payload loaded from a session transcript arrives with a non-array `questions`
  // or a question missing its `options` array. Rendering must degrade gracefully
  // instead of throwing "TypeError: e.map is not a function".

  test('renders without throwing when questions is a non-array value', () => {
    assert.doesNotThrow(() => {
      renderToStaticMarkup(
        React.createElement(QuestionAnswerContent, {
          // Malformed: object instead of an array
          questions: { 0: { question: 'q?', options: [{ label: 'a' }] } } as never,
          answers: {},
        }),
      );
    });
  });

  test('renders without throwing when a question is missing options[]', () => {
    assert.doesNotThrow(() => {
      renderToStaticMarkup(
        React.createElement(QuestionAnswerContent, {
          questions: [{ question: 'Pick one?', header: 'H' } as never],
          answers: { 'Pick one?': 'X' },
        }),
      );
    });
  });

  test('renders without throwing when options[] contains malformed entries', () => {
    assert.doesNotThrow(() => {
      renderToStaticMarkup(
        React.createElement(QuestionAnswerContent, {
          questions: [{ question: 'Pick one?', options: [null, 'oops', { label: 'A' }] } as never],
          answers: { 'Pick one?': 'A, Custom' },
        }),
      );
    });
  });

  test('renders without throwing when a questions entry is null/non-object', () => {
    assert.doesNotThrow(() => {
      renderToStaticMarkup(
        React.createElement(QuestionAnswerContent, {
          questions: [null, 'oops', { question: 'Ok?', options: [{ label: 'A' }] }] as never,
          answers: {},
        }),
      );
    });
  });

  test('renders without throwing when an answer is a non-string value', () => {
    assert.doesNotThrow(() => {
      renderToStaticMarkup(
        React.createElement(QuestionAnswerContent, {
          questions: [{ question: 'Pick one?', options: [{ label: 'A' }] }],
          // Malformed: answer is an object instead of the expected string
          answers: { 'Pick one?': { unexpected: true } } as never,
        }),
      );
    });
  });

  test('still renders a well-formed question + answer', () => {
    const html = renderToStaticMarkup(
      React.createElement(QuestionAnswerContent, {
        questions: [{ question: 'Pick one?', header: 'H', options: [{ label: 'A' }, { label: 'B' }] }],
        answers: { 'Pick one?': 'A' },
      }),
    );
    assert.ok(html.includes('Pick one?'));
  });

  // Regression coverage for custom "Other" answers containing ", ": the answer
  // string is comma-joined at write time (the Agent SDK's multi-select format),
  // and the renderer must not split the user's free text apart on that delimiter.

  test('keeps a comma-containing custom answer as a single chip', () => {
    const html = renderToStaticMarkup(
      React.createElement(QuestionAnswerContent, {
        questions: [{ question: 'Proceed?', options: [{ label: 'Yes' }, { label: 'No' }] }],
        answers: { 'Proceed?': 'Sure, do it now, please' },
      }),
    );
    assert.ok(html.includes('Sure, do it now, please'));
    assert.equal(html.split('(custom)').length - 1, 1);
  });

  test('separates a selected option from a comma-containing custom answer', () => {
    const html = renderToStaticMarkup(
      React.createElement(QuestionAnswerContent, {
        questions: [{ question: 'Which?', options: [{ label: 'A' }, { label: 'B' }], multiSelect: true }],
        answers: { 'Which?': 'A, custom part one, part two' },
      }),
    );
    assert.ok(html.includes('custom part one, part two'));
    // Only the merged custom fragment is tagged (custom); "A" matched an option.
    assert.equal(html.split('(custom)').length - 1, 1);
  });

  test('still splits a plain multi-select answer into option labels', () => {
    const html = renderToStaticMarkup(
      React.createElement(QuestionAnswerContent, {
        questions: [{ question: 'Which?', options: [{ label: 'A' }, { label: 'B' }], multiSelect: true }],
        answers: { 'Which?': 'A, B' },
      }),
    );
    assert.ok(html.includes('>A<'));
    assert.ok(html.includes('>B<'));
    assert.ok(!html.includes('(custom)'));
  });

  test('renders Codex answer arrays by stable id and keeps secret answers redacted', () => {
    const html = renderToStaticMarkup(
      React.createElement(QuestionAnswerContent, {
        questions: [
          { id: 'choice', question: 'Pick one?', options: [{ label: 'A' }] },
          { id: 'secret', question: 'Token?', options: [], isSecret: true },
        ],
        answers: {
          choice: ['A', 'custom answer'],
          secret: ['[redacted]'],
        },
      }),
    );
    assert.ok(html.includes('>A<'));
    assert.ok(html.includes('custom answer'));
    assert.ok(html.includes('[redacted]'));
  });

  test('provider-neutral input panel renders Codex wording, descriptions, countdown, Other, and masked input', () => {
    const html = renderToStaticMarkup(
      React.createElement(UserInputRequestPanel, {
        request: {
          requestId: 'request-1',
          provider: 'codex',
          sessionId: 'session-1',
          requestType: 'user_input',
          toolName: 'request_user_input',
          input: {},
          receivedAt: new Date().toISOString(),
          isBlocking: false,
          expiresAt: new Date(Date.now() + 5_000).toISOString(),
          autoResolutionMs: 5_000,
          questions: [{
            id: 'secret',
            header: 'Secret',
            question: 'Provide a token',
            options: [{ label: 'Use saved', description: 'Use the existing token' }],
            allowOther: true,
            isSecret: true,
            multiSelect: false,
          }],
        },
        onDecision: () => {},
      }),
    );
    assert.ok(html.includes('Codex needs your input'));
    assert.ok(html.includes('Use the existing token'));
    assert.ok(html.includes('Other'));
    assert.ok(html.includes('Skips in'));
  });

  test('blocking input panel ignores an expiry and renders no countdown', () => {
    const html = renderToStaticMarkup(
      React.createElement(UserInputRequestPanel, {
        request: {
          requestId: 'request-blocking',
          provider: 'codex',
          sessionId: 'session-1',
          requestType: 'user_input',
          toolName: 'request_user_input',
          receivedAt: new Date().toISOString(),
          isBlocking: true,
          expiresAt: new Date(Date.now() + 5_000).toISOString(),
          questions: [{
            id: 'choice',
            question: 'Choose one',
            options: [{ label: 'A' }],
          }],
        },
        onDecision: () => {},
      }),
    );
    assert.ok(!html.includes('Skips in'));
  });

  test('free-text-only secret questions render a password input', () => {
    const html = renderToStaticMarkup(
      React.createElement(UserInputRequestPanel, {
        request: {
          requestId: 'request-2',
          provider: 'codex',
          sessionId: 'session-1',
          requestType: 'user_input',
          toolName: 'request_user_input',
          receivedAt: new Date().toISOString(),
          questions: [{
            id: 'secret',
            question: 'Provide a token',
            options: [],
            allowOther: false,
            isSecret: true,
          }],
        },
        onDecision: () => {},
      }),
    );
    assert.ok(html.includes('type="password"'));
    assert.ok(html.includes('Enter secret'));
  });

  test('provider answer adapter preserves Codex arrays and Claude question-text comma strings', () => {
    const questions = [
      { id: 'stable-id', question: 'Which?' },
      { id: 'other-id', question: 'Why?' },
    ];
    const answers = {
      'stable-id': ['A', 'B'],
      'other-id': ['Because'],
    };
    assert.deepEqual(adaptUserInputAnswers('codex', questions, answers), answers);
    assert.deepEqual(adaptUserInputAnswers('claude', questions, answers), {
      'Which?': 'A, B',
      'Why?': 'Because',
    });
  });
});
