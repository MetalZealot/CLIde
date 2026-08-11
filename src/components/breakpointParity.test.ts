import assert from 'node:assert/strict';
import { globSync, readFileSync } from 'node:fs';
import { relative } from 'node:path';
import test from 'node:test';

import ts from 'typescript';

/**
 * Breakpoint contradictions: an element that can never render at any width.
 *
 * A subtree inside `md:hidden` only exists below the `md` breakpoint, so a
 * descendant marked desktop-only (`hidden` plus an `md:` display class) is
 * hidden on mobile by itself and on desktop by its container. The reverse pairing
 * is dead for the same reason. Both are invisible in review and in the browser,
 * which is how `TaskIndicator` sat unrendered in the sidebar's repository row for
 * its whole life (removed 2026-08-11).
 *
 * Components that fork into a mobile tree and a desktop tree are the sidebar's
 * main parity risk, so the rule is checked rather than written down. See
 * `docs/maps/sidebar-surface.md`.
 */

const REPO_ROOT = new URL('../..', import.meta.url).pathname;

/** `hidden` plus one of these is the "desktop only" idiom used across `src/`. */
const DESKTOP_DISPLAY = /^md:(block|flex|grid|inline|inline-flex|inline-block|table)$/;

type Visibility = { mobileOnly: boolean; desktopOnly: boolean };

type Violation = {
  file: string;
  line: number;
  container: string;
  descendant: string;
};

/**
 * Every string literal reachable from a `className` attribute, so a class list
 * assembled by `cn(...)` or a template is read the same as a plain string.
 * Conditional branches are all collected: a class that only sometimes applies
 * still cannot rescue a subtree its container has already hidden.
 */
function classNamesOf(element: ts.JsxOpeningLikeElement): Set<string> {
  const attribute = element.attributes.properties.find(
    (property): property is ts.JsxAttribute =>
      ts.isJsxAttribute(property) && property.name.getText() === 'className',
  );

  const classes = new Set<string>();
  if (!attribute?.initializer) {
    return classes;
  }

  const collect = (node: ts.Node) => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      for (const className of node.text.split(/\s+/)) {
        if (className) {
          classes.add(className);
        }
      }
    }
    ts.forEachChild(node, collect);
  };

  collect(attribute.initializer);
  return classes;
}

function classify(classes: Set<string>): Visibility {
  return {
    mobileOnly: classes.has('md:hidden'),
    desktopOnly:
      classes.has('hidden') && [...classes].some((className) => DESKTOP_DISPLAY.test(className)),
  };
}

function findViolations(file: string, source: string): Violation[] {
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const violations: Violation[] = [];

  const walk = (node: ts.Node, container: { tag: string; side: keyof Visibility } | null) => {
    let nextContainer = container;

    const opening = ts.isJsxElement(node)
      ? node.openingElement
      : ts.isJsxSelfClosingElement(node)
        ? node
        : null;

    if (opening) {
      const tag = opening.tagName.getText();
      const visibility = classify(classNamesOf(opening));

      // The opposite side of whatever already hides this subtree can never paint.
      if (container && visibility[container.side === 'mobileOnly' ? 'desktopOnly' : 'mobileOnly']) {
        violations.push({
          file,
          line: tree.getLineAndCharacterOfPosition(opening.getStart(tree)).line + 1,
          container: container.tag,
          descendant: tag,
        });
      }

      if (visibility.mobileOnly) {
        nextContainer = { tag, side: 'mobileOnly' };
      } else if (visibility.desktopOnly) {
        nextContainer = { tag, side: 'desktopOnly' };
      }
    }

    ts.forEachChild(node, (child) => walk(child, nextContainer));
  };

  walk(tree, null);
  return violations;
}

/**
 * Negative control. The fixture is the shape the sidebar's repository row
 * actually had: a `md:hidden` mobile block wrapping a `hidden md:inline-flex`
 * indicator. A checker that only ever passes is not a checker.
 */
test('the check fires on the shape that shipped unrendered', () => {
  const fixture = `
    export default function Row() {
      return (
        <div className="md:hidden">
          <h3 className="truncate">{name}</h3>
          {tasksEnabled && (
            <TaskIndicator className={cn('ml-2 hidden flex-shrink-0', 'md:inline-flex')} />
          )}
        </div>
      );
    }
  `;

  const violations = findViolations('fixture.tsx', fixture);

  assert.equal(violations.length, 1);
  assert.equal(violations[0]?.descendant, 'TaskIndicator');
  assert.equal(violations[0]?.container, 'div');
});

test('a mobile tree and a desktop tree as siblings are not a violation', () => {
  const fixture = `
    export default function Row() {
      return (
        <div className="group">
          <div className="md:hidden"><span className="text-sm">{name}</span></div>
          <div className="hidden md:flex"><span className="text-sm">{name}</span></div>
        </div>
      );
    }
  `;

  assert.deepEqual(findViolations('fixture.tsx', fixture), []);
});

test('no element is hidden at every breakpoint by its own container', () => {
  const files = globSync('src/**/*.tsx', { cwd: REPO_ROOT }).filter(
    (file) => !file.endsWith('.test.tsx'),
  );

  assert.ok(files.length > 0, 'found no .tsx sources to scan');

  const violations = files.flatMap((file) =>
    findViolations(file, readFileSync(new URL(file, `file://${REPO_ROOT}`), 'utf8')),
  );

  assert.deepEqual(
    violations.map(
      ({ file, line, container, descendant }) =>
        `${relative('.', file)}:${line} — <${descendant}> is desktop/mobile-only inside a <${container}> that already hides it at the other width`,
    ),
    [],
  );
});
