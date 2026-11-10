import { useId, useMemo, useState, type ChangeEvent } from 'react';
import { Link, useParams } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { importLeads, proposeMap, saveTemplate } from '../api';
import { useLeadColumns, useMe } from '../data';
import { CORE_COLUMNS } from '../lib/crm';
import {
  changePair, crmSlug, fieldChoices, fileTooBig, flattenSample, matchWords, pairsFromProposal, sampleHeads, templateColumns, type Pair, type Proposal, type Report,
} from '../lib/importmap';
import { CallFailed } from '../lib/problems';
import { t } from '../plan';
import { useWorkspaceValue } from '../workspace-context';
import { NotFound } from './NotFound';
import css from './Crm.module.css';

const TOO_BIG = t('DP-1.3-43', 'This file is over 1 MB. Export fewer leads and choose it again.');
const CANNOT_READ = t('DP-1.3-43', 'Could not read this file. Try again.');
const NAME_TAKEN = t('DP-1.3-45', 'Another layout already has that name. Choose another name.');
const SAVE_FAILED = t('DP-1.3-45', 'Could not save. Try again.');
const CHECK_FAILED = t('DP-1.3-46', 'Could not check the file. Try again.');
const NOT_TICKED = t('DP-1.3-48', 'Tick this to confirm the people agreed to be contacted.');
const IMPORT_FAILED = t('DP-1.3-49', 'Could not import. Nothing was saved. Try again.');

const said = (e: unknown, fallback: string): string => (e instanceof CallFailed && e.problem.plain ? e.problem.message : fallback);

/**
 * Import leads (DP-1.3-41 to -50, owner only): the client's own CRM file in three steps. The file -> how its columns match ours (crm-map-propose, the
 * owner may change any pair) -> the CRM's name and Save these matches (crm-template-save) -> Check the file (a dry run: rows, duplicates, refusals,
 * the first 20 rows as stored; nothing written) -> Skip or Add duplicates, the consent tick, Import (all or nothing). A member never gets here.
 */
export function ImportLeads() {
  const { ws } = useParams({ from: '/authed/w/$ws' });
  const { workspace, userId } = useWorkspaceValue();
  const qc = useQueryClient();
  const base = useId();
  const me = useMe(workspace.id, userId);
  const cols = useLeadColumns(workspace.id);

  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [fileError, setFileError] = useState('');
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [pairs, setPairs] = useState<Pair[]>([]);
  const [crmName, setCrmName] = useState('');
  const [saving, setSaving] = useState(false);
  const [nameError, setNameError] = useState('');
  const [template, setTemplate] = useState('');
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState('');
  const [report, setReport] = useState<Report | null>(null);
  const [duplicates, setDuplicates] = useState<'skip' | 'add'>('skip');
  const [consent, setConsent] = useState(false);
  const [consentError, setConsentError] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState('');
  const [done, setDone] = useState<{ created: number; skipped: number } | null>(null);

  const choices = useMemo(() => fieldChoices(cols.data?.fields ?? []), [cols.data?.fields]);
  const labelOf = (key: string) => CORE_COLUMNS.find(c => c.key === key)?.label ?? cols.data?.fields.find(f => f.key === key)?.label ?? key;

  if (me.isLoading) return <p data-plan="DP-1.2s-10">Loading</p>;
  if (!me.data || me.data.role === 'member') return <NotFound />;

  function startAgain() {
    setFile(null); setFileError(''); setProposal(null); setPairs([]); setCrmName(''); setNameError(''); setTemplate('');
    setReport(null); setCheckError(''); setDuplicates('skip'); setConsent(false); setConsentError(false); setImportError(''); setDone(null);
  }

  async function choose(e: ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0];
    e.target.value = '';
    if (!picked) return;
    startAgain();
    if (fileTooBig(picked.size)) { setFileError(TOO_BIG); return; }
    try {
      const text = await picked.text();
      const p = await proposeMap(workspace.id, text);
      setFile({ name: picked.name, text });
      setProposal(p);
      setPairs(pairsFromProposal(p));
    } catch (err) {
      setFileError(said(err, CANNOT_READ));
    }
  }

  async function save() {
    if (!proposal || !crmName.trim() || saving) return;
    setSaving(true);
    setNameError('');
    try {
      const id = await saveTemplate({ workspace: workspace.id, name: crmName.trim(), crm: crmSlug(crmName), columns: templateColumns(pairs), value_maps: proposal.template.value_maps });
      setTemplate(id);
      setReport(null);
      void qc.invalidateQueries({ queryKey: ['templates', workspace.id] });
    } catch (err) {
      setNameError(err instanceof CallFailed && err.problem.status === 409 ? NAME_TAKEN : said(err, SAVE_FAILED));
    } finally {
      setSaving(false);
    }
  }

  async function check() {
    if (!file || !template || checking) return;
    setChecking(true);
    setCheckError('');
    try {
      setReport(await importLeads({ workspace: workspace.id, template, file: file.text, file_name: file.name, dry_run: true }));
      setConsentError(false);
    } catch (err) {
      setReport(null);
      setCheckError(said(err, CHECK_FAILED));
    } finally {
      setChecking(false);
    }
  }

  async function run() {
    if (!file || !template || !report || importing) return;
    if (!consent) { setConsentError(true); return; }
    setImporting(true);
    setImportError('');
    try {
      const out = await importLeads({ workspace: workspace.id, template, file: file.text, file_name: file.name, dry_run: false, duplicates, consent: true });
      void qc.invalidateQueries({ queryKey: ['leadlist', workspace.id] });
      void qc.invalidateQueries({ queryKey: ['leadcounts', workspace.id] });
      void qc.invalidateQueries({ queryKey: ['leads', workspace.id] });
      setDone({ created: out.created ?? 0, skipped: out.skipped ?? 0 });
    } catch (err) {
      setImportError(err instanceof CallFailed && err.problem.plain ? `${err.problem.message} ${t('DP-1.3-49', 'Nothing was saved.')}` : IMPORT_FAILED);
    } finally {
      setImporting(false);
    }
  }

  const sample = (report?.sample ?? []).map(flattenSample);
  const heads = sampleHeads(sample);
  const toAdd = report ? (duplicates === 'add' ? report.valid : report.new) : 0;
  const unused = pairs.filter(p => !p.field).map(p => p.header);

  return (
    <section className={css.import}>
      <div data-plan="DP-1.3-42" className={css.step}>
        <h1>Import leads</h1>
        <p>Upload the file your CRM exports. Nothing is saved until you have checked it and confirmed.</p>
        <p><Link to="/w/$ws/leads" params={{ ws }} search={prev => prev}>Back to leads</Link></p>
      </div>

      {done && (
        <div data-plan="DP-1.3-49" className={css.step} role="status">
          <p>{t('DP-1.3-49', 'Imported')} {done.created} {t('DP-1.3-49', 'leads.')}{done.skipped > 0 && <> {t('DP-1.3-49', 'Skipped')} {done.skipped} {t('DP-1.3-49', 'duplicates.')}</>}</p>
          <p><Link to="/w/$ws/leads" params={{ ws }} search={prev => prev}>See the leads</Link></p>
        </div>
      )}

      {!done && (
        <>
          <div data-plan="DP-1.3-43" className={css.step}>
            <label>
              Your CRM's export file (CSV, at most 1 MB)
              <input type="file" name="crm-file" accept=".csv,text/csv" onChange={e => void choose(e)} />
            </label>
            {fileError && <p role="alert">{fileError}</p>}
          </div>

          {proposal && (
            <>
              <div data-plan="DP-1.3-44" className={css.step}>
                <h2>How your columns match ours</h2>
                <ul>
                  {pairs.map((p, i) => (
                    <li key={`${p.header}-${i}`}>
                      <label htmlFor={`${base}-map-${i}`}>{p.header}</label>{' '}
                      <select id={`${base}-map-${i}`} name={`map-${i}`} value={p.field} onChange={e => setPairs(changePair(pairs, i, e.target.value))}>
                        <option value="">{t('DP-1.3-44', 'Do not import this column')}</option>
                        {choices.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
                      </select>{' '}
                      <span>{matchWords(p.score)}</span>
                    </li>
                  ))}
                </ul>
                {unused.length > 0 && <p>{t('DP-1.3-44', 'Not used:')} {unused.join(', ')}</p>}
                {proposal.warnings.length > 0 && <ul>{proposal.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>}
              </div>

              <div data-plan="DP-1.3-45" className={css.step}>
                <label>
                  Name of your CRM
                  <input type="text" name="crm-name" value={crmName} onChange={e => setCrmName(e.target.value)} />
                </label>
                <button type="button" disabled={!crmName.trim() || saving} onClick={() => void save()}>Save these matches</button>
                {template && <p role="status">Saved.</p>}
                {nameError && <p role="alert">{nameError}</p>}
              </div>

              {template && (
                <div data-plan="DP-1.3-46" className={css.step}>
                  <button type="button" disabled={checking} onClick={() => void check()}>Check the file</button>
                  {checkError && <p role="alert">{checkError}</p>}
                  {report && (
                    <>
                      <ul>
                        <li>{report.rows} {t('DP-1.3-46', 'rows in the file')}</li>
                        <li>{report.new} {t('DP-1.3-46', 'will be added')}</li>
                        <li>{report.refused_count} {t('DP-1.3-46', 'are refused')}</li>
                        <li>{report.duplicates_count} {t('DP-1.3-46', 'look like leads you already have')}</li>
                      </ul>
                      {heads.length > 0 && (
                        <>
                          <h2>The first 20 rows as they will be saved</h2>
                          <div className={css.scroll}>
                            <table className={css.pairs}>
                              <thead><tr>{heads.map(h => <th key={h} scope="col">{h === 'line' ? t('DP-1.3-46', 'Line') : labelOf(h)}</th>)}</tr></thead>
                              <tbody>{sample.map((r, i) => <tr key={i}>{heads.map(h => <td key={h}>{r[h] ?? ''}</td>)}</tr>)}</tbody>
                            </table>
                          </div>
                        </>
                      )}
                      {report.refused.length > 0 && (
                        <ul role="alert">
                          {report.refused.map((r, i) => <li key={i}>{r.line !== null && <>{t('DP-1.3-46', 'Line')} {r.line}{r.field ? ',' : ''} </>}{r.field}: {r.reason}</li>)}
                        </ul>
                      )}
                      {report.duplicates.length > 0 && (
                        <ul>
                          {report.duplicates.map((d, i) => <li key={i}>{t('DP-1.3-46', 'Line')} {d.line} {t('DP-1.3-46', 'has the same')} {d.by} {t('DP-1.3-46', 'as')} {d.with}</li>)}
                        </ul>
                      )}
                      {report.warnings.length > 0 && (
                        <ul>
                          {report.warnings.map((w, i) => <li key={i}>{w.line !== null && <>{t('DP-1.3-46', 'Line')} {w.line}{w.field ? ',' : ''} </>}{w.field}{w.field ? ': ' : ''}{w.reason}</li>)}
                        </ul>
                      )}
                    </>
                  )}
                </div>
              )}

              {report && report.duplicates_count > 0 && (
                <fieldset data-plan="DP-1.3-47" className={css.step}>
                  <label><input type="radio" name="duplicates" checked={duplicates === 'skip'} onChange={() => setDuplicates('skip')} />Skip them</label>
                  <label><input type="radio" name="duplicates" checked={duplicates === 'add'} onChange={() => setDuplicates('add')} />Add them anyway</label>
                </fieldset>
              )}

              {report && (
                <>
                  <div data-plan="DP-1.3-48" className={css.step}>
                    <label>
                      <input type="checkbox" name="consent" checked={consent} onChange={e => { setConsent(e.target.checked); setConsentError(false); }} />
                      These people agreed to be contacted by my business
                    </label>
                    {consentError && <p role="alert">{NOT_TICKED}</p>}
                  </div>
                  <div data-plan="DP-1.3-49" className={css.step}>
                    <button type="button" disabled={importing || report.refused_count > 0} onClick={() => void run()}>{t('DP-1.3-49', 'Import')} {toAdd} {t('DP-1.3-49', 'leads')}</button>
                    {report.refused_count > 0 && <p>Fix the lines above in your file, then choose it again.</p>}
                    {importError && <p role="alert">{importError}</p>}
                  </div>
                </>
              )}
            </>
          )}

          {proposal && (
            <p data-plan="DP-1.3-50"><button type="button" onClick={startAgain}>Choose another file</button></p>
          )}
        </>
      )}
    </section>
  );
}
