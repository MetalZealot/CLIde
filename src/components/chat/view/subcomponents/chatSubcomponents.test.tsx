import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import test, { after, afterEach, before, describe } from 'node:test';

import i18next from 'i18next';
import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { Download, RotateCcw } from 'lucide-react';

import type { BrowserSessionSummary } from '../../../../../shared/browser-use';
import ChatBrowserPreview from '../../../browser-use/view/ChatBrowserPreview';
import { HeaderMenuProvider, useRegisterHeaderMenu, type HeaderMenuSection } from '../../../../contexts/HeaderMenuContext';
import { PaletteOpsProvider, usePaletteOpsRegister } from '../../../../contexts/PaletteOpsContext';
import MainContentHeaderMenu from '../../../main-content/view/subcomponents/MainContentHeaderMenu';
import { PROMPT_INPUT_TEXT_LAYOUT, PromptInputTextarea } from '../../../../shared/view/ui';
import { QuestionAnswerContent } from '../../tools/components/ContentRenderers/QuestionAnswerContent';
import { adaptUserInputAnswers } from '../../tools/components/InteractiveRenderers/user-input-request.adapter';
import { UserInputRequestPanel } from '../../tools/components/InteractiveRenderers/UserInputRequestPanel';
import { asyncQuestionDraftKey } from '../../utils/asyncQuestionState';
import { getNextRoutinePermissionMode } from '../../utils/chatPermissions';
import { DEFAULT_CHAT_EXPORT_INCLUDE } from '../../utils/chatExport';
import type { ChatMessage } from '../../types/types';
import { describeActivity, describeOperation, operationLabel, summarizeActivity } from '../../utils/toolActivity';
import { formatClockTime, formatMessageTimestamp, setClockFormat } from '../../../../utils/formatTime';
import {
  DEFAULT_THINKING_MESSAGE_CYCLE_MODE,
  DEFAULT_THINKING_MESSAGE_ORDER,
  MAX_THINKING_MESSAGE_LENGTH,
  MAX_THINKING_MESSAGES,
  THINKING_MESSAGE_CYCLE_STORAGE_KEY,
  THINKING_MESSAGE_ORDER_STORAGE_KEY,
  THINKING_MESSAGES_STORAGE_KEY,
  parseThinkingMessageCycleMode,
  parseThinkingMessageOrder,
  parseThinkingMessages,
  shuffleThinkingMessageIndices,
  useThinkingMessages,
} from '../../../../hooks/useThinkingMessages';

import MessageCopyControl from './MessageCopyControl';
import ActivityIndicator from './ActivityIndicator';
import { ChatExportOptions } from './ChatExportMenu';
import ChatFindBar from './ChatFindBar';
import ChatMessageImages from './ChatMessageImages';
import CompactBoundaryDivider from './CompactBoundaryDivider';
import { ComposerAttachmentGallery } from './ComposerAttachment';
import ComposerModelMenu from './ComposerModelMenu';
import ComposerPermissionMenu from './ComposerPermissionMenu';
import FollowUpQuestions from './FollowUpQuestions';
import AsyncQuestionPanel from './AsyncQuestionPanel';
import QueuedMessagesRow from './QueuedMessagesRow';
import ScheduledMessageBubbles from './ScheduledMessageBubbles';
import ComposerAddMenu from './ComposerAddMenu';
import TokenUsageSummary from './TokenUsageSummary';

describe('chatSubcomponents', () => {
  test('shows each assistant reply timestamp regardless of its preceding message', async () => {
    // Node needs the CommonJS theme entry; Vite resolves the ESM entry in the app.
    const hooks = registerHooks({
      resolve(specifier, context, nextResolve) {
        return nextResolve(specifier === 'react-syntax-highlighter/dist/esm/styles/prism'
          ? 'react-syntax-highlighter/dist/cjs/styles/prism/index.js'
          : specifier, context);
      },
    });
    const { default: MessageComponent } = await import('./MessageComponent').finally(() => hooks.deregister());
    const message: ChatMessage = {
      type: 'assistant', content: 'A later reply', timestamp: '2026-09-14T15:42:00.000Z',
    };
    const earlier = { content: 'Earlier', timestamp: '2026-09-14T14:00:00.000Z' };
    const predecessors: Array<ChatMessage | null> = [
      null,
      { ...earlier, type: 'user' },
      { ...earlier, type: 'assistant' },
      { ...earlier, type: 'assistant', isThinking: true },
      { ...earlier, type: 'assistant', isToolUse: true, toolName: 'Bash' },
    ];
    const expectedTime = formatMessageTimestamp(message.timestamp);
    for (const provider of ['claude', 'codex', 'cursor', 'opencode']) {
      for (const prevMessage of predecessors) {
        const container = document.createElement('div');
        container.innerHTML = renderToStaticMarkup(
          <MessageComponent message={message} prevMessage={prevMessage} provider={provider}
            createDiff={() => []} showThinking={false} />,
        );
        assert.ok(container.textContent?.includes(expectedTime),
          `${provider} reply must show its own time after ${JSON.stringify(prevMessage)}`);
        assert.equal(container.querySelector('.chat-message')?.classList.contains('grouped'),
          prevMessage?.type === 'assistant', 'timestamp visibility must preserve grouping');
      }
    }
    const withDuration = document.createElement('div');
    withDuration.innerHTML = renderToStaticMarkup(
      <MessageComponent message={message} prevMessage={null} turnDurationMs={72_000} provider="claude"
        createDiff={() => []} showThinking={false} />,
    );
    // No i18n instance here, so the default string arrives uninterpolated.
    const timeLine = [...withDuration.querySelectorAll('div')].find((node) =>
      node.firstElementChild?.tagName === 'SPAN' && node.firstElementChild.textContent === expectedTime);
    assert.ok(timeLine?.nextElementSibling?.textContent?.startsWith('Worked for'),
      `turn duration sits on its own line under the reply timestamp: ${withDuration.innerHTML}`);
    assert.equal(renderToStaticMarkup(
      <MessageComponent message={{ ...message, isThinking: true }} prevMessage={null}
        provider="codex" createDiff={() => []} showThinking={false} />,
    ), '', 'hidden thinking must remain hidden');
  });

  test('the Auto-Continue offer is a button on the limit notice, drawn only for the live one', async () => {
    const hooks = registerHooks({
      resolve(specifier, context, nextResolve) {
        return nextResolve(specifier === 'react-syntax-highlighter/dist/esm/styles/prism'
          ? 'react-syntax-highlighter/dist/cjs/styles/prism/index.js'
          : specifier, context);
      },
    });
    const { default: MessageComponent } = await import('./MessageComponent').finally(() => hooks.deregister());
    const notice: ChatMessage = {
      type: 'assistant', content: 'Claude usage limit reached.', isSystemNotice: true,
      timestamp: '2026-09-17T15:42:00.000Z',
    };
    const render = (props: Record<string, unknown>) => {
      const container = document.createElement('div');
      container.innerHTML = renderToStaticMarkup(
        <MessageComponent message={notice} prevMessage={null} provider="claude"
          createDiff={() => []} showThinking={false} {...props} />,
      );
      return container;
    };

    const offered = render({ showAutoContinueOffer: true, onAcceptAutoContinue: () => {} });
    const button = offered.querySelector('button');
    assert.ok(button, `the offer is a button on the notice row: ${offered.innerHTML}`);
    assert.equal(button?.textContent, 'Continue when usage resets');
    assert.ok(offered.textContent?.includes('Claude usage limit reached.'),
      'the notice keeps its own text above the button');

    // Every other notice, live or reloaded, stays a plain muted row.
    assert.equal(render({ onAcceptAutoContinue: () => {} }).querySelector('button'), null);
    assert.equal(render({ showAutoContinueOffer: true }).querySelector('button'), null);

    // Codex's limit stop is an error row classified by field; it draws as the
    // same muted notice, with no "Error" header, and carries the same offer.
    const drawError = (usageLimit?: { resumes: boolean }) => {
      const container = document.createElement('div');
      container.innerHTML = renderToStaticMarkup(
        <MessageComponent
          message={{ type: 'error', content: "You've hit your usage limit.", timestamp: notice.timestamp, usageLimit }}
          prevMessage={null} provider="codex" createDiff={() => []} showThinking={false}
          showAutoContinueOffer onAcceptAutoContinue={() => {}} />,
      );
      return container;
    };
    const codexStop = drawError({ resumes: true });
    assert.equal(codexStop.querySelector('button')?.textContent, 'Continue when usage resets');
    assert.equal(codexStop.querySelector('.bg-red-600'), null, codexStop.innerHTML);
    assert.ok(drawError().querySelector('.bg-red-600'), 'an unclassified error keeps its red row');
  });

  test('message timestamps add a day label only once the calendar day has changed', () => {
    const now = new Date(2026, 8, 17, 8, 0);
    const at = (month: number, day: number, hour: number, year = 2026) => new Date(year, month, day, hour, 5);
    assert.equal(formatMessageTimestamp(at(8, 17, 7), now), '7:05 AM');
    assert.equal(formatMessageTimestamp(at(8, 16, 23), now), 'Yesterday, 11:05 PM', 'calendar day, not 24 hours');
    assert.equal(formatMessageTimestamp(at(8, 15, 9), now), 'Tue, 9:05 AM');
    assert.equal(formatMessageTimestamp(at(8, 11, 9), now), 'Fri, 9:05 AM');
    assert.equal(formatMessageTimestamp(at(8, 10, 9), now), 'Sep 10, 9:05 AM', 'a week back needs the date');
    assert.equal(formatMessageTimestamp(at(11, 31, 21, 2025), now), 'Dec 31, 2025, 9:05 PM');
    assert.equal(formatMessageTimestamp('not a date', now), '');
  });

  test('the clock format setting switches every timestamp surface, then back', () => {
    const now = new Date(2026, 8, 17, 8, 0);
    const at = (month: number, day: number, hour: number, year = 2026) => new Date(year, month, day, hour, 5);
    try {
      setClockFormat('24h');
      assert.equal(formatMessageTimestamp(at(8, 17, 7), now), '07:05');
      assert.equal(formatMessageTimestamp(at(8, 16, 23), now), 'Yesterday, 23:05');
      assert.equal(formatMessageTimestamp(at(8, 15, 13), now), 'Tue, 13:05');
      assert.equal(formatMessageTimestamp(at(11, 31, 21, 2025), now), 'Dec 31, 2025, 21:05');
      // Midnight is 00:05 on a 24-hour clock, never 24:05.
      assert.equal(formatMessageTimestamp(at(8, 17, 0), now), '00:05');
      // A preview of the cycle you are about to pick ignores the stored one.
      assert.equal(formatClockTime(at(8, 17, 17), { format: '12h' }), '5:05 PM');
    } finally {
      setClockFormat('12h');
    }
    assert.equal(formatMessageTimestamp(at(8, 17, 7), now), '7:05 AM');
    assert.equal(formatClockTime(at(8, 17, 17), { format: '24h' }), '17:05');
  });

  describe('activity messages', () => {
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
      localStorage.clear();
      root = null;
      container = null;
    });

    test('bounds stored entries without accepting non-strings', () => {
      const overlong = 'x'.repeat(MAX_THINKING_MESSAGE_LENGTH + 5);
      const parsed = parseThinkingMessages([
        overlong,
        42,
        ...Array.from({ length: MAX_THINKING_MESSAGES }, (_, index) => `Message ${index}`),
      ]);

      assert.equal(parsed?.length, MAX_THINKING_MESSAGES);
      assert.equal(parsed?.[0], 'x'.repeat(MAX_THINKING_MESSAGE_LENGTH));
      assert.equal(parseThinkingMessages('Thinking'), null);
      assert.equal(parseThinkingMessageCycleMode('turn'), 'turn');
      assert.equal(parseThinkingMessageCycleMode('9'), null);
      assert.equal(parseThinkingMessageOrder('random'), 'random');
      assert.equal(parseThinkingMessageOrder('alphabetical'), null);

      const shuffled = shuffleThinkingMessageIndices(4, 2, () => 0);
      assert.deepEqual([...shuffled].sort(), [0, 1, 2, 3]);
      assert.notEqual(shuffled[0], 2, 'a reshuffle cannot immediately repeat its previous message');
    });

    test('a tool activity row reads as facets, as its one call, or as the call still running, plus failures', () => {
      const t = i18next.getFixedT('en', 'chat');
      const done = { content: '', isError: false, timestamp: '2026-09-21T00:00:01Z' };
      const call = (id: string, toolName: string, toolInput: unknown, extra: Partial<ChatMessage> = {}): ChatMessage => ({
        id, timestamp: '2026-09-21T00:00:00Z', type: 'assistant', content: '', isToolUse: true,
        toolName, toolInput: JSON.stringify(toolInput), toolResult: done, ...extra,
      });
      const edit = call('edit', 'Edit', { file_path: '/src/toolGrouping.ts', old_string: 'a', new_string: 'b\nc' });
      const burst = [
        call('r1', 'Read', { file_path: '/src/a.ts' }),
        call('r2', 'Read', { file_path: '/src/b.ts' }),
        call('b1', 'Bash', { command: 'npm test' }, { toolResult: { content: 'exit 1', isError: true } }),
        edit,
      ];
      const label = (messages: ChatMessage[], isLive = false) => describeActivity(summarizeActivity(messages), t, isLive).label;

      assert.equal(label(burst), 'Read 2 files, ran 1 command, edited 1 file +2 \u22121');
      assert.equal(label([edit]), 'Edited toolGrouping.ts +2 \u22121');
      assert.equal(label([call('m1', 'mcp__cloudcli-browser__browser_click', {})]), 'Used browser_click');
      const claudeRunning = call('run', 'Bash', { command: 'npm test', description: 'Run client tests' }, { toolResult: null });
      const codexRunning = call('run', 'Bash', { command: 'npm test' }, { toolResult: null });
      assert.equal(label([...burst, claudeRunning], true), 'Run client tests');
      assert.equal(label([...burst, codexRunning], true), 'Running npm test');
      assert.equal(label([...burst, codexRunning], false), 'Read 2 files, ran 2 commands, edited 1 file +2 \u22121');
      assert.equal(summarizeActivity(burst).failed, 1);
      const described = call('d1', 'Bash', { command: 'npm test', description: 'Run client tests' });
      assert.equal(operationLabel(describeOperation(described), t, true), 'Run client tests', 'an operation row keeps Claude\'s description');
      assert.equal(operationLabel(describeOperation(described), t), 'Ran npm test');
      const twoFiles = call('fc', 'FileChanges', [{ path: '/a/x.ts', diff: '+a' }, { path: '/a/y.ts', diff: '-b' }]);
      assert.equal(label([twoFiles]), 'Edited 2 files +1 \u22121');
      assert.equal(t('activity.failed', { count: 1 }), '1 failed');

    });

    test('applies each cycle mode in the same tab while provider status stays authoritative', async () => {
      container = document.createElement('div');
      document.body.appendChild(container);
      root = createRoot(container);

      const initialStartedAt = Date.now() - 4_500;
      const Harness = () => {
        const {
          cycleMode,
          messageOrder,
          setCustomMessages,
          setCycleMode,
          setMessageOrder,
          resetThinkingMessages,
        } = useThinkingMessages();
        const [statusText, setStatusText] = React.useState<string | null>(null);
        const [startedAt, setStartedAt] = React.useState(initialStartedAt);
        return (
          <>
            <button type="button" onClick={() => setCustomMessages(['Pondering', 'Scheming'])}>
              Customize
            </button>
            <button type="button" onClick={() => setCustomMessages([])}>
              Clear
            </button>
            <button type="button" onClick={resetThinkingMessages}>
              Reset
            </button>
            <button type="button" onClick={() => setStatusText('Compacting conversation')}>
              Set provider status
            </button>
            <button type="button" onClick={() => setCycleMode('2')}>Every 2 seconds</button>
            <button type="button" onClick={() => setCycleMode('never')}>Never</button>
            <button type="button" onClick={() => setCycleMode('turn')}>Per turn</button>
            <button type="button" onClick={() => setMessageOrder('random')}>Random order</button>
            <button type="button" onClick={() => setStartedAt((current) => current + 1_000)}>Next turn</button>
            <output>{cycleMode}:{messageOrder}</output>
            <ActivityIndicator
              activity={{ statusText, canInterrupt: true, startedAt }}
            />
          </>
        );
      };

      await React.act(async () => root?.render(<Harness />));
      assert.match(container.textContent ?? '', /Processing/);

      const button = (label: string) => [...container!.querySelectorAll<HTMLButtonElement>('button')]
        .find((candidate) => candidate.textContent?.trim() === label);
      const customize = button('Customize');
      const clear = button('Clear');
      const reset = button('Reset');
      const setProviderStatus = button('Set provider status');
      await React.act(async () => customize?.click());
      assert.match(container.textContent ?? '', /Scheming/);
      assert.deepEqual(
        JSON.parse(localStorage.getItem(THINKING_MESSAGES_STORAGE_KEY) ?? 'null'),
        ['Pondering', 'Scheming'],
      );

      await React.act(async () => clear?.click());
      assert.match(container.textContent ?? '', /Processing/);
      assert.deepEqual(JSON.parse(localStorage.getItem(THINKING_MESSAGES_STORAGE_KEY) ?? 'null'), []);

      await React.act(async () => customize?.click());
      await React.act(async () => button('Every 2 seconds')?.click());
      assert.match(container.textContent ?? '', /Pondering/);
      assert.equal(localStorage.getItem(THINKING_MESSAGE_CYCLE_STORAGE_KEY), '2');

      await React.act(async () => button('Never')?.click());
      assert.match(container.textContent ?? '', /Pondering/);

      await React.act(async () => button('Per turn')?.click());
      assert.match(container.textContent ?? '', /Pondering/);
      await React.act(async () => button('Next turn')?.click());
      assert.match(container.textContent ?? '', /Scheming/);

      // A settings change restarts the list instead of keeping its place, so the
      // change proves itself on screen rather than resuming at an arbitrary word.
      await React.act(async () => clear?.click());
      assert.match(container.textContent ?? '', /Thinking/);
      assert.doesNotMatch(container.textContent ?? '', /Processing/);
      await React.act(async () => customize?.click());
      assert.match(container.textContent ?? '', /Pondering/);

      await React.act(async () => button('Random order')?.click());
      const firstRandomMessage = container.querySelector<HTMLElement>('span[title]')?.title;
      assert.ok(firstRandomMessage);
      await React.act(async () => button('Next turn')?.click());
      const secondRandomMessage = container.querySelector<HTMLElement>('span[title]')?.title;
      assert.ok(secondRandomMessage);
      assert.notEqual(secondRandomMessage, firstRandomMessage);
      assert.equal(localStorage.getItem(THINKING_MESSAGE_ORDER_STORAGE_KEY), 'random');

      await React.act(async () => setProviderStatus?.click());
      assert.match(container.textContent ?? '', /Compacting conversation/);
      assert.doesNotMatch(container.textContent ?? '', /Scheming/);
      const activityLabel = container.querySelector<HTMLElement>('[title="Compacting conversation"]');
      assert.ok(activityLabel);
      assert.match(activityLabel.className, /min-w-0/);
      assert.match(activityLabel.querySelector('span')?.className ?? '', /truncate/);


      await React.act(async () => reset?.click());
      assert.equal(
        container.querySelector('output')?.textContent,
        `${DEFAULT_THINKING_MESSAGE_CYCLE_MODE}:${DEFAULT_THINKING_MESSAGE_ORDER}`,
      );
      assert.equal(localStorage.getItem(THINKING_MESSAGES_STORAGE_KEY), null);
      assert.equal(localStorage.getItem(THINKING_MESSAGE_CYCLE_STORAGE_KEY), null);
      assert.equal(localStorage.getItem(THINKING_MESSAGE_ORDER_STORAGE_KEY), null);

      // A reported stage outranks both the custom words and the status text.
      await React.act(async () => root?.render(
        <ActivityIndicator
          activity={{
            statusText: 'Compacting conversation',
            stage: { name: 'thinking', tokens: 5350 },
            outputTokens: 5350,
            canInterrupt: true,
            startedAt: initialStartedAt,
          }}
        />,
      ));
      assert.match(container.textContent ?? '', /Thinking…/);
      // The count sits in the fixed right-hand slot, not in the label.
      const countSlot = [...container.querySelectorAll('span')].find((span) => /5,350 tokens · /.test(span.textContent ?? ''));
      assert.match(countSlot?.className ?? '', /shrink-0/);
      const thinkingLabel = container.querySelector('[title="Thinking"]');
      assert.ok(thinkingLabel);
      assert.doesNotMatch(thinkingLabel.textContent ?? '', /tokens/);
      assert.doesNotMatch(container.textContent ?? '', /Compacting conversation/);

      await React.act(async () => root?.render(
        <ActivityIndicator
          activity={{
            statusText: null,
            stage: { name: 'retrying', attempt: 3, maxAttempts: 10, reason: 'overloaded' },
            canInterrupt: true,
            startedAt: initialStartedAt,
          }}
        />,
      ));
      assert.match(container.textContent ?? '', /Retrying · overloaded · 3 of 10/);
      // No reported count leaves just the elapsed time.
      assert.doesNotMatch(container.textContent ?? '', /tokens/);

    });

    test('a permission prompt hides the indicator without unmounting its cycle', () => {
      const composerSource = readFileSync(new URL('./ChatComposer.tsx', import.meta.url), 'utf8');
      const mountConditionIndex = composerSource.indexOf('{(activity || reserveActivitySpace) && (');
      const indicatorIndex = composerSource.indexOf('<ActivityIndicator activity={activity}');

      assert.ok(mountConditionIndex > 0);
      assert.ok(indicatorIndex > mountConditionIndex);
      assert.match(
        composerSource.slice(mountConditionIndex, indicatorIndex),
        /display: pendingPermissionRequests\.length > 0 \? 'none' : undefined/,
      );
      // Gating the mount on this restarts the turn counter and the no-repeat bag per prompt.
      assert.doesNotMatch(composerSource, /pendingPermissionRequests\.length === 0 &&/);
    });
  });

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

    test('offers a single copy button whose format comes from the setting', async () => {
      const copyControlSource = readFileSync(new URL('./MessageCopyControl.tsx', import.meta.url), 'utf8');
      const chatScreenSource = readFileSync(
        new URL('../../../settings/view/screens/ChatScreen.tsx', import.meta.url),
        'utf8',
      );
      const copyI18n = i18next.createInstance();
      await copyI18n.init({ lng: 'en', resources: { en: { chat: {} } } });
      const markup = renderToStaticMarkup(
        <I18nextProvider i18n={copyI18n} defaultNS="chat">
          <MessageCopyControl content="# Heading" messageType="assistant" />
        </I18nextProvider>,
      );

      assert.equal((markup.match(/<button/g) || []).length, 1);
      assert.doesNotMatch(copyControlSource, /createPortal/);
      assert.match(copyControlSource, /preferences\.copyMessageFormat/);
      assert.match(chatScreenSource, /setPreference\('copyMessageFormat', value\)/);
    });
  });

  describe('non-blocking follow-up questions', () => {
    test('keeps the transcript copy read-only and identifies it as history', async () => {
      const questionI18n = i18next.createInstance();
      await questionI18n.init({ lng: 'en', resources: { en: { chat: {} } } });
      const markup = renderToStaticMarkup(
        <I18nextProvider i18n={questionI18n} defaultNS="chat">
          <FollowUpQuestions questions={[
            { question: 'Which environment?', options: ['Staging', 'Production'] },
            { question: 'Anything else?', options: [] },
          ]} />
        </I18nextProvider>,
      );

      assert.match(markup, /Which environment\?/);
      assert.match(markup, /Staging/);
      assert.match(markup, /Production/);
      assert.match(markup, /Anything else\?/);
      assert.match(markup, /Asked while the response continued\./);
      assert.equal((markup.match(/data-chat-find-content/g) || []).length, 4);
      assert.doesNotMatch(markup, /<button/);
    });

    test('renders the pending question as an accessible editor with default choice and delivery actions', async () => {
      const questionI18n = i18next.createInstance();
      await questionI18n.init({ lng: 'en', resources: { en: { chat: {} } } });
      const markup = renderToStaticMarkup(
        <I18nextProvider i18n={questionI18n} defaultNS="chat">
          <AsyncQuestionPanel
            sessionId="session-1"
            question={{
              id: 'question-1:0',
              messageId: 'question-1',
              question: 'Which environment?',
              options: ['Staging', 'Production'],
            }}
            pendingCount={2}
            isProcessing
            isSending={false}
            error={null}
            onSubmit={() => true}
          />
        </I18nextProvider>,
      );

      assert.match(markup, /<fieldset/);
      assert.match(markup, /type="radio"[^>]+checked=""[^>]+value="Staging"/);
      assert.match(markup, /Other/);
      assert.match(markup, /Type an answer…/);
      assert.match(markup, />Queue</);
      assert.match(markup, />Send now</);
      assert.match(markup, /2 remaining/);
    });

    test('async questions collapse without submitting and preserve the answer and delivery actions', async () => {
      const questionI18n = i18next.createInstance();
      await questionI18n.init({ lng: 'en', resources: { en: { chat: {} } } });
      const container = document.createElement('div');
      document.body.appendChild(container);
      const root = createRoot(container);
      const calls: Array<[string, string]> = [];
      const render = (isSending = false, error: string | null = null) => root.render(
        <I18nextProvider i18n={questionI18n} defaultNS="chat">
          <AsyncQuestionPanel sessionId="collapse-test" question={{
            id: 'collapse-question', messageId: 'collapse-message',
            question: 'A long question. '.repeat(80), options: ['Staging', 'Production'],
          }} pendingCount={2} isProcessing isSending={isSending} error={error}
          onSubmit={(answer, delivery) => { calls.push([answer, delivery]); return true; }} />
        </I18nextProvider>,
      );
      try {
        await React.act(async () => render());
        const toggle = container.querySelector<HTMLButtonElement>('[aria-label="Collapse question"]');
        assert.ok(toggle, 'async questions need the shared collapse control');
        const production = container.querySelector<HTMLInputElement>('input[value="Production"]')!;
        await React.act(async () => production.click());
        await React.act(async () => toggle.click());
        assert.equal(toggle.getAttribute('aria-expanded'), 'false');
        assert.match(toggle.textContent ?? '', /Question waiting/);
        assert.deepEqual(calls, []);
        await React.act(async () => toggle.click());
        assert.equal(production.checked, true);
        const action = (label: string) => Array.from(container.querySelectorAll('button'))
          .find((button) => button.textContent?.trim() === label)!;
        await React.act(async () => action('Queue').click());
        await React.act(async () => action('Send now').click());
        assert.deepEqual(calls, [['Production', 'queue'], ['Production', 'send']]);
        await React.act(async () => render(true));
        assert.equal(action('Queue').disabled, true);
        assert.equal(action('Sending…').disabled, true);
        await React.act(async () => toggle.click());
        await React.act(async () => render(false, 'Could not confirm answer delivery.'));
        assert.match(container.textContent ?? '', /Could not confirm answer delivery/);
        assert.match(toggle.textContent ?? '', /Answer needs attention/);
        await React.act(async () => toggle.click());
        assert.equal(production.checked, true);
        const other = container.querySelector<HTMLInputElement>('input[type="text"]')!;
        await React.act(async () => {
          other.focus();
          Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(other, 'A custom answer');
          other.dispatchEvent(new window.Event('input', { bubbles: true }));
        });
        await React.act(async () => toggle.click());
        await React.act(async () => toggle.click());
        assert.equal(other.value, 'A custom answer');
        await React.act(async () => action('Send now').click());
        assert.deepEqual(calls.at(-1), ['A custom answer', 'send']);
      } finally {
        await React.act(async () => root.unmount());
        window.localStorage.removeItem(asyncQuestionDraftKey('collapse-test', 'collapse-question'));
        container.remove();
      }
    });

    test('queues typed messages and answers in one row, with the next one editable in place', async () => {
      const questionI18n = i18next.createInstance();
      await questionI18n.init({ lng: 'en', resources: { en: { chat: {} } } });
      const container = document.createElement('div');
      document.body.appendChild(container);
      const root = createRoot(container);
      const calls: string[] = [];
      const answer = (id: string, question: string) => ({
        id,
        questionId: `${id}:q`,
        question,
        answer: 'Staging',
        content: `> ${question}\n\nStaging`,
        provider: 'codex' as const,
        queuedAt: '2026-09-07T12:00:00.000Z',
      });
      const render = (draft: { content: string; attachmentCount: number } | null) => root.render(
        <I18nextProvider i18n={questionI18n} defaultNS="chat">
          <QueuedMessagesRow
            draft={draft}
            answers={[answer('answer-1', 'Which environment?'), answer('answer-2', 'Which region?')]}
            onEditDraft={() => calls.push('edit')}
            onDeleteDraft={() => calls.push('delete')}
            onRemoveAnswer={(id) => calls.push(`remove ${id}`)}
          />
        </I18nextProvider>,
      );

      try {
        await React.act(async () => render({ content: 'Fix the test too', attachmentCount: 0 }));
        const edit = container.querySelector<HTMLButtonElement>('[aria-label="Edit queued message"]');
        assert.ok(edit, 'the next message is editable without opening anything');
        assert.match(container.textContent ?? '', /QueuedFix the test too\+2 more/);
        assert.equal(container.querySelectorAll('li').length, 0, 'one row until the rest are opened');
        await React.act(async () => edit.click());
        assert.deepEqual(calls, ['edit']);

        const more = container.querySelector<HTMLButtonElement>('button[aria-expanded]');
        assert.ok(more);
        await React.act(async () => more.click());
        const items = [...container.querySelectorAll('li')];
        assert.deepEqual(items.map((item) => item.querySelector('p')?.textContent), [
          'Which environment? — Staging',
          'Which region? — Staging',
        ], 'the rest, in send order');
        assert.equal(items[0].querySelector('[aria-label="Edit queued message"]'), null);
        const remove = items[1].querySelector<HTMLButtonElement>('[aria-label="Remove queued answer to Which region?"]');
        assert.ok(remove);
        await React.act(async () => remove.click());
        assert.deepEqual(calls, ['edit', 'remove answer-2']);

        // With no typed message, the oldest answer takes the row and keeps only Remove.
        await React.act(async () => render(null));
        assert.match(container.textContent ?? '', /QueuedWhich environment\? — Staging\+1 more/);
        assert.ok(container.querySelector('[aria-label="Remove queued answer to Which environment?"]'));
        assert.equal(container.querySelector('[aria-label="Edit queued message"]'), null);
      } finally {
        await React.act(async () => root.unmount());
        container.remove();
      }
    });

    test('draws scheduled messages as bubbles with their actions beneath, Send now held until a reply finishes', async () => {
      const scheduleI18n = i18next.createInstance();
      await scheduleI18n.init({ lng: 'en', resources: { en: { chat: {} } } });
      const base = {
        sessionId: 'session-1', provider: 'claude', failureReason: null, firedAt: null, scheduledFor: null,
      };
      const container = document.createElement('div');
      document.body.appendChild(container);
      const root = createRoot(container);
      const calls: string[] = [];
      const render = (canSendNow: boolean) => root.render(
        <I18nextProvider i18n={scheduleI18n} defaultNS="chat">
          <ScheduledMessageBubbles
            messages={[
              { ...base, id: 'later', content: 'Being edited', trigger: 'time', state: 'paused', createdAt: '2026-09-16T10:05:00Z' },
              {
                ...base, id: 'first', content: 'Continue', trigger: 'usage-reset', state: 'pending', createdAt: '2026-09-16T10:00:00Z',
                attachments: [{ path: '/assets/a.png' }],
              },
            ]}
            canSendNow={canSendNow}
            onSendNow={(id) => calls.push(`send ${id}`)}
            onEdit={(message) => calls.push(`edit ${message.id}`)}
            onCancel={(id) => calls.push(`cancel ${id}`)}
            onResume={(id) => calls.push(`resume ${id}`)}
          />
        </I18nextProvider>,
      );
      const bubbles = () => [...container.querySelectorAll<HTMLElement>('.chat-message')];
      const actions = (bubble: HTMLElement) => [...bubble.querySelectorAll('button')]
        .map((button) => `${button.getAttribute('aria-label')}${button.disabled ? ' (disabled)' : ''}`);

      try {
        await React.act(async () => render(false));
        assert.deepEqual(bubbles().map((bubble) => bubble.textContent), [
          'ContinueSending when usage resets· 1 file',
          'Being editedPaused — not sending until you resume it',
        ], 'oldest first, each saying when it goes');
        assert.deepEqual(actions(bubbles()[0]), [
          'Edit scheduled message',
          'Send now is available once the current reply finishes (disabled)',
          'Cancel scheduled message',
        ]);
        assert.deepEqual(actions(bubbles()[1]), [
          'Edit scheduled message',
          'Resume scheduled message',
          'Cancel scheduled message',
        ], 'a paused message offers Resume instead of Send now');

        await React.act(async () => render(true));
        for (const button of bubbles()[0].querySelectorAll('button')) {
          await React.act(async () => button.click());
        }
        await React.act(async () => bubbles()[1].querySelectorAll('button')[1].click());
        assert.deepEqual(calls, ['edit first', 'send first', 'cancel first', 'resume later']);
      } finally {
        await React.act(async () => root.unmount());
        container.remove();
      }
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

    test('history images omitted from the page load from their authenticated route', async () => {
      const originalFetch = globalThis.fetch;
      const originalCreateObjectURL = URL.createObjectURL;
      const requested: string[] = [];
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        requested.push(String(input));
        return new Response(new Blob(['png'], { type: 'image/png' }));
      }) as typeof fetch;
      URL.createObjectURL = () => 'blob:history-image';
      const url = '/api/providers/sessions/app/messages/row-4_text_0/images/0';
      const { container, root } = await mount(<ChatMessageImages images={[{ name: 'shot.png', url }]} />);
      try {
        await React.act(async () => { await new Promise((resolve) => window.setTimeout(resolve, 0)); });
        assert.deepEqual(requested, [url]);
        assert.equal(container.querySelector('img')?.getAttribute('src'), 'blob:history-image');
      } finally {
        await React.act(async () => root.unmount());
        container.remove();
        globalThis.fetch = originalFetch;
        URL.createObjectURL = originalCreateObjectURL;
      }
    });
  });

  describe('omitted tool detail', () => {
    const elidedBash: ChatMessage = {
      type: 'assistant', content: '', timestamp: '2026-09-21T10:00:00.000Z', id: 'tool-1', isToolUse: true,
      toolName: 'Bash', toolId: 'call-1', toolInput: JSON.stringify({ command: 'cat big.log' }),
      toolResult: { content: 'preview line', isError: false }, elidedDetail: { bytes: 90_000, resultLines: 5000 },
      historySessionId: 'app-session',
    };
    const fullRecord = {
      id: 'tool-1', sessionId: 'app-session', provider: 'claude', timestamp: '2026-09-21T10:00:00.000Z', kind: 'tool_use',
      toolName: 'Bash', toolId: 'call-1', toolInput: { command: 'cat big.log' },
      toolResult: { content: 'full output\n'.repeat(3) + 'final line', isError: false },
    };

    test('a collapsed row reports the omitted size and loads the complete output when opened', async () => {
      const hooks = registerHooks({
        resolve(specifier, context, nextResolve) {
          return nextResolve(specifier === 'react-syntax-highlighter/dist/esm/styles/prism'
            ? 'react-syntax-highlighter/dist/cjs/styles/prism/index.js'
            : specifier, context);
        },
      });
      const { default: MessageComponent } = await import('./MessageComponent').finally(() => hooks.deregister());
      const originalFetch = globalThis.fetch;
      const originalResizeObserver = globalThis.ResizeObserver;
      globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
      const requested: string[] = [];
      let fail = true;
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        requested.push(String(input));
        return fail ? new Response('{}', { status: 500 }) : Response.json({ data: fullRecord });
      }) as typeof fetch;
      const container = document.createElement('div');
      document.body.appendChild(container);
      const root = createRoot(container);
      const settle = () => new Promise((resolve) => window.setTimeout(resolve, 0));
      try {
        await React.act(async () => {
          root.render(<MessageComponent message={elidedBash} prevMessage={null} provider="claude" createDiff={() => []} />);
        });
        assert.ok(container.textContent?.includes('5000 lines'), container.textContent ?? '');
        assert.deepEqual(requested, [], 'nothing loads until the row is opened');
        const row = container.querySelector<HTMLElement>('[aria-expanded]');
        assert.ok(row);
        await React.act(async () => { row.click(); await settle(); });
        assert.equal(requested.length, 1);
        assert.match(requested[0], /\/api\/providers\/sessions\/app-session\/messages\/tool-1$/);
        const retry = [...container.querySelectorAll('button')].find((button) => button.textContent === 'Retry');
        assert.ok(retry, 'a failed load is visible and retryable');
        fail = false;
        await React.act(async () => { retry.click(); await settle(); });
        assert.ok(container.textContent?.includes('final line'), container.textContent ?? '');
        assert.equal(container.querySelector('[role="alert"]'), null);
      } finally {
        await React.act(async () => root.unmount());
        container.remove();
        globalThis.fetch = originalFetch;
        globalThis.ResizeObserver = originalResizeObserver;
      }
    });

    test('export swaps omitted tool output for the complete record or exports nothing', async () => {
      const { hydrateHistoryDetails } = await import('../../hooks/useHistoryDetail');
      const originalFetch = globalThis.fetch;
      let records: unknown[] = [fullRecord];
      const requested: string[] = [];
      globalThis.fetch = (async (input: RequestInfo | URL) => {
        requested.push(String(input));
        return Response.json({ data: { messages: records } });
      }) as typeof fetch;
      try {
        const prose: ChatMessage = { type: 'assistant', content: 'Done', timestamp: '2026-09-21T10:00:01.000Z' };
        const [tool, text] = await hydrateHistoryDetails([elidedBash, prose]);
        assert.deepEqual(requested, ['/api/providers/sessions/app-session/messages?payload=full']);
        assert.match(String(tool.toolResult?.content), /final line$/);
        assert.equal(tool.elidedDetail, undefined);
        assert.equal(text, prose);
        records = [];
        await assert.rejects(hydrateHistoryDetails([elidedBash]));
      } finally {
        globalThis.fetch = originalFetch;
      }
    });
  });

  describe('ChatExportOptions', () => {
    function ExportOptionsHarness(props: Omit<React.ComponentProps<typeof ChatExportOptions>, 'include' | 'onIncludeChange' | 'onExported'>) {
      const [include, setInclude] = React.useState(DEFAULT_CHAT_EXPORT_INCLUDE);
      return <ChatExportOptions {...props} include={include} onIncludeChange={setInclude} onExported={() => undefined} />;
    }

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
            <ExportOptionsHarness
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

  describe('header menu', () => {
    function Registrant({ section }: { section: HeaderMenuSection | null }) {
      useRegisterHeaderMenu(section);
      return null;
    }

    const chatSection: HeaderMenuSection = {
      items: [{
        key: 'export',
        label: 'Export…',
        icon: Download,
        renderPanel: (close) => <button type="button" onClick={close}>Markdown</button>,
      }],
    };
    const shellSection: HeaderMenuSection = {
      items: [{ key: 'restart', label: 'Restart', icon: RotateCcw, onSelect: () => undefined }],
    };

    test('shows only on a view with actions, a hidden view cannot clear the visible one, and a panel item opens in place of the menu', async () => {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const root = createRoot(container);
      // Chat stays mounted while hidden; it sits after Shell so its effects run last.
      const render = (visible: 'chat' | 'shell' | 'files') => root.render(
        <HeaderMenuProvider>
          <Registrant section={visible === 'shell' ? shellSection : null} />
          <Registrant section={visible === 'chat' ? chatSection : null} />
          <MainContentHeaderMenu />
        </HeaderMenuProvider>,
      );
      const openMenu = async () => {
        await React.act(async () => {
          container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]')?.click();
        });
        return Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menu"] [role="menuitem"]'))
          .map((item) => item.textContent);
      };

      try {
        await React.act(async () => render('files'));
        assert.equal(container.querySelector('button[aria-haspopup="menu"]'), null);

        await React.act(async () => render('chat'));
        await React.act(async () => render('shell'));
        const shellItems = await openMenu();
        assert.ok(shellItems.includes('Restart'));
        assert.ok(!shellItems.includes('Export…'));
        const shellMenu = document.querySelector<HTMLElement>('[role="menu"]');
        assert.equal(shellMenu?.style.maxHeight, '');
        const shellItem = document.querySelector<HTMLElement>('[role="menu"] [role="menuitem"]');
        assert.ok(shellItem?.classList.contains('gap-3'));
        assert.ok(shellItem?.classList.contains('px-4'));
        assert.ok(shellItem?.classList.contains('py-2.5'));
        assert.ok(!shellItem?.classList.contains('min-h-11'));
        await React.act(async () => {
          document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
        });

        await React.act(async () => render('chat'));
        await openMenu();
        const exportItem = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'))
          .find((item) => item.textContent === 'Export…');
        await React.act(async () => exportItem?.click());

        assert.equal(document.querySelector('[role="menu"]'), null);
        const panel = document.querySelector<HTMLElement>('[role="dialog"][aria-label="Export…"]');
        assert.ok(panel);
        await React.act(async () => panel.querySelector('button')?.click());
        assert.equal(document.querySelector('[role="dialog"]'), null);
      } finally {
        await React.act(async () => root.unmount());
        container.remove();
      }
    });
  });

  describe('find in chat', () => {
    test('keeps typed characters while the header controller is still behind', async () => {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const root = createRoot(container);
      const queries: string[] = [];
      let navigations = 0;
      const controller = {
        isOpen: true, query: '', currentIndex: 0, total: 2,
        isPreparing: false, loadFailed: false,
        open: () => undefined, close: () => undefined,
        setQuery: (query: string) => queries.push(query),
        next: () => { navigations += 1; }, previous: () => undefined,
        retryLoad: () => undefined,
      };
      try {
        await React.act(async () => root.render(<ChatFindBar controller={controller} />));
        const input = container.querySelector<HTMLInputElement>('input')!;
        const setValue = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!;
        for (const character of 'navigation') {
          await React.act(async () => {
            setValue.call(input, input.value + character);
            input.dispatchEvent(new window.Event('input', { bubbles: true }));
          });
        }
        assert.equal(input.value, 'navigation');
        assert.equal(queries.at(-1), 'navigation');
        await React.act(async () => input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
        assert.equal(navigations, 0, 'old results cannot be navigated while the draft differs');
        await React.act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Clear search"]')!.click());
        assert.equal(input.value, '');
        assert.equal(queries.at(-1), '');
        assert.equal(document.activeElement, input);
      } finally {
        await React.act(async () => root.unmount());
        container.remove();
      }
    });

    test('renders a labelled mobile-sized search field and named navigation controls', async () => {
      const findI18n = i18next.createInstance();
      await findI18n.init({ lng: 'en', resources: { en: { chat: {} } } });
      const markup = renderToStaticMarkup(
        <I18nextProvider i18n={findI18n} defaultNS="chat">
          <ChatFindBar controller={{
            isOpen: true,
            query: 'needle',
            currentIndex: 0,
            total: 2,
            isPreparing: false,
            loadFailed: false,
            open: () => undefined,
            close: () => undefined,
            setQuery: () => undefined,
            next: () => undefined,
            previous: () => undefined,
            retryLoad: () => undefined,
          }} />
        </I18nextProvider>,
      );

      assert.match(markup, /type="search"/);
      assert.match(markup, /aria-label="Close find in chat"/);
      assert.match(markup, /aria-label="Clear search"/);
      assert.match(markup, /aria-label="Next match"/);
      assert.match(markup, /aria-label="Previous match"/);
      assert.match(markup, /chat-find-input/);
      assert.doesNotMatch(markup, /bg-border\/70/);
      assert.match(markup, /text-base[^\"]*md:text-sm/);
      assert.match(markup, />1 of 2</);
      assert.ok(markup.indexOf('1 of 2') < markup.indexOf('aria-label="Clear search"'));
      assert.ok(markup.indexOf('aria-label="Clear search"') < markup.indexOf('aria-label="Next match"'));
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
        resetCredits: {
          availableCount: 3,
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
      let usageOpens = 0;
      const CodexUsageSummary = () => {
        usePaletteOpsRegister({ openUsage: () => { usageOpens += 1; } });
        return (
          <TokenUsageSummary
            provider="codex"
            usage={{ used: 42_000, total: 258_400, isAutoCompactEnabled: false }}
            request={{ id: 0, view: 'summary' }}
            onRequestBreakdown={() => {}}
            onRefreshBreakdown={() => {}}
            isRefreshingBreakdown={false}
            canRefreshBreakdown={false}
          />
        );
      };
      const host = await mount(
        <PaletteOpsProvider>
          <CodexUsageSummary />
        </PaletteOpsProvider>,
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
      assert.match(text, /3 usage resets availableView usage/);
      assert.equal(
        dialog.querySelector<HTMLAnchorElement>('a')?.href,
        'https://chatgpt.com/#settings/Usage',
      );

      const resetButton = [...dialog.querySelectorAll<HTMLButtonElement>('button')]
        .find((button) => button.textContent?.includes('3 usage resets available'));
      assert.ok(resetButton);
      await React.act(async () => resetButton.click());
      assert.equal(usageOpens, 1);
      assert.equal(document.querySelector('[role="dialog"]'), null);

      const reopened = await openPopover(host);

      const usageButton = [...reopened.dialog.querySelectorAll<HTMLButtonElement>('button')]
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

    test('a remounted ring does not replay a request it already served', async () => {
      const ring = (id: number) => (
        <TokenUsageSummary
          provider="codex"
          usage={{ used: 10_000, total: 200_000 }}
          request={{ id, view: 'summary' }}
          onRequestBreakdown={() => {}}
          onRefreshBreakdown={() => {}}
          isRefreshingBreakdown={false}
          canRefreshBreakdown={false}
        />
      );
      const host = await mount(ring(3));
      assert.equal(document.querySelector('[role="dialog"]'), null);
      const trigger = host.querySelector<HTMLButtonElement>('button');
      assert.ok(trigger);
      trigger.getBoundingClientRect = () => ({
        x: 340, y: 700, left: 340, right: 372, top: 700, bottom: 732, width: 32, height: 32, toJSON: () => ({}),
      });

      await React.act(async () => root?.render(ring(4)));
      assert.ok(document.querySelector('[role="dialog"]'));
    });

    test('an expanded breakdown does not carry one session\'s reading into the next', async () => {
      const summary = (sessionKey: string, requestId = 1) => (
        <TokenUsageSummary
          provider="claude"
          usage={{ used: 10_000, total: 200_000 }}
          request={{
            id: requestId,
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
      await mount(summary('session-a', 0));
      await React.act(async () => root?.render(summary('session-a')));
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

  describe('ComposerAddMenu', () => {
    test('keeps the real file input under the tap and schedules only typed text', async () => {
      let requestedProps: Record<string, unknown> | undefined;
      let scheduled = 0;
      const container = document.createElement('div');
      document.body.appendChild(container);
      const root = createRoot(container);
      const render = (canSchedule: boolean) => root.render(
        React.createElement(ComposerAddMenu, {
          attachLabel: 'Attach files',
          canSchedule,
          onSchedule: () => { scheduled += 1; },
          getInputProps: (props: unknown) => {
            requestedProps = props as Record<string, unknown>;
            return { ...requestedProps, multiple: true, type: 'file' };
          },
        }),
      );

      try {
        await React.act(async () => render(false));
        assert.equal(requestedProps?.['aria-label'], 'Attach files');
        assert.equal(requestedProps?.tabIndex, 0);
        assert.deepEqual(requestedProps?.style, {
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          opacity: 0,
          cursor: 'pointer',
        });
        // Mounted while closed, so a picker it opened can still deliver its result.
        const input = document.body.querySelector<HTMLInputElement>('input[type="file"][aria-label="Attach files"]');
        assert.ok(input);
        const surface = document.body.querySelector('[role="menu"]');
        assert.match(surface?.className ?? '', /\bhidden\b/);

        const trigger = container.querySelector<HTMLButtonElement>('button[aria-haspopup="menu"]');
        assert.ok(trigger);
        assert.match(trigger.innerHTML, /lucide-plus/);
        await React.act(async () => trigger.click());
        assert.doesNotMatch(surface?.className ?? '', /\bhidden\b/);

        const scheduleItem = () => [...document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
          .find((item) => /Schedule message/.test(item.textContent ?? ''));
        assert.equal(scheduleItem()?.disabled, true);
        assert.match(scheduleItem()?.textContent ?? '', /Type a message first/);

        await React.act(async () => render(true));
        await React.act(async () => scheduleItem()?.click());
        assert.equal(scheduled, 1);
        assert.match(surface?.className ?? '', /\bhidden\b/);
      } finally {
        await React.act(async () => root.unmount());
        container.remove();
      }
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

  test('mobile question control collapses without answering and restores the selection', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    let decisionCount = 0;

    try {
      await React.act(async () => {
        root.render(
          <UserInputRequestPanel
            request={{
              requestId: 'request-collapse',
              provider: 'claude',
              sessionId: 'session-1',
              requestType: 'user_input',
              toolName: 'AskUserQuestion',
              receivedAt: new Date().toISOString(),
              questions: [{
                question: 'Choose one',
                options: [{ label: 'A' }, { label: 'B' }],
              }],
            }}
            onDecision={() => { decisionCount += 1; }}
          />,
        );
      });

      const option = container.querySelector<HTMLButtonElement>('[role="radio"]');
      const toggle = container.querySelector<HTMLButtonElement>('[aria-label="Collapse question"]');
      assert.ok(option);
      assert.ok(toggle);

      await React.act(async () => option.click());
      assert.equal(option.getAttribute('aria-checked'), 'true');

      await React.act(async () => toggle.click());
      assert.equal(toggle.getAttribute('aria-expanded'), 'false');
      assert.match(toggle.textContent || '', /Claude question waiting/);
      assert.match(toggle.textContent || '', /Show question/);
      assert.equal(decisionCount, 0);

      await React.act(async () => toggle.click());
      assert.equal(toggle.getAttribute('aria-expanded'), 'true');
      assert.equal(option.getAttribute('aria-checked'), 'true');
      assert.equal(decisionCount, 0);
    } finally {
      await React.act(async () => root.unmount());
      container.remove();
    }
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


describe('side question sheet', () => {
  // The sheet renders answers as markdown, so it needs the same CJS remap the
  // message renderer does above, and a real DOM because the dialog portals.
  const loadSheet = async () => {
    const hooks = registerHooks({
      resolve(specifier, context, nextResolve) {
        return nextResolve(specifier === 'react-syntax-highlighter/dist/esm/styles/prism'
          ? 'react-syntax-highlighter/dist/cjs/styles/prism/index.js'
          : specifier, context);
      },
    });
    return (await import('./SideQuestionSheet').finally(() => hooks.deregister())).default;
  };

  const renderSheet = async (entries: Parameters<Awaited<ReturnType<typeof loadSheet>>>[0]['entries']) => {
    const SideQuestionSheet = await loadSheet();
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    await React.act(async () => root.render(
      <SideQuestionSheet open entries={entries} onAsk={() => {}} onClose={() => {}} onClear={() => {}} />,
    ));
    const text = document.body.textContent ?? '';
    await React.act(async () => root.unmount());
    container.remove();
    return text;
  };

  test('a pending question shows as asking and an answered one shows its answer', async () => {
    const text = await renderSheet([
      { id: 'a', question: 'which file is it editing?', status: 'pending', askedAt: '' },
      { id: 'b', question: 'why that order?', status: 'answered', answer: 'Phases run bottom-up.', askedAt: '' },
    ]);

    assert.match(text, /which file is it editing\?/);
    assert.match(text, /Asking/);
    assert.match(text, /Phases run bottom-up\./);
    // The promise the sheet makes to the reader, not decoration.
    assert.match(text, /Not added to the conversation/);
    assert.match(text, /Clear/, 'history can be discarded');
    assert.match(text, /Copy/, 'an answer can be copied');
  });

  test('a failed question names the failure instead of an empty answer', async () => {
    const text = await renderSheet([
      { id: 'a', question: 'what now?', status: 'failed', error: 'Side questions are unavailable.', askedAt: '' },
    ]);

    assert.match(text, /Side questions are unavailable\./);
  });

  test('a question this tab sent shows once, whether or not the server has it yet', async () => {
    const { mergeSideQuestionEntries } = await import('../../hooks/useSideQuestion');
    const sent = { id: 'local-1', question: 'why?', status: 'pending' as const, askedAt: '' };
    const onServer = { id: 'q1', question: 'why?', status: 'pending' as const, askedAt: '' };

    assert.deepEqual(mergeSideQuestionEntries([], [sent]).map((entry) => entry.id), ['local-1']);
    assert.deepEqual(mergeSideQuestionEntries([onServer], [sent]).map((entry) => entry.id), ['q1']);
    const failed = { ...sent, status: 'failed' as const, error: 'offline' };
    assert.deepEqual(mergeSideQuestionEntries([onServer], [failed]).map((entry) => entry.id), ['q1', 'local-1'],
      'a send that failed locally is never hidden');
  });
});

describe('chat browser preview', () => {
  const session: BrowserSessionSummary = {
    id: 'browser-b', chatSessionId: 'app-chat-a', status: 'ready', activeToolCount: 1,
    url: 'https://example.com', title: 'Example', screenshotDataUrl: 'data:image/jpeg;base64,aQ==',
    screenshotVersion: 1, createdAt: '', updatedAt: '', lastAction: 'browser_click', message: null,
    createdBy: 'agent', profileName: null, device: 'desktop', actions: [], viewport: null,
  };

  test('the preview identifies active, idle, stopped, and unavailable states independently', () => {
    for (const [overrides, unavailable, label] of [
      [{}, false, 'Using browser'],
      [{ activeToolCount: 0 }, false, 'Browser idle'],
      [{ status: 'stopped' }, false, 'Browser stopped'],
      [{}, true, 'Browser unavailable'],
    ] as const) {
      const markup = renderToStaticMarkup(<ChatBrowserPreview session={{ ...session, ...overrides }} unavailable={unavailable} compact={false} onOpen={() => {}} />);
      assert.ok(markup.includes(label));
    }
  });

  test('the thumbnail takes the viewport shape, falling back to a fixed wide tile', () => {
    const phone = renderToStaticMarkup(<ChatBrowserPreview session={{ ...session, device: 'phone', viewport: { width: 390, height: 844 } }} unavailable={false} compact={false} onOpen={() => {}} />);
    assert.match(phone, /aspect-ratio:390 \/ 844/);
    assert.doesNotMatch(phone, /w-14/);
    const unknown = renderToStaticMarkup(<ChatBrowserPreview session={session} unavailable={false} compact={false} onOpen={() => {}} />);
    assert.match(unknown, /w-14/);
    assert.doesNotMatch(unknown, /aspect-ratio/);
  });

  test('compact mode removes the image but preserves the exact browser destination', async () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    let opened: string | null = null;
    try {
      await React.act(async () => root.render(<ChatBrowserPreview session={session} unavailable={false} compact onOpen={(id) => { opened = id; }} />));
      assert.equal(container.querySelector('img'), null);
      const button = container.querySelector('button')!;
      assert.match(button.getAttribute('aria-label')!, /Using browser: Example/);
      await React.act(async () => button.click());
      assert.equal(opened, 'browser-b');
    } finally {
      await React.act(async () => root.unmount());
      container.remove();
    }
  });
});


test('unchanged message rows skip render work while changed content still updates', async () => {
  const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
    return nextResolve(specifier === 'react-syntax-highlighter/dist/esm/styles/prism'
      ? 'react-syntax-highlighter/dist/cjs/styles/prism/index.js' : specifier, context);
  } });
  const { default: MessageComponent } = await import('./MessageComponent').finally(() => hooks.deregister());
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  let reads = 0;
  const message: ChatMessage = { id: 'render-stable', type: 'assistant', timestamp: '2026-09-19T00:00:00Z',
    get content() { reads++; return 'Original reply'; } };
  const appended: ChatMessage = { id: 'render-new', type: 'assistant', timestamp: '2026-09-19T00:00:01Z', content: 'New reply' };
  const createDiff = () => [];
  const render = (rows: ChatMessage[]) => rows.map((row, index) => <MessageComponent key={row.id}
    message={row} prevMessage={rows[index - 1] ?? null} createDiff={createDiff} provider="claude" />);
  try {
    await React.act(async () => root.render(render([message])));
    const initialReads = reads;
    assert.ok(initialReads > 0);
    await React.act(async () => root.render(render([message, appended])));
    assert.equal(reads, initialReads, 'unchanged row body must not run for an append');
    await React.act(async () => root.render(render([{ ...message, content: 'Updated reply' }, appended])));
    assert.ok(host.textContent?.includes('Updated reply'));
    assert.ok(!host.textContent?.includes('Original reply'));
  } finally { await React.act(async () => root.unmount()); host.remove(); }
});
