// Tests of the plan gate (tests/plan-gate.mjs): the real source passes; each rule has a small fixture that trips it; and each mutant below
// is a one-line break of the REAL source that must turn the gate red for its own reason (the red lines are printed).
import { describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { loadBuilt, readPlan, routePaths, scanSources } from './plan-gate.mjs';

// a full scan of the source per test: on a busy laptop one took longer than vitest's default 5 s (5-DS finding F4)
vi.setConfig({ testTimeout: 60_000 });

const ROOT = resolve(import.meta.dirname, '..');
const plan = readPlan(readFileSync(resolve(ROOT, '..', '..', 'docs', 'blueprint', '16-DESIGN-PARTS.md'), 'utf8'));
const built = loadBuilt();
const indexHtml = readFileSync(join(ROOT, 'index.html'), 'utf8');

function sourceFiles() {
  const out = [];
  const walk = dir => {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(e) && !/\.test\./.test(e) && !e.endsWith('.d.ts')) out.push({ path: relative(ROOT, p).replace(/\\/g, '/'), code: readFileSync(p, 'utf8') });
    }
  };
  walk(join(ROOT, 'src'));
  return out;
}

function scanReal(mutate = files => files, html = indexHtml) {
  const files = mutate(sourceFiles().map(f => ({ ...f })));
  const router = files.find(f => f.path === 'src/router.tsx');
  return scanSources({ files, plan, built, routes: routePaths(router.code), indexHtml: html });
}

/** Replace `find` (a string that must occur exactly once) in `file`: a patch that did not apply fails the test instead of passing quietly. */
function patch(file, find, replace) {
  return files => {
    const f = files.find(x => x.path === file);
    expect(f, `${file} exists`).toBeTruthy();
    const count = f.code.split(find).length - 1;
    expect(count, `the patch target in ${file} occurs exactly once (it occurs ${count} times): ${find.slice(0, 50)}`).toBe(1);
    f.code = f.code.replace(find, () => replace);
    return files;
  };
}

describe('the plan itself', () => {
  it('has rows, and slices 5.3, 5.3b, 5.3c, 5.3d, 5.4, 5.6 and 5.7 are the built ones', () => {
    expect(plan.size).toBeGreaterThan(60);
    expect(built).toEqual(['5.3', '5.3b', '5.3c', '5.3d', '5.4', '5.6', '5.7']);
    expect(plan.get('DP-1.2-05')?.slice).toBe('5.3');
    expect(plan.get('DP-1.3-05')?.slice).toBe('5.3b');
  });
});

describe('the real source passes the gate', () => {
  it('has no problem', () => {
    const problems = scanReal();
    expect(problems.map(p => `${p.rule} ${p.file}:${p.line} ${p.message}`)).toEqual([]);
  });
  it('carries every row of the built slice', () => {
    const missing = scanReal().filter(p => p.rule === 'PLAN-3');
    expect(missing).toEqual([]);
  });
});

describe('each rule has a fixture that trips it and one that does not', () => {
  const mini = readPlan([
    '| DP-9.1-01 | 5.3 | Save button | click | saves | "Saved. Undo" | |',
    '| DP-9.1-02 | 5.3 | Name field | type | | | |',
    '| DP-9.1-03 | 9.9 | Later thing | | | | |',
  ].join('\n'));
  const routes = new Set(['/', '/home']);
  const run = (code, extra = {}) => scanSources({ files: [{ path: 'src/x.tsx', code }], plan: mini, built: ['5.3'], routes, ...extra });
  const rules = (code, extra) => run(code, extra).map(p => p.rule);
  const clean = `export const A = () => (<form data-plan="DP-9.1-01" onSubmit={() => undefined}><label data-plan="DP-9.1-02">Name <input onChange={() => undefined} /></label><button type="submit">Save</button></form>);`;

  it('a clean file has only the one problem it should: the row nobody carries is not claimed here', () => {
    expect(rules(clean)).toEqual([]);
  });
  it('PLAN-1: a button with no data-plan; copy outside any element that has one', () => {
    expect(rules(`export const A = () => (<div><button onClick={() => 1}>x</button></div>);`)).toContain('PLAN-1');
    expect(rules(`export const A = () => (<p>Hello there</p>);`)).toContain('PLAN-1');
  });
  it('PLAN-2: an id that is not in the plan, a data-plan that is not a literal, a t() without its id', () => {
    expect(rules(`export const A = () => (<button data-plan="DP-0.0-00" onClick={() => 1}>x</button>);`)).toContain('PLAN-2');
    expect(rules(`const id = 'DP-9.1-01'; export const A = () => (<button data-plan={id} onClick={() => 1}>x</button>);`)).toContain('PLAN-2');
    expect(rules(`import { t } from './plan'; export const A = t('DP-0.0-00', 'Saved');`)).toContain('PLAN-2');
  });
  it('PLAN-3: a row of a built slice that no element carries; a row of an unbuilt slice is not demanded', () => {
    const p = run(`export const A = () => (<button data-plan="DP-9.1-01" onClick={() => 1}>Save</button>);`);
    expect(p.filter(x => x.rule === 'PLAN-3').map(x => x.message)).toEqual([expect.stringContaining('DP-9.1-02')]);
  });
  it('PLAN-4: words that are not in the row; whole words only ("Mark" is not "Marked")', () => {
    expect(rules(`export const A = () => (<button data-plan="DP-9.1-01" onClick={() => 1}>Keep it</button>);`)).toContain('PLAN-4');
    expect(rules(`import { t } from './plan'; export const A = t('DP-9.1-01', 'Saved. Undo'); export const B = t('DP-9.1-01', 'Sav');`)).toContain('PLAN-4');
    expect(run(`import { t } from './plan'; export const A = t('DP-9.1-01', 'Saved. Undo');`).filter(x => x.rule === 'PLAN-4')).toEqual([]);
  });
  it('PLAN-5: prose in code that is not in a data-plan element, a t() call, an Error or a console call', () => {
    expect(rules(`export const msg = 'Something went wrong here';`)).toContain('PLAN-5');
    expect(rules(`export const f = () => { throw new Error('Something went wrong here'); };`)).not.toContain('PLAN-5');
    expect(rules(`export const f = () => console.warn('Something went wrong here');`)).not.toContain('PLAN-5');
    expect(rules(`export const q = 'id,slug,name'; export const k = 'content-type';`)).not.toContain('PLAN-5');
  });
  it('PLAN-6: a button with no handler, a form with no onSubmit, an input with no onChange, a link to a route that does not exist', () => {
    expect(rules(`export const A = () => (<button data-plan="DP-9.1-01">Save</button>);`)).toContain('PLAN-6');
    expect(rules(`export const A = () => (<form data-plan="DP-9.1-01"><button type="submit">Save</button></form>);`)).toContain('PLAN-6');
    expect(rules(`export const A = () => (<label data-plan="DP-9.1-02">Name <input /></label>);`)).toContain('PLAN-6');
    expect(rules(`export const A = () => (<Link to="/nowhere" data-plan="DP-9.1-01">Save</Link>);`)).toContain('PLAN-6');
    expect(rules(`export const A = () => (<Link to="/home" data-plan="DP-9.1-01">Save</Link>);`)).not.toContain('PLAN-6');
    expect(rules(`export const f = (nav) => nav({ to: '/nowhere' });`)).toContain('PLAN-6');
  });
  it('PLAN-7: lorem, John Doe, Acme, a 555 number, an example address, a bare number as text', () => {
    for (const s of ['Lorem ipsum dolor', 'John Doe', 'Acme Realty', '(555) 010-0100', 'x@example.com'])
      expect(rules(`export const v = '${s}';`), s).toContain('PLAN-7');
    expect(rules(`export const A = () => (<span data-plan="DP-9.1-01">3</span>);`)).toContain('PLAN-7');
  });
  it('PLAN-8: words in index.html', () => {
    expect(rules(clean, { indexHtml: '<html><head><title>My app</title></head><body></body></html>' })).toContain('PLAN-8');
    expect(rules(clean, { indexHtml: '<html><head><title></title></head><body><div id="root"></div><script type="module" src="/m.js"></script></body></html>' })).not.toContain('PLAN-8');
  });
  it('PLAN-9: a row of a slice that is not built, on a screen', () => {
    expect(rules(`export const A = () => (<button data-plan="DP-9.1-03" onClick={() => 1}>x</button>);`)).toContain('PLAN-9');
  });
});

describe('mutants of the real source: each must turn the gate red for its reason', () => {
  const red = (name, problems, rule, mentions) => {
    const hit = problems.find(p => p.rule === rule && (!mentions || `${p.file} ${p.message}`.includes(mentions)));
    console.log(`MUTANT ${name}: ${hit ? `RED  ${hit.rule} ${hit.file}:${hit.line} ${hit.message}` : 'STAYED GREEN'}`);
    expect(hit, `${name} must produce ${rule}${mentions ? ` mentioning ${mentions}` : ''}`).toBeTruthy();
  };

  it('remove one data-plan (the Sign out button)', () => {
    red('remove-data-plan', scanReal(patch('src/pages/SignOutButton.tsx', ' data-plan="DP-1.2-09"', '')), 'PLAN-1', 'SignOutButton.tsx');
  });
  it('add an id that is not in the plan', () => {
    red('unknown-id', scanReal(patch('src/pages/Shell.tsx', 'data-plan="DP-1.2s-03"', 'data-plan="DP-9.9-99"')), 'PLAN-2', 'DP-9.9-99');
  });
  it('delete the element of a 5.3 row (the Search field)', () => {
    red('delete-element', scanReal(patch('src/pages/Leads.tsx', '<input type="search" data-plan="DP-1.3-03" aria-label="Search" placeholder="Search" name="q" value={typed} onChange={e => setTyped(e.target.value)} />', '')), 'PLAN-3', 'DP-1.3-03');
  });
  it('plant an invented string (the Add a lead link)', () => {
    red('invented-string', scanReal(patch('src/pages/Leads.tsx', 'data-plan="DP-1.3-04">Add a lead</Link>', 'data-plan="DP-1.3-04">Add a brand new lead now</Link>')), 'PLAN-4', 'DP-1.3-04');
  });
  it('plant an invented string in code (a toast sentence with no plan row)', () => {
    red('invented-code-string', scanReal(patch('src/pages/LeadPanel.tsx', "const NOTE_MAX = 2000;", "const oops = 'Oops that did not work';\nconst NOTE_MAX = 2000;")), 'PLAN-5', 'Oops that did not work');
  });
  it('plant a button with no handler', () => {
    red('no-handler', scanReal(patch('src/pages/Leads.tsx', '<section data-live={live}>', '<section data-live={live}>\n          <button type="button" data-plan="DP-1.3-04">Add a lead</button>')), 'PLAN-6', '<button> does nothing');
  });
  it('plant a link to a route that does not exist', () => {
    red('dead-link', scanReal(patch('src/pages/Shell.tsx', '<Link to="/w/$ws/leads" params={{ ws }} search={prev => prev} data-plan="DP-1.2s-03"', '<Link to="/w/$ws/billing" params={{ ws }} search={prev => prev} data-plan="DP-1.2s-03"')), 'PLAN-6', '/w/$ws/billing');
  });
  it('plant a John Doe lead in source', () => {
    red('john-doe', scanReal(patch('src/data.ts', 'export type Workspace =', "export const sampleLead = { name: 'John Doe', phone: '(555) 010-0100' };\nexport type Workspace =")), 'PLAN-7', 'John');
  });
  it('plant a fake count as text', () => {
    red('fake-count', scanReal(patch('src/pages/Shell.tsx', '<p data-plan="DP-1.2s-01"><strong>{workspace.name}</strong></p>', '<p data-plan="DP-1.2s-01"><strong>{workspace.name}</strong> <span>3</span></p>')), 'PLAN-7', 'bare number');
  });
  it('show an element of a slice that is not built (the Preview button, slice 5.5)', () => {
    red('unbuilt-row', scanReal(patch('src/pages/Shell.tsx', '<SignOutButton />\n        </nav>', '<Link to="/w/$ws/leads" params={{ ws }} data-plan="DP-1.4-18">Preview</Link>\n          <SignOutButton />\n        </nav>')), 'PLAN-9', 'DP-1.4-18');
  });
  it('slice 5.3d: take the element of one row away (the line "View: <name>" is the only carrier of DP-1.3-62)', () => {
    red('delete-53d-element', scanReal(f => patch('src/pages/ViewsPanel.tsx', '<p data-plan="DP-1.3-62">', '<p data-plan="DP-1.3-61">')(patch('src/pages/ViewsPanel.tsx', "t('DP-1.3-62', 'View:')", "t('DP-1.3-61', 'View:')")(f))), 'PLAN-3', 'DP-1.3-62');
  });
  it('slice 5.3d: plant words that are not in the row (the empty Tasks line)', () => {
    red('invented-tasks-words', scanReal(patch('src/pages/LeadTasks.tsx', "t('DP-1.3-71', 'No tasks yet.')", "t('DP-1.3-71', 'No tasks at all yet.')")), 'PLAN-4', 'DP-1.3-71');
  });
  it('slice 5.3d: remove one data-plan (the Columns button)', () => {
    red('remove-53d-data-plan', scanReal(patch('src/pages/ColumnsPicker.tsx', '<button type="button" data-plan="DP-1.3-51" aria-expanded', '<button type="button" aria-expanded')), 'PLAN-1', 'ColumnsPicker.tsx');
  });
  it('slice 5.4: take the element of one row away (the Publish N changes button is the only carrier of DP-1.4-04)', () => {
    red('delete-54-element', scanReal(patch('src/pages/SiteLayout.tsx', '<p data-plan="DP-1.4-04" className={css.idle}>Nothing to publish</p>\n        ) : (\n          <button type="button" data-plan="DP-1.4-04" disabled', '<p data-plan="DP-1.4-05" className={css.idle}>Nothing to publish</p>\n        ) : (\n          <button type="button" data-plan="DP-1.4-05" disabled')), 'PLAN-3', 'DP-1.4-04');
  });
  it('slice 5.4: plant words that are not in the sheet question', () => {
    red('invented-sheet-words', scanReal(patch('src/pages/PublishSheet.tsx', "Publish {drafts.length === 1 ? 'this change' : `these ${drafts.length} changes`} to <span className={css.address}>{name}</span>?", "Publish all of {drafts.length === 1 ? 'this change' : `these ${drafts.length} changes`} to <span className={css.address}>{name}</span>?")), 'PLAN-4', 'DP-1.4c-02');
  });
  it('slice 5.4: show the Preview button of slice 5.5 in the editor', () => {
    red('unbuilt-preview', scanReal(patch('src/pages/Editor.tsx', '<button type="button" data-plan="DP-1.4-19" aria-expanded={showHistory}', '<button type="button" data-plan="DP-1.4-18" onClick={() => undefined}>Preview</button>\n        <button type="button" data-plan="DP-1.4-19" aria-expanded={showHistory}')), 'PLAN-9', 'DP-1.4-18');
  });
  it('slice 5.4: plant a sentence of ours in the editor code (the stale sentence reworded)', () => {
    red('invented-editor-string', scanReal(patch('src/pages/Editor.tsx', "const AUTOSAVE_MS = 10_000;", "const oops = 'Someone else edited this page';\nconst AUTOSAVE_MS = 10_000;")), 'PLAN-5', 'Someone else edited this page');
  });
  it('slice 5.7: take the element of one row away (the Overview tab is the only carrier of DP-1.2s-14)', () => {
    red('delete-57-element', scanReal(patch('src/pages/Shell.tsx', 'data-plan="DP-1.2s-14"', 'data-plan="DP-1.2s-03"')), 'PLAN-3', 'DP-1.2s-14');
  });
  it('slice 5.7: plant words that are not in the row (the empty changes line)', () => {
    red('invented-57-words', scanReal(patch('src/lib/overview.ts', "t('DP-1.9-04', 'Nothing to publish')", "t('DP-1.9-04', 'Nothing to publish today')")), 'PLAN-4', 'DP-1.9-04');
  });
  it('put words in index.html', () => {
    red('html-words', scanReal(files => files, indexHtml.replace('<title></title>', '<title>Omnikom</title>')), 'PLAN-8');
  });
});

// Found by the invite flow on staging (2026-11-12): a type="email" box in a form without noValidate makes the browser stop the submit with its own
// bubble, so the form's own check never runs and the plan's sentence (DP-1.6-15 "Enter a full email address.") never shows. Login.tsx has noValidate
// on both its forms for this reason. The rule is by file: in a page file that holds such a box ANYWHERE (inside a form, or in a variable the form
// renders, as Login's emailField), every <form> of the file carries noValidate. A box typed by a variable (type={kind}) is not seen.
describe('a form that holds an email, url or tel box carries noValidate', () => {
  /** The opening tag that starts at `from`: up to its closing `>`, which is not the `>` of an arrow function inside braces. */
  const tagAt = (code, from) => {
    let depth = 0;
    for (let i = from; i < code.length; i++) {
      if (code[i] === '{') depth++;
      else if (code[i] === '}') depth--;
      else if (code[i] === '>' && depth === 0) return code.slice(from, i);
    }
    return code.slice(from);
  };
  const holdsTypedBox = body => [...body.matchAll(/<input\b/g)].some(m => /\btype="(?:email|url|tel)"/.test(tagAt(body, m.index)));
  const unvalidated = files => files.filter(f => /^src\/pages\/[^/]+\.tsx$/.test(f.path)).flatMap(f => {
    const boxInFile = holdsTypedBox(f.code);   // a box inside a form is a box of the file: the first form of this rule is a case of this one
    return [...f.code.matchAll(/<form\b/g)].flatMap(m => {
      if (!boxInFile || /\bnoValidate\b/.test(tagAt(f.code, m.index))) return [];
      return [`${f.path}:${f.code.slice(0, m.index).split('\n').length} a <form> in a file that holds an email, url or tel box has no noValidate (the browser's bubble stops the submit before the form's own check)`];
    });
  });
  const form = (attrs, input) => ({ path: 'src/pages/X.tsx', code: `export const A = () => (<form onSubmit={e => void go(e)}${attrs}>${input}</form>);` });

  it('a fixture trips it for each of the three types, whatever the order of the attributes, and not for a text box, a clean form or a box outside a form', () => {
    for (const type of ['email', 'url', 'tel']) expect(unvalidated([form('', `<input type="${type}" onChange={e => put(e.target.value)} />`)]), type).toHaveLength(1);
    expect(unvalidated([form('', '<input name="a" onChange={e => put(e.target.value)} type="email" />')])).toHaveLength(1);
    expect(unvalidated([form('', '<input type="text" onChange={() => 1} />')])).toEqual([]);
    expect(unvalidated([form(' noValidate', '<input type="email" onChange={() => 1} />')])).toEqual([]);
    expect(unvalidated([{ path: 'src/pages/X.tsx', code: 'export const A = () => (<label><input type="url" onChange={() => 1} /></label>);' }])).toEqual([]);
  });
  it('the real source: every such form has noValidate', () => {
    expect(unvalidated(sourceFiles())).toEqual([]);
  });
  it('the real source with noValidate taken off the invite form is red, and names the file (watched red)', () => {
    const problems = unvalidated(patch('src/pages/SettingsPeople.tsx', ' data-plan="DP-1.6-02" noValidate>', ' data-plan="DP-1.6-02">')(sourceFiles().map(f => ({ ...f }))));
    console.log(`MUTANT no-novalidate-people: ${problems.length ? `RED  ${problems[0]}` : 'STAYED GREEN'}`);
    expect(problems.some(p => p.startsWith('src/pages/SettingsPeople.tsx:')), 'the invite form without noValidate must be named').toBe(true);
  });
  it('the real source with noValidate taken off the Add a lead form is red, and names the file (watched red)', () => {
    const problems = unvalidated(patch('src/pages/AddLead.tsx', ' className={css.form} noValidate>', ' className={css.form}>')(sourceFiles().map(f => ({ ...f }))));
    console.log(`MUTANT no-novalidate-addlead: ${problems.length ? `RED  ${problems[0]}` : 'STAYED GREEN'}`);
    expect(problems.some(p => p.startsWith('src/pages/AddLead.tsx:')), 'the Add a lead form without noValidate must be named').toBe(true);
  });
  it('a box that sits in a variable above the form is seen: the rule is by file, so every form of a file that holds such a box needs noValidate', () => {
    const viaVariable = attrs => ({ path: 'src/pages/X.tsx', code: `const field = (<input type="email" onChange={() => 1} />);\nexport const A = () => (<form onSubmit={e => void go(e)}${attrs}>{field}</form>);` });
    const named = unvalidated([viaVariable('')]);
    expect(named).toHaveLength(1);
    expect(named[0]).toMatch(/^src\/pages\/X\.tsx:2 /);
    expect(unvalidated([viaVariable(' noValidate')])).toEqual([]);
    expect(unvalidated([{ path: 'src/pages/X.tsx', code: 'const field = (<input type="text" onChange={() => 1} />);\nexport const A = () => (<form onSubmit={e => void go(e)}>{field}</form>);' }])).toEqual([]);
  });
  it('the real source with noValidate taken off the first form of Login.tsx (its email box comes through emailField) is red, and names the file (watched red)', () => {
    const problems = unvalidated(patch('src/pages/Login.tsx', 'onSubmit={e => void sendLink(e)} noValidate>', 'onSubmit={e => void sendLink(e)}>')(sourceFiles().map(f => ({ ...f }))));
    console.log(`MUTANT no-novalidate-login: ${problems.length ? `RED  ${problems[0]}` : 'STAYED GREEN'}`);
    expect(problems.some(p => p.startsWith('src/pages/Login.tsx:')), 'the Login form without noValidate must be named').toBe(true);
  });
});

describe('work order 39: a label that is data is not plan copy, and the gate is not loosened for it', () => {
  const mini = readPlan('| DP-9.2-01 | 5.3 | Status: a pick of the business\'s own list | pick | | | |');
  const run = code => scanSources({ files: [{ path: 'src/x.tsx', code }], plan: mini, built: ['5.3'], routes: new Set(['/']) });
  it('a label read from the list (a value in the markup) passes; the same words typed into the markup or into code are caught', () => {
    const data = `export const A = ({ lists }) => (<select data-plan="DP-9.2-01" onChange={() => 1}>{lists.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}</select>);`;
    expect(run(data).filter(p => p.rule !== 'PLAN-3')).toEqual([]);
    const typedInMarkup = `export const A = () => (<select data-plan="DP-9.2-01" onChange={() => 1}><option value="x">Not contacted yet</option></select>);`;
    expect(run(typedInMarkup).map(p => p.rule)).toContain('PLAN-4');
    const typedInCode = `export const label = 'Not contacted yet';`;
    expect(run(typedInCode).map(p => p.rule)).toContain('PLAN-5');
  });
  it('the real source: planting the owner\'s words in the panel turns the gate red, so the labels there can only be data (watched red)', () => {
    const problems = scanReal(patch('src/pages/LeadPanel.tsx', 'const NOTE_MAX = 2000;', "const label = 'Not contacted yet';\nconst NOTE_MAX = 2000;"));
    const hit = problems.find(p => p.rule === 'PLAN-5' && p.message.includes('Not contacted yet'));
    console.log(`MUTANT status-word-in-code: ${hit ? `RED  ${hit.rule} ${hit.file}:${hit.line} ${hit.message}` : 'STAYED GREEN'}`);
    expect(hit, 'a status word written in code must be a PLAN-5').toBeTruthy();
  });
});
