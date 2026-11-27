// The Websites card's "Ask Omnikom" link (B18, DP-1.6-07): a mail link to the address the build was given, with a site and with none.
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Websites } from './Settings';
import type { Site } from '../data';

const held = vi.hoisted(() => ({ config: { askEmail: '' }, sites: [] as unknown[] }));
vi.mock('../data', () => ({ useMe: () => ({}), useTeam: () => ({}), useSites: () => ({ data: held.sites, isLoading: false, error: null }) }));
vi.mock('../config', () => ({ config: held.config }));
vi.mock('../supabase', () => ({ supabase: {} }));   // no client and no keys in a test

const one: Site = { id: 's1', preview_host: 'preview.site.test', domain: null, state: 'preview' };
const link = '<a href="mailto:hello@omnikom.ai" data-plan="DP-1.6-07">Ask Omnikom</a>';
const view = (askEmail: string, sites: Site[]) => {
  held.config.askEmail = askEmail;
  held.sites = sites;
  return renderToStaticMarkup(<Websites workspace="ws-1" />);
};

describe('Settings: the Websites card asks Omnikom (B18)', () => {
  it('with a site: the card holds the mail link to the address', () => {
    const html = view('hello@omnikom.ai', [one]);
    expect(html).toContain('preview.site.test');
    expect(html).toContain(link);
  });

  it('with no site: the empty state holds the same mail link', () => {
    const html = view('hello@omnikom.ai', []);
    expect(html).toContain('No website yet.');
    expect(html).toContain(link);
  });

  it('control: with no address there is no link in either state', () => {
    for (const html of [view('', [one]), view('', [])]) expect(html).not.toMatch(/<a [^>]*>Ask Omnikom/);
  });
});
