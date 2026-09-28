import { useState } from 'react';
import { Building2, Landmark, UserRound } from 'lucide-react';
import { Persona, StaffDesk } from '../prototypeStore';
import { Disclaimer } from './Disclaimer';

export function PersonaLogin({ onLogin, signedIn }: { onLogin: (persona: Persona) => void; signedIn: boolean }) {
  const [mode, setMode] = useState<'applicant' | 'staff'>('applicant');
  const [key, setKey] = useState('');
  const [desk, setDesk] = useState<StaffDesk>('Economic Development');
  const [error, setError] = useState('');

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (mode === 'applicant') {
      const normalized = key.trim().toLowerCase();
      if (!normalized) {
        setError('Enter an applicant key or email to continue.');
        return;
      }
      onLogin({ kind: 'applicant', key: normalized });
    } else {
      onLogin({ kind: 'staff', desk });
    }
  }

  return (
    <div className="persona-page" data-testid="page-persona-login">
      <header className="topbar">
        <div className="brand"><div className="brand-mark"><Landmark size={19} /></div><div><div className="brand-name">Permit Navigator</div><div className="brand-sub">City of San José · Prototype</div></div></div>
      </header>
      <main className="persona-main">
        <div className="persona-intro">
          <span className="eyebrow">SAN JOSÉ · SMALL BUSINESS NAVIGATOR</span>
          <h1>Start with the right view.</h1>
          <p>Keep your permit planning in one place, or review submitted plans from a City staff desk.</p>
        </div>
        <form className="persona-card" onSubmit={submit}>
          <h2>Choose how to continue</h2>
          <p className="persona-muted">{signedIn ? 'Choose a prototype persona for this account.' : 'Choose a persona, then sign in to your account.'}</p>
          <div className="persona-options" role="group" aria-label="Login type">
            <button type="button" className={`persona-option ${mode === 'applicant' ? 'selected' : ''}`} aria-pressed={mode === 'applicant'} onClick={() => { setMode('applicant'); setError(''); }}><UserRound size={20} /><span><strong>Applicant</strong><small>Manage my action plans</small></span></button>
            <button type="button" className={`persona-option ${mode === 'staff' ? 'selected' : ''}`} aria-pressed={mode === 'staff'} onClick={() => { setMode('staff'); setError(''); }}><Building2 size={20} /><span><strong>City Staff</strong><small>Review submitted plans</small></span></button>
          </div>
          {mode === 'applicant' ? (
            <label className="persona-field">Applicant key or email
              <input value={key} onChange={e => { setKey(e.target.value); setError(''); }} autoComplete="username" placeholder="e.g. my-business@example.com" data-testid="input-applicant-key" />
            </label>
          ) : (
            <label className="persona-field">Staff department
              <select value={desk} onChange={e => setDesk(e.target.value as StaffDesk)} data-testid="select-staff-desk">
                <option>Economic Development</option>
                <option>Building Code Reviewer</option>
                <option>Fire Prevention</option>
              </select>
            </label>
          )}
          {error && <p className="persona-error" role="alert">{error}</p>}
          <button className="button-primary persona-submit" type="submit" data-testid="button-persona-login">
            {signedIn ? `Enter ${mode === 'applicant' ? 'Applicant Dashboard' : 'Staff Portal'}` : 'Continue to secure sign in'}
          </button>
          <p className="persona-caution">Prototype only: staff roles and applicant keys are self-selected, not verified City credentials. Plans are stored only in this browser. Do not enter sensitive information.</p>
        </form>
      </main>
      <section className="footer"><div className="footer-inner"><span>Permit Navigator · San José</span><Disclaimer /></div></section>
    </div>
  );
}