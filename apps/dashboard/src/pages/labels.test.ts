// A control's name is its label and nothing else (WCAG 2.2 AA, 4.1.2 and 3.3.2). A <label> that WRAPS a <select> gives the select the text of every
// option as part of its name ("Filter byReceivedNameEmail..."), which a screen reader reads out and which makes getByLabel('Phone') match the pick.
// Work order 07: every select's label sits BESIDE it (htmlFor and id). Two checks: the markup the filter control
// renders, and a scan of EVERY screen under src/pages for any label that wraps a select.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ColumnFilters } from './ColumnFilters';
import type { Column } from '../lib/crm';
import { FLOOR_LISTS } from '../lib/leads';

const columns: Column[] = [
  { key: 'name', label: 'Name', type: 'text' },
  { key: 'owner', label: 'Owner', type: 'owner' },
  { key: 'budget', label: 'Budget (USD)', type: 'number' },
];

/** The label text of the control with that id, from the markup: <label for="id">TEXT</label>; null when no label points at it. */
function labelOf(markup: string, id: string): string | null {
  const m = new RegExp(`<label[^>]*for="${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"[^>]*>([^<]*)</label>`).exec(markup);
  return m ? m[1]! : null;
}

describe('the filter control names its select by its label alone', () => {
  const markup = renderToStaticMarkup(createElement(ColumnFilters, { columns, filters: [], team: new Map(), lists: FLOOR_LISTS, onChange: () => undefined }));
  const select = /<select[^>]*id="([^"]+)"[^>]*name="filter-column"/.exec(markup) ?? /<select[^>]*name="filter-column"[^>]*id="([^"]+)"/.exec(markup);

  it('has a select with an id', () => {
    expect(select, markup.slice(0, 300)).not.toBeNull();
  });
  it('the select\'s label is exactly "Filter by" and sits beside the select, not around it', () => {
    expect(labelOf(markup, select![1]!)).toBe('Filter by');
    expect(markup).not.toMatch(/<label[^>]*>(?:(?!<\/label>)[^])*?<select/);
  });
});

describe('no label wraps a select in any screen of src/pages (a new one anywhere goes red)', () => {
  const FILES = readdirSync(import.meta.dirname).filter(f => f.endsWith('.tsx')).sort();
  it('there are screens to scan', () => { expect(FILES.length).toBeGreaterThan(10); });
  for (const f of FILES) {
    it(f, () => {
      const code = readFileSync(join(import.meta.dirname, f), 'utf8');
      const wrapping = [...code.matchAll(/<label\b[^>]*>([^]*?)<\/label>/g)].filter(m => /<select\b/.test(m[1]!));
      expect(wrapping.map(m => m[0].slice(0, 80))).toEqual([]);
    });
  }
});
