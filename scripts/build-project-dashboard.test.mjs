import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseAdr,
  parseMapsIndex,
  parsePlan,
  parsePlanOrder,
  parseTodo,
  renderDashboard,
} from './build-project-dashboard.mjs';

test('plan parsing keeps wrapped metadata and numeric progress', () => {
  const plan = parsePlan(`# Source truth\n\n- Status: 1/4\n- Next: make failures visible\n  without hiding the error\n`, 'docs/plans/source.md');

  assert.equal(plan.title, 'Source truth');
  assert.equal(plan.next, 'make failures visible without hiding the error');
  assert.deepEqual(plan.progress, { complete: 1, total: 4 });
});

test('plan order comes from the board links', () => {
  assert.deepEqual(
    parsePlanOrder('| [Second](second.md) | not started | Begin |\n| [First](first.md) | 1/2 | Finish |'),
    ['docs/plans/second.md', 'docs/plans/first.md'],
  );
});

test('TODO parsing groups states and assigns mixed or unknown estimates honestly', () => {
  const todo = parseTodo(`## Bugs\n\n- [ ] **One.** Detail. **S/M**\n- [~] **Two.** Detail. **M/?**\n## Features\n\n- [ ] **Three.** Detail. **L**\n- [x] **Done.** Detail. **S**`);

  assert.equal(todo.open, 2);
  assert.equal(todo.partial, 1);
  assert.deepEqual(todo.sizes, { S: 0, M: 1, L: 1, '?': 1 });
  assert.deepEqual(todo.categories, [
    { name: 'Bugs', open: 1, partial: 1 },
    { name: 'Features', open: 1, partial: 0 },
  ]);
});

test('maps and ADRs retain only display metadata', () => {
  const maps = parseMapsIndex(`| Document | Role | Status |\n|---|---|---|\n| [Code anchors](code-anchors.md) | Expensive symbols | Updated today |`);
  const adr = parseAdr('# 0044 — Input targets\n\n- Date: 2026-08-22\n- Status: Accepted\n', 'docs/decisions/0044-input.md');

  assert.deepEqual(maps, [{
    name: 'Code anchors',
    role: 'Expensive symbols',
    status: 'Updated today',
    sourcePath: 'docs/maps/code-anchors.md',
  }]);
  assert.equal(adr.title, '0044 — Input targets');
  assert.equal(adr.status, 'Accepted');
});

test('rendered dashboard is static, escaped, and links back to Markdown', () => {
  const html = renderDashboard({
    plans: [{
      title: 'Plan <one>',
      status: '1/2',
      next: 'Keep source & output separate',
      sourcePath: 'docs/plans/one.md',
      progress: { complete: 1, total: 2 },
    }],
    todo: {
      sourcePath: 'docs/TODO.md',
      open: 1,
      partial: 0,
      categories: [{ name: 'Features', open: 1, partial: 0 }],
      sizes: { S: 1, M: 0, L: 0, '?': 0 },
    },
    maps: [{ name: 'Map', role: 'Current truth', status: 'Current', sourcePath: 'docs/maps/map.md' }],
    decisions: [{ title: '0001 — Choice', date: '2026-08-23', status: 'Accepted', sourcePath: 'docs/decisions/0001-choice.md' }],
  });

  assert.match(html, /Plan &lt;one&gt;/);
  assert.match(html, /Keep source &amp; output separate/);
  assert.match(html, /href="\.\.\/docs\/plans\/one\.md"/);
  assert.doesNotMatch(html, /<script/);
});
