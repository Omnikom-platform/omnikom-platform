// lib/media.ts, book row B14: where a file is used and what is wrong with it there.
import { describe, expect, it } from 'vitest';
import { problemsOf, usesOf } from './media';
import type { Contract } from './site';

const contract: Contract = {
  collections: {
    settings: { label: 'Business details', kind: 'singleton', access: { member: 'none' }, fields: { logo: { type: 'image', media: { minWidth: 200 } } } },
    listings: { label: 'Listings', kind: 'collection', titleField: 'street', access: { member: 'own' }, fields: { street: { type: 'text' },
      photos: { type: 'gallery', media: { minWidth: 400, rightsConfirm: true } }, rooms: { type: 'list', of: { plan: { type: 'image' } } }, brochure: { type: 'file' } } },
    pages: { label: 'Pages', kind: 'collection', titleField: 'title', access: { member: 'none' }, fields: { title: { type: 'text' }, sections: { type: 'sections' } } },
  },
  pageTypes: { home: { sections: [{ id: 'hero', kind: 'fields', fields: { photo: { type: 'image', media: { minWidth: 1600 } } } }] } },
  pages: [],
};
const row = (id: string, collection: string, data: Record<string, unknown>) => ({ id, collection, newest: { n: 1, data, by: '', at: '' } });
const uses = usesOf(contract, [row('r1', 'settings', { logo: { asset: 'm1', alt: 'Logo' } }),
  row('r2', 'listings', { street: '1 Main St', photos: [{ asset: 'm2' }, { asset: 'm1', alt: 'Front' }], rooms: [{ plan: { asset: 'm3', alt: 'Plan' } }], brochure: { asset: 'm4' } }),
  row('r3', 'pages', { title: 'Home', type: 'home', sections: { hero: { photo: { asset: 'm2', alt: ' ' } } } })]);
const where = (m: string) => (uses.get(m) ?? []).map(u => `${u.row} ${u.path}`);
const codes = (file: { width: number | null; rights_confirmed: boolean }, m: string) => problemsOf(file, uses.get(m) ?? []).map(p => `${p.code} ${p.use.path}`);

describe('usesOf', () => {
  it('finds a file in a field, a gallery, a list row, a file field and a page section, with the path the editor opens', () => {
    expect([...uses.keys()].sort()).toEqual(['m1', 'm2', 'm3', 'm4']);
    expect(where('m1')).toEqual(['r1 logo', 'r2 photos[1]']);
    expect(where('m2')).toEqual(['r2 photos[0]', 'r3 sections.hero.photo']);
    expect(where('m3')).toEqual(['r2 rooms[0].plan']);
    expect(where('m4')).toEqual(['r2 brochure']);
    expect(uses.get('m1')?.[1]).toEqual({ row: 'r2', collection: 'listings', title: '1 Main St', label: 'Photos', path: 'photos[1]', photo: true, alt: 'Front', minWidth: 400, rights: true });
  });
});

describe('problemsOf', () => {
  it('flags a photo with no alt text (blank counts), never a file', () => {
    expect(codes({ width: 2000, rights_confirmed: true }, 'm2')).toEqual(['no-alt photos[0]', 'no-alt sections.hero.photo']);
    expect(codes({ width: 2000, rights_confirmed: true }, 'm4')).toEqual([]);
  });

  it('flags a photo too small for one use only, and nothing while its width is not known', () => {
    expect(codes({ width: 500, rights_confirmed: true }, 'm2').filter(c => c.startsWith('too-small'))).toEqual(['too-small sections.hero.photo']);
    expect(codes({ width: null, rights_confirmed: true }, 'm2').filter(c => c.startsWith('too-small'))).toEqual([]);
  });

  it('flags the missing rights tick only where the field asks for it', () => {
    expect(codes({ width: 2000, rights_confirmed: false }, 'm1')).toEqual(['no-rights photos[1]']);
    expect(codes({ width: 2000, rights_confirmed: true }, 'm1')).toEqual([]);
  });
});
