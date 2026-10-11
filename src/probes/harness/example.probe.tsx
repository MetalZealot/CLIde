import { Layers } from 'lucide-react';

import ActivityIndicator from '../../components/chat/view/subcomponents/ActivityIndicator';
import { cn } from '../../lib/utils';

import { ProbeChat, ProbeMessages } from './ProbeChat';
import { assistantMessage, userMessage } from './fixtures';
import { defineProbe } from './types';

const MESSAGES = [
  userMessage('Run the test suite in the background and keep going on the docs.', 'u1'),
  assistantMessage('Started the tests in the background. I’ll update the guide while they run.', 'a1'),
];

const STARTED_AT = Date.now() - 42_000;

// Today's Tailwind steps; the design system's icon roles replace them.
const ICON_CLASS = { A: 'h-3.5 w-3.5', B: 'h-4 w-4', C: 'h-5 w-5' } as const;

export default defineProbe({
  title: 'Example: background-work icon size',
  date: '2026-10-11',
  question: 'How big should the background-work mark be on the activity line?',
  axes: {
    size: {
      label: 'Icon size',
      options: {
        A: { label: '14px', meaning: 'Matches the activity text, the inline icon size.' },
        B: { label: '16px', meaning: 'The common button icon size in CLIde.' },
        C: { label: '20px', meaning: 'Bottom-nav icon size; reads as a control, not a label.' },
      },
    },
    running: {
      label: 'Background work',
      options: {
        two: { label: '2 running', meaning: 'Count badge on the mark.' },
        none: { label: 'None', meaning: 'Nothing running: the mark sits quiet with no badge.' },
      },
    },
  },
  render: ({ size, running }) => (
    <ProbeChat>
      <ProbeMessages messages={MESSAGES} />
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <ActivityIndicator
            activity={{ statusText: null, stage: { name: 'thinking' }, outputTokens: 1240, canInterrupt: true, startedAt: STARTED_AT }}
          />
        </div>
        <button type="button" className="relative flex flex-none items-center gap-1 rounded-md px-1 text-muted-foreground">
          <Layers className={cn(ICON_CLASS[size])} />
          {running === 'two' && (
            <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold leading-none text-primary-foreground">
              2
            </span>
          )}
        </button>
      </div>
    </ProbeChat>
  ),
});
