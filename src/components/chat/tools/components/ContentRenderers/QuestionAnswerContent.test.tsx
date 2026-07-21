import test from 'node:test';
import assert from 'node:assert/strict';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QuestionAnswerContent } from './QuestionAnswerContent';

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
