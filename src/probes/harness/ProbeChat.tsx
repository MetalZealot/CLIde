import type { ReactNode } from 'react';

import MessageComponent from '../../components/chat/view/subcomponents/MessageComponent';
import type { ChatMessage } from '../../components/chat/types/types';

const createDiff = () => [];

/** Fake conversation turns, rendered by the real message component. */
export function ProbeMessages({ messages }: { messages: ChatMessage[] }) {
  return (
    <>
      {messages.map((message, index) => (
        <MessageComponent
          key={message.id ?? index}
          message={message}
          prevMessage={messages[index - 1] ?? null}
          createDiff={createDiff}
        />
      ))}
    </>
  );
}

/** The chat column with ChatMessagesPane's padding and row gap; keep the classes in step with it. */
export function ProbeChat({ children }: { children: ReactNode }) {
  return (
    <div className="chat-messages-pane relative min-h-0 flex-1 overflow-y-auto pb-3 sm:pb-4">
      <div className="chat-rows mx-auto flex w-full max-w-[54.25rem] flex-col gap-3 px-4 pt-3 sm:gap-4 sm:pt-4">
        {children}
      </div>
    </div>
  );
}
