import assert from 'node:assert/strict';
import test from 'node:test';

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import NativeImageAttachmentPicker from './NativeImageAttachmentPicker';

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
  assert.equal(typeof requestedProps?.onPointerDown, 'function');
  assert.equal(typeof requestedProps?.onKeyDown, 'function');
  assert.equal(typeof requestedProps?.onChange, 'function');
  assert.equal(typeof requestedProps?.onCancel, 'function');
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
});
