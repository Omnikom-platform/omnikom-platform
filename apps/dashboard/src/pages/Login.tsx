import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { supabase } from '../supabase';
import { useSession } from '../auth';
import { t } from '../plan';
import css from './Login.module.css';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const RESEND_AFTER_MS = 60_000;   // DP-1.2-03: "after 60 s"

/** True when the answer means the mail was not sent for a reason on our side (the service is down or limiting); anything else looks the same to the person. */
const sendFailed = (e: { name?: string; status?: number } | null) => Boolean(e && (e.name === 'AuthRetryableFetchError' || !e.status || e.status === 429 || e.status >= 500));

/** Sign in (DP-1.2-01 to -06): email and one button; a password is the small second way. No sign-up, no account discovery. */
export function Login({ expired = false, ended = false }: { expired?: boolean; ended?: boolean }) {
  const nav = useNavigate();
  const { session } = useSession();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState<'link' | 'password'>('link');
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [canResend, setCanResend] = useState(false);
  const [busy, setBusy] = useState(false);
  const [emailError, setEmailError] = useState(false);
  const [sendError, setSendError] = useState(false);
  const [passwordError, setPasswordError] = useState(false);

  useEffect(() => { document.title = t('DP-1.2s-09', 'Sign in'); }, []);
  useEffect(() => { if (session) void nav({ to: '/w', replace: true }); }, [session, nav]);
  useEffect(() => {
    if (sentAt === null) return;
    setCanResend(false);
    const timer = window.setTimeout(() => setCanResend(true), RESEND_AFTER_MS);
    return () => window.clearTimeout(timer);
  }, [sentAt]);

  async function sendLink(e?: FormEvent) {
    e?.preventDefault();
    setSendError(false);
    if (!EMAIL.test(email.trim())) { setEmailError(true); return; }
    setEmailError(false);
    setBusy(true);
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { shouldCreateUser: false, emailRedirectTo: `${window.location.origin}/auth/confirm` },
    });
    setBusy(false);
    // The same card whatever the answer about the address (an unknown address looks like a sent mail): the page must not say who has an account.
    if (sendFailed(error)) setSendError(true);
    else setSentAt(Date.now());
  }

  async function withPassword(e: FormEvent) {
    e.preventDefault();
    setPasswordError(false);
    if (!EMAIL.test(email.trim())) { setEmailError(true); return; }
    setEmailError(false);
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (error) setPasswordError(true);
    // on success onAuthStateChange gives the session and the effect above moves on
  }

  const emailField = (
    <>
      <label data-plan="DP-1.2-01">
        Email
        <input type="email" name="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} />
      </label>
      {emailError && <p role="alert" data-plan="DP-1.2-01">Enter an email like name@example.com</p>}
    </>
  );

  return (
    <main className={css.page}>
      <div className={css.card} data-card="">
      <h1 data-plan="DP-1.2s-09">Sign in</h1>
      {expired && <p role="alert" data-plan="DP-1.2-06">That link expired. Send a new one.</p>}
      {ended && <p role="alert" data-plan="DP-1.2-13">You were signed out. Sign in again.</p>}
      {sentAt !== null ? (
        <>
          <p role="status" data-plan="DP-1.2-02">Check your email. The link works for 10 minutes.</p>
          <button type="button" data-plan="DP-1.2-03" disabled={!canResend || busy} onClick={() => void sendLink()}>{busy ? t('DP-1.2s-10', 'Sending') : 'Send it again'}</button>
          {sendError && <p role="alert" data-plan="DP-1.2-02">We could not send the email. Try again in a minute.</p>}
        </>
      ) : mode === 'link' ? (
        <form data-plan="DP-1.2-02" onSubmit={e => void sendLink(e)} noValidate>
          {emailField}
          <button type="submit" data-plan="DP-1.2-02" disabled={busy} className={css.go}>{busy ? t('DP-1.2s-10', 'Sending') : 'Send me a sign-in link'}</button>
          {sendError && <p role="alert" data-plan="DP-1.2-02">We could not send the email. Try again in a minute.</p>}
          <button type="button" data-plan="DP-1.2-04" className={css.quiet} onClick={() => { setMode('password'); setSendError(false); }}>Use a password instead</button>
        </form>
      ) : (
        <form data-plan="DP-1.2-05" onSubmit={e => void withPassword(e)} noValidate>
          {emailField}
          <label data-plan="DP-1.2-05">
            Password
            <input type="password" name="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} />
          </label>
          <button type="submit" data-plan="DP-1.2-05" disabled={busy} className={css.go}>{busy ? t('DP-1.2s-10', 'Sending') : 'Sign in'}</button>
          {passwordError && <p role="alert" data-plan="DP-1.2-05">Email or password is wrong.</p>}
        </form>
      )}
      </div>
    </main>
  );
}
