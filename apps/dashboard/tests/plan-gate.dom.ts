// The DOM half of the plan gate (DECISIONS 44): on the screens the Playwright run visits, every interactive element and every piece of
// visible text sits inside an element that carries a data-plan id, every id is in the plan, and the ids a screen must show are there.
import type { Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const PLAN_FILE = resolve(import.meta.dirname, '..', '..', '..', 'docs', 'blueprint', '16-DESIGN-PARTS.md');

/** Every Id of the plan with its Slice, read from the plan file the flows run against. */
export function planIds(): Map<string, string> {
  const ids = new Map<string, string>();
  for (const line of readFileSync(PLAN_FILE, 'utf8').split(/\r?\n/)) {
    const m = /^\|\s*(DP-[0-9a-z.]+-\d+)\s*\|\s*([^|]*?)\s*\|/.exec(line);
    if (m && m[1] && m[2] !== undefined) ids.set(m[1], m[2]);
  }
  return ids;
}

/**
 * Problems found on the page as it is now (an empty list is a pass).
 * `required`: ids this screen must show; `absent`: ids it must not show (an agent never sees the Owner control).
 */
export async function planProblems(page: Page, o: { required?: string[]; absent?: string[]; built?: string[] } = {}): Promise<string[]> {
  const plan = planIds();
  const built = o.built ?? ['5.3', '5.4'];
  const found = await page.evaluate(() => {
    const out = { ids: [] as string[], bare: [] as string[], text: [] as string[], tells: [] as string[] };
    const INTERACTIVE = 'button, a[href], input:not([type=hidden]), select, textarea, form, dialog, details, summary, [role=button], [role=radio], [onclick]';
    document.querySelectorAll('[data-plan]').forEach(el => out.ids.push(el.getAttribute('data-plan') ?? ''));
    document.querySelectorAll(INTERACTIVE).forEach(el => {
      if (!el.closest('[data-plan]')) out.bare.push(`<${el.tagName.toLowerCase()}> ${(el.textContent ?? '').trim().slice(0, 40)}`);
    });
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = (n.textContent ?? '').replace(/\s+/g, ' ').trim();
      const parent = n.parentElement;
      if (!text || !parent || parent.closest('script, style, noscript')) continue;
      if (!parent.closest('[data-plan]')) out.text.push(text.slice(0, 60));
      if (/lorem|ipsum|john doe|jane doe|\bacme\b/i.test(text)) out.tells.push(text.slice(0, 60));
    }
    for (const el of Array.from(document.querySelectorAll('[placeholder], [aria-label], [title], [alt]'))) {
      for (const a of ['placeholder', 'aria-label', 'title', 'alt']) {
        const v = el.getAttribute(a);
        if (v && !el.closest('[data-plan]')) out.text.push(`${a}="${v.slice(0, 40)}"`);
        if (v && /lorem|ipsum|john doe|jane doe|\bacme\b/i.test(v)) out.tells.push(`${a}="${v.slice(0, 40)}"`);
      }
    }
    return out;
  });

  const problems: string[] = [];
  for (const id of new Set(found.ids)) {
    if (!plan.has(id)) problems.push(`data-plan ${id} is not in the plan`);
    else if (!built.includes(plan.get(id) ?? '')) problems.push(`data-plan ${id} is a row of slice ${plan.get(id)}, which is not built`);
  }
  for (const b of found.bare) problems.push(`interactive element outside any data-plan: ${b}`);
  for (const x of found.text) problems.push(`text outside any data-plan: ${x}`);
  for (const x of found.tells) problems.push(`placeholder tell: ${x}`);
  for (const id of o.required ?? []) if (!found.ids.includes(id)) problems.push(`${id} is not on this screen`);
  for (const id of o.absent ?? []) if (found.ids.includes(id)) problems.push(`${id} must not be on this screen`);
  return problems;
}
