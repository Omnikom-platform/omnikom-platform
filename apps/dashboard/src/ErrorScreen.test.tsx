import { describe, expect, it, vi } from 'vitest';
import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ErrorScreen } from './ErrorScreen';

/** Every element of a React tree, depth first (the function component is called, not mounted: no DOM is needed to read its tree). */
function walk(node: ReactNode, out: ReactElement<{ children?: ReactNode; onClick?: () => void; 'data-plan'?: string }>[] = []) {
  if (Array.isArray(node)) node.forEach(n => walk(n, out));
  else if (isValidElement(node)) { out.push(node as never); walk((node.props as { children?: ReactNode }).children, out); }
  return out;
}

describe('ErrorScreen (DP-1.2s-12, DP-1.2s-13)', () => {
  const html = renderToStaticMarkup(<ErrorScreen />);

  it('says the plan sentence in the one h1, carrying DP-1.2s-12', () => {
    expect(html).toContain('<h1 data-plan="DP-1.2s-12">Something went wrong. Reload the page to try again.</h1>');
    expect(html.match(/<h1\b/g)).toHaveLength(1);
  });

  it('has one Reload button carrying DP-1.2s-13', () => {
    expect(html).toContain('data-plan="DP-1.2s-13"');
    expect(html.match(/<button\b/g)).toHaveLength(1);
    expect(html).toMatch(/>Reload<\/button>/);
  });

  it('shows no error text, stack or path, whatever the router hands it (SEC-007)', () => {
    // the router calls the errorComponent with { error, reset, info }; the component takes no props, so none of it can reach the page
    const Screen = ErrorScreen as unknown as (p: object) => ReactElement;
    const out = renderToStaticMarkup(Screen({ error: new Error('secret at C:\\app\\src\\Leads.tsx:12 SELECT * FROM leads'), info: { componentStack: 'at Leads' } }));
    expect(out).toBe(html);
    expect(out).not.toMatch(/secret|SELECT|Leads|\.tsx|at /);
  });

  it('Reload calls location.reload()', () => {
    const reload = vi.fn();
    vi.stubGlobal('location', { reload });
    try {
      const button = walk(ErrorScreen()).find(e => e.props['data-plan'] === 'DP-1.2s-13');
      expect(button?.props.onClick).toBeTypeOf('function');
      button!.props.onClick!();
      expect(reload).toHaveBeenCalledTimes(1);
    } finally { vi.unstubAllGlobals(); }
  });
});
