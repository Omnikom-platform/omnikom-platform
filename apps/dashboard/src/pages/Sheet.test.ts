// The one modal sheet, read from the source (node only, no DOM): no hand-built dialog is left, every sheet goes through Sheet.tsx, no sheet adds its own
// Esc listener, and the three sheets that had no Esc tie their onClose to what their Cancel or Stay button does. The dashboard has no browser run in CI:
// what a real browser does with showModal() and close() is not seen here (SheetFocus.test.tsx has a stand-in, the head's run sheet has the browser).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC = join(__dirname, '..');
const files = (readdirSync(SRC, { recursive: true }) as string[])
  .filter(f => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
  .map(f => f.replace(/\\/g, '/'));
const text = (f: string) => readFileSync(join(SRC, f), 'utf8');
const holding = (needle: string) => files.filter(f => text(f).includes(needle));

const SEVEN = ['DeleteSheet', 'Editor', 'MediaLibrary', 'PublishHistory', 'PublishSheet', 'Settings', 'SettingsPeople'].map(n => `pages/${n}.tsx`);

describe('the one modal sheet', () => {
  it('S1: no file holds role="dialog", aria-modal or a dialog tag of its own', () => {
    const bad = [...new Set(['role="dialog"', 'aria-modal', '<dialog'].flatMap(holding))];
    expect(bad, 'files with a hand-built dialog').toEqual([]);
  });

  it('S2: Sheet.tsx exists and opens a dialog with showModal', () => {
    expect(existsSync(join(SRC, 'pages/Sheet.tsx'))).toBe(true);
    const s = text('pages/Sheet.tsx');
    expect(s).toContain('.showModal(');
    expect(s).toContain("createElement('dialog'");
  });

  it('S3: exactly the seven sheets use <Sheet ', () => {
    expect(holding('<Sheet ').sort()).toEqual([...SEVEN].sort());
  });

  it('S4: none of the seven adds a keydown listener', () => {
    expect(SEVEN.filter(f => text(f).includes("addEventListener('keydown'"))).toEqual([]);
  });

  it.each([
    ['pages/PublishSheet.tsx'],
    ['pages/Settings.tsx'],
    ['pages/SettingsPeople.tsx'],
  ])('S5 to S7: the Esc of %s does what its Cancel or Stay button does', f => {
    const src = text(f);
    const match = /<Sheet onClose=\{(.+?)\} data-plan=/.exec(src);
    expect(match, 'a <Sheet onClose={...} data-plan= call in the file').toBeTruthy();
    expect(src, 'the button that does the same').toContain(`onClick={${match![1]}}`);
  });
});
