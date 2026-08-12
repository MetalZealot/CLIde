import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QuestionAnswerContent } from './QuestionAnswerContent';
import { UserInputRequestPanel } from '../InteractiveRenderers/UserInputRequestPanel';
import { adaptUserInputAnswers } from '../InteractiveRenderers/user-input-request.adapter';

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
