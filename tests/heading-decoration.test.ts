import { readFileSync } from 'node:fs';
import postcss, { type Rule } from 'postcss';
import { describe, expect, it } from 'vitest';

const stylesheet = postcss.parse(readFileSync(
  new URL('../shared/editor/styles/editor.css', import.meta.url),
  'utf8',
));

function findRule(selector: string): Rule | undefined {
  let match: Rule | undefined;
  stylesheet.walkRules((rule) => {
    if (rule.selectors.includes(selector)) match = rule;
  });
  return match;
}

function declarationValue(selector: string, property: string): string | undefined {
  const declaration = findRule(selector)?.nodes.find(
    (node) => node.type === 'decl' && node.prop === property,
  );
  return declaration?.type === 'decl' ? declaration.value : undefined;
}

describe('heading decoration', () => {
  it('spans the reading column instead of shrink-wrapping to heading text', () => {
    const selector = '.show-heading-decoration .ProseMirror h1';
    expect(declarationValue(selector, 'border-bottom'))
      .toBe('2px solid var(--heading-h1-color, #2563EB)');
    expect(declarationValue(selector, 'display')).toBeUndefined();
    expect(declarationValue(selector, 'max-width')).toBeUndefined();
    expect(declarationValue(selector, 'width')).toBeUndefined();

    const shrinkWrapSelectors = [
      '.show-numbering.show-heading-decoration .ProseMirror h1',
      '.hide-numbering.show-heading-decoration .ProseMirror h1',
    ];
    for (const shrinkWrap of shrinkWrapSelectors) {
      expect(findRule(shrinkWrap)).toBeUndefined();
    }

    stylesheet.walkRules((rule) => {
      if (!rule.selectors.some((item) => item.includes('heading-decoration'))) return;
      for (const node of rule.nodes) {
        if (node.type === 'decl' && node.prop === 'display') {
          expect(node.value).not.toBe('table');
        }
      }
    });
  });
});
