import assert from 'node:assert/strict';
import test from 'node:test';

import type { TFunction } from 'i18next';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import SidebarStatusIndicator from './SidebarStatusIndicator';

const t = ((_: string, fallback?: string) => fallback ?? '') as TFunction;

const renderStatus = (status: 'blocked' | 'running' | 'unread') =>
  renderToStaticMarkup(
    React.createElement(SidebarStatusIndicator, {
      status,
      t,
      labelPrefix: 'Activity',
    }),
  );

test('renders attention as an amber alert with a non-colour label', () => {
  const html = renderStatus('blocked');

  assert.match(html, /aria-label="Activity: Blocked"/);
  assert.match(html, /text-status-attention/);
  assert.match(html, /lucide-circle-alert/);
});

test('renders a running session as a neutral spinner', () => {
  const html = renderStatus('running');

  assert.match(html, /aria-label="Activity: Running"/);
  assert.match(html, /animate-spin text-status-running/);
  assert.match(html, /lucide-loader-circle/);
});

test('renders unread finished output as a green dot', () => {
  const html = renderStatus('unread');

  assert.match(html, /aria-label="Activity: Unread finished"/);
  assert.match(html, /rounded-full bg-status-unread/);
});
