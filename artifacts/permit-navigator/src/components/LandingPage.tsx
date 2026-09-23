import { Landmark, ShieldCheck, Lightbulb, ClipboardCheck } from 'lucide-react';
import { useLocation, Link } from 'wouter';
import { Disclaimer } from './Disclaimer';

export function LandingPage({ signedIn }: { signedIn?: boolean }) {
  const [, setLocation] = useLocation();
  return (
    <div className="app-shell" style={{ display: 'flex', flexDirection: 'column', minHeight: '100dvh' }}>
      <header className="topbar">
        <Link href="/welcome" className="brand" data-testid="brand-permit-navigator" aria-label="Permit Navigator Home">
          <div className="brand-mark"><Landmark size={19} /></div>
          <div><div className="brand-name">Permit Navigator</div><div className="brand-sub">City of San José · Prototype</div></div>
        </Link>
        <div className="top-actions">
           {signedIn ? (
              <button className="button-primary" onClick={() => setLocation('/portal?view=action-plan')} data-testid="button-home-return" style={{ marginTop: 0, width: 'auto', padding: '6px 12px' }}>Return to Action Plan</button>
           ) : (
             <>
               <button className="button-tertiary" onClick={() => setLocation('/sign-in')} style={{ padding: '6px 12px' }} data-testid="button-home-signin">Sign In</button>
               <button className="button-primary" onClick={() => setLocation('/sign-up')} style={{ marginTop: 0, width: 'auto', padding: '6px 12px' }} data-testid="button-home-signup">Create Account</button>
             </>
           )}
        </div>
      </header>
      <div className="hero-wrap" style={{ flex: 1, display: 'flex', alignItems: 'center' }}>
        <main className="hero" style={{ gridTemplateColumns: '1fr', width: '100%', padding: '40px 5vw' }}>
          <div style={{ maxWidth: 700, margin: '0 auto', textAlign: 'center', position: 'relative', zIndex: 1 }}>
            <div className="eyebrow" style={{ justifyContent: 'center' }}>San José · Small business navigator</div>
            <h1 style={{ margin: '20px auto 23px' }}>A clearer first step for your new business.</h1>
            <p className="hero-intro" style={{ margin: '0 auto 24px' }}>Tell us a little about your project. We’ll organize possible city touchpoints into a practical plan you can review with City Staff.</p>
            <div className="hero-trust" style={{ justifyContent: 'center', marginBottom: 32 }}>
              <span className="trust-item"><ShieldCheck size={15} /> Built for first-time owners</span>
              <span className="trust-item"><Lightbulb size={15} /> Plain-language steps</span>
              <span className="trust-item"><ClipboardCheck size={15} /> City Staff review built in</span>
            </div>
            
            {signedIn ? (
              <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
                <button className="button-primary" onClick={() => setLocation('/portal?view=action-plan')} data-testid="button-home-return-hero" style={{ marginTop: 0, width: 'auto', padding: '12px 24px', fontSize: 15 }}>Return to Action Plan</button>
              </div>
            ) : (
              <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
                <button className="button-primary" onClick={() => setLocation('/sign-up')} data-testid="button-home-signup-hero" style={{ marginTop: 0, width: 'auto', padding: '12px 24px', fontSize: 15 }}>Create Account</button>
                <button className="button-secondary" onClick={() => setLocation('/sign-in')} data-testid="button-home-signin-hero" style={{ padding: '12px 24px', fontSize: 15 }}>Sign In</button>
              </div>
            )}
            
          </div>
        </main>
      </div>
      <section className="footer" style={{ marginTop: 'auto' }}><div className="footer-inner"><span>Permit Navigator · San José</span><Disclaimer /></div></section>
    </div>
  );
}