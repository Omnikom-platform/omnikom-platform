import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { addLead } from '../api';
import { CallFailed } from '../lib/problems';
import { useContractForms, useMe, useSites, useTeam } from '../data';
import { useWorkspaceValue } from '../workspace-context';
import { activeSiteId, storedSite } from '../site-choice';
import { t } from '../plan';
import { useToast } from '../toast';
import { PanelClose } from './LeadPanel';
import { useWide } from '../hooks';
import css from './Panel.module.css';

const REACHED = [t('DP-1.3b-04', 'Call'), t('DP-1.3b-04', 'Walk-in'), t('DP-1.3b-04', 'Referral'), t('DP-1.3b-04', 'Other')];
const OTHER = t('DP-1.3b-05', 'Other');
const CONSENT = t('DP-1.3b-07', 'The person agreed to be contacted');

/**
 * Entering a lead by hand (DP-1.3b-01 to -09): the short form in the panel. The consent tick is required and its sentence is stored as
 * the consent text. An agent's lead is always their own; the owner can pick an owner. "What about" comes from the workspace's contract.
 */
export function AddLead() {
  const { ws } = useParams({ from: '/authed/w/$ws' });
  const { workspace, userId } = useWorkspaceValue();
  const qc = useQueryClient();
  const nav = useNavigate();
  const toast = useToast();
  const me = useMe(workspace.id, userId);
  const team = useTeam(workspace.id);
  const sites = useSites(workspace.id);
  const Title = useWide() ? 'h2' : 'h1';
  const forms = useContractForms(workspace.id);

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [reached, setReached] = useState(REACHED[0] ?? '');
  const [about, setAbout] = useState('');
  const [notes, setNotes] = useState('');
  const [owner, setOwner] = useState('');
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [contactError, setContactError] = useState(false);
  const [consentError, setConsentError] = useState(false);
  const [error, setError] = useState('');

  const siteId = activeSiteId(sites.data ?? [], storedSite(userId, workspace.id));
  const aboutChoices = [...Object.entries(forms.data ?? {}).map(([slug, f]) => ({ value: slug, label: f.label || slug })), { value: 'other', label: OTHER }];
  const canPickOwner = me.data ? me.data.role !== 'member' : false;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!siteId || busy) return;
    setError('');
    const noContact = !name.trim() && !phone.trim() && !email.trim();
    setContactError(noContact);
    setConsentError(!consent);
    if (noContact || !consent) return;
    setBusy(true);
    try {
      const answers: Record<string, unknown> = { howDidTheyReachYou: reached, whatAbout: about || aboutChoices[0]?.value };
      if (notes.trim()) answers.notes = notes.trim();
      const id = await addLead({
        site: siteId,
        ...(name.trim() ? { name: name.trim() } : {}),
        ...(phone.trim() ? { phone: phone.trim() } : {}),
        ...(email.trim() ? { email: email.trim() } : {}),
        answers,
        consentText: CONSENT,
        ...(canPickOwner && owner ? { owner } : {}),
      });
      await qc.invalidateQueries({ queryKey: ['leads', workspace.id] });
      void qc.invalidateQueries({ queryKey: ['leadlist', workspace.id] });
      void qc.invalidateQueries({ queryKey: ['leadcounts', workspace.id] });
      toast(t('DP-1.3b-09', 'Lead added.'), { label: t('DP-1.3b-09', 'Open'), run: () => void nav({ to: '/w/$ws/leads/$id', params: { ws, id } }) });
      void nav({ to: '/w/$ws/leads', params: { ws } });
    } catch (err) {
      setError(err instanceof CallFailed && err.problem.plain ? err.problem.message : t('DP-1.3b-10', 'Could not save. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={css.panel}>
      <PanelClose />
      <Title data-plan="DP-1.3-04">Add a lead</Title>
      <form data-plan="DP-1.3b-09" onSubmit={e => void submit(e)} className={css.form}>
        <label data-plan="DP-1.3b-01">Name <input type="text" name="name" autoComplete="off" maxLength={120} value={name} onChange={e => setName(e.target.value)} /></label>
        <label data-plan="DP-1.3b-02">Phone <input type="tel" name="phone" autoComplete="off" maxLength={40} value={phone} onChange={e => setPhone(e.target.value)} /></label>
        <label data-plan="DP-1.3b-03">Email <input type="email" name="email" autoComplete="off" maxLength={320} value={email} onChange={e => setEmail(e.target.value)} /></label>
        {contactError && <p role="alert" data-plan="DP-1.3b-10">Enter a name, a phone or an email.</p>}
        <label data-plan="DP-1.3b-04">
          How did they reach you
          <select name="reachedBy" value={reached} onChange={e => setReached(e.target.value)}>
            {REACHED.map(label => <option key={label} value={label}>{label}</option>)}
          </select>
        </label>
        <label data-plan="DP-1.3b-05">
          What about
          <select name="about" value={about || aboutChoices[0]?.value} onChange={e => setAbout(e.target.value)}>
            {aboutChoices.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </label>
        <label data-plan="DP-1.3b-06">Notes <textarea name="notes" rows={3} maxLength={2000} value={notes} onChange={e => setNotes(e.target.value)} /></label>
        {canPickOwner && (
          <label data-plan="DP-1.3b-08">
            Owner
            <select name="owner" value={owner} onChange={e => setOwner(e.target.value)} data-empty={owner ? undefined : 'true'}>
              <option value="">Unassigned</option>
              {[...(team.data?.names ?? new Map<string, string>()).entries()].map(([tid, n]) => <option key={tid} value={tid}>{n}</option>)}
            </select>
          </label>
        )}
        <label data-plan="DP-1.3b-07">
          <input type="checkbox" name="consent" checked={consent} onChange={e => setConsent(e.target.checked)} />
          {CONSENT}
        </label>
        {consentError && <p role="alert" data-plan="DP-1.3b-10">Tick this to confirm the person agreed to be contacted.</p>}
        <button type="submit" data-plan="DP-1.3b-09" disabled={busy || !siteId} className={css.save}>{busy ? t('DP-1.2s-10', 'Saving') : 'Save'}</button>
        {error && <p role="alert" data-plan="DP-1.3b-10">{error}</p>}
      </form>
    </section>
  );
}
