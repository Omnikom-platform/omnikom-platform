// The guard every csp-<name>.spec.ts installs (work order 38, step 5): on every browser context of a test it records each `securitypolicyviolation` event
// (enforced or report-only: the event carries the disposition) and each console line that is about the Content Security Policy, and after the test it fails
// when there is any. `test` and `expect` are passed in, so this file imports nothing and cannot load a second copy of @playwright/test.
// A context a spec makes itself with browser.newContext() is not covered; `fixtureContexts` below counts those the guard did see, for the proof.
export const seenContexts = { count: 0 };

const CONSOLE_CSP = /Content[- ]Security[- ]Policy|violates the following|Refused to (load|connect|apply|execute|frame|create a worker|set)/i;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function installCspGuard(test: any, expect: any) {
  const found = new WeakMap<object, string[]>();
  test.beforeEach(async ({ context }: { context: any }) => {
    const mine: string[] = [];
    found.set(context, mine);
    seenContexts.count++;
    await context.exposeFunction('__cspViolation', (line: string) => { mine.push(line); });
    await context.addInitScript(() => {
      document.addEventListener('securitypolicyviolation', (e) => {
        const where = (e.documentURI || '').split('?')[0];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (window as any).__cspViolation(`${e.disposition} ${e.violatedDirective}: blocked ${e.blockedURI || '(inline)'} on ${where}${e.sample ? ` sample="${String(e.sample).slice(0, 60)}"` : ''}`);
      });
    });
    context.on('console', (m: { text(): string }) => { const t = m.text(); if (CONSOLE_CSP.test(t)) mine.push(`console: ${t.slice(0, 300)}`); });
  });
  test.afterEach(async ({ context }: { context: any }) => {
    expect(found.get(context) ?? [], 'Content Security Policy violations (securitypolicyviolation events and console lines)').toEqual([]);
  });
}
