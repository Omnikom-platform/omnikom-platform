import { describe, expect, it } from 'vitest';
import { changePair, crmSlug, fieldChoices, fileTooBig, flattenSample, MAX_FILE_BYTES, matchWords, pairsFromProposal, sampleHeads, templateColumns, type Proposal } from './importmap';

// Test data lives in tests only (DECISIONS 44 bans sample data in the app source, not in a test that proves a rule).
const proposal: Proposal = {
  template: { columns: [{ header: 'First Name', field: 'name', transform: 'first' }, { header: 'Last Name', field: 'name', transform: 'last' }, { header: 'E-mail', field: 'email' }] },
  scores: [{ header: 'First Name', field: 'name', score: 0.9 }, { header: 'Last Name', field: 'name', score: 0.8 }, { header: 'E-mail', field: 'email', score: 0.95 }],
  unmapped: { headers: [{ header: 'Notes' }, { header: '  ' }, { header: 'E-mail' }] },
  warnings: [],
};

describe('the map pairs', () => {
  it('lists the mapped headers as proposed with their scores, then the unmapped ones with no field', () => {
    const pairs = pairsFromProposal(proposal);
    expect(pairs.map(p => [p.header, p.field, p.transform ?? null, p.score])).toEqual([
      ['First Name', 'name', 'first', 0.9], ['Last Name', 'name', 'last', 0.8], ['E-mail', 'email', null, 0.95], ['Notes', '', null, null],
    ]);
  });
  it('changing a pair keeps the transform only while the field is the proposed one', () => {
    const pairs = pairsFromProposal(proposal);
    const moved = changePair(pairs, 0, 'phone');
    expect(moved[0]).toMatchObject({ field: 'phone', score: null });
    expect(moved[0]?.transform).toBeUndefined();
    const back = changePair(moved, 0, 'name');
    expect(back[0]).toMatchObject({ field: 'name', transform: 'first', score: 0.9 });
    expect(changePair(pairs, 3, 'status')[3]).toMatchObject({ field: 'status' });
    expect(changePair(pairs, 3, 'status')[0]).toEqual(pairs[0]);
  });
  it('the saved columns are the headers that go somewhere', () => {
    const pairs = changePair(pairsFromProposal(proposal), 2, '');
    expect(templateColumns(pairs)).toEqual([{ header: 'First Name', field: 'name', transform: 'first' }, { header: 'Last Name', field: 'name', transform: 'last' }]);
  });
});

describe('names, words and sizes', () => {
  it('the CRM name becomes the lowercase hyphenated word the function wants', () => {
    expect(crmSlug('Follow Up Boss')).toBe('follow-up-boss');
    expect(crmSlug('  HubSpot!! ')).toBe('hubspot');
    expect(crmSlug('***')).toBe('crm');
    expect(crmSlug('')).toBe('crm');
    expect(/^[a-z0-9]+(-[a-z0-9]+)*$/.test(crmSlug('Zoho CRM (v2) / Sales'))).toBe(true);
  });
  it('the match is a percent, and nothing when the owner chose the field', () => {
    expect(matchWords(0.824)).toBe('82% match');
    expect(matchWords(null)).toBe('');
  });
  it('a file over 1 MB is too big, one of exactly 1 MB is not', () => {
    expect(fileTooBig(MAX_FILE_BYTES)).toBe(false);
    expect(fileTooBig(MAX_FILE_BYTES + 1)).toBe(true);
  });
  it('the choices are the core fields the import reads, then the industry fields by label', () => {
    const c = fieldChoices([{ key: 'budget', label: 'Budget', type: 'number' }]);
    expect(c.map(x => x.value)).toEqual(['name', 'email', 'phone', 'status', 'owner', 'answers.budget']);
    expect(c.at(-1)?.label).toBe('Budget');
  });
});

describe('the sample table', () => {
  it('flattens the answers into the row and writes nested values as text', () => {
    expect(flattenSample({ line: 2, name: 'Ada', owner: null, answers: { budget: 5, tags: ['a'] } })).toEqual({ line: '2', name: 'Ada', owner: '', budget: '5', tags: '["a"]' });
  });
  it('the heads are every key seen, in the order first seen', () => {
    expect(sampleHeads([{ a: '1', b: '2' }, { b: '3', c: '4' }])).toEqual(['a', 'b', 'c']);
  });
});
