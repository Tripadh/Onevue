/* =========================================================================
   OneVue — Post-Signup Identity Selection Page
   Domain: Authentication / Onboarding
   Route: /onboarding/identity
   ========================================================================= */

const { useState: obState, useEffect: obEffect } = React;

function IdentityOnboardingPage() {
  const session = useSession();
  const navigate = ReactRouterDOM.useNavigate();
  const toast = useToast();
  const [selected, setSelected] = obState('');
  const [saving, setSaving] = obState(false);
  const [error, setError] = obState('');

  obEffect(() => {
    if (!session) {
      navigate('/');
    } else if (session.user?.identity) {
      // If identity is already established, check if survey is completed
      if (session.user?.onboarding?.surveyCompleted) {
        navigate(resolveDashboardRoute(session.user.identity), { replace: true });
      } else {
        navigate('/onboarding/survey', { replace: true });
      }
    }
  }, [session, navigate]);

  const confirmIdentity = async () => {
    if (!selected) {
      setError('Please select an identity domain to continue.');
      return;
    }
    setError('');
    setSaving(true);
    try {
      await window.OV.services.auth.setIdentity(selected);
      toast.push({
        title: 'Identity Confirmed',
        body: `Your domain is set to ${selected.toUpperCase()}. Next: one quick question!`,
        tone: 'success',
      });
      // Route immediately to the new survey page
      navigate('/onboarding/survey', { replace: true });
    } catch (err) {
      setError(err.message || 'Failed to save identity. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const options = window.IDENTITY_OPTIONS || [
    { id: 'student', title: 'Student', desc: 'For students building an academic profile, showcasing projects, listing skills, and presenting certifications.', glyph: 'I', badge: 'Academic' },
    { id: 'professional', title: 'Professional', desc: 'For working professionals presenting work experience, qualifications, career achievements, and professional skills.', glyph: 'II', badge: 'Career' },
    { id: 'freelancer', title: 'Freelancer', desc: 'For independent professionals presenting services, pricing, portfolios, and client-facing information.', glyph: 'III', badge: 'Services' },
    { id: 'creator', title: 'Creator', desc: 'For creators showcasing content, social links, featured work, and collaborations.', glyph: 'IV', badge: 'Media' },
    { id: 'business', title: 'Business', desc: 'For companies presenting their organization, services, branding, business credentials, and contact details.', glyph: 'V', badge: 'Company' },
  ];

  return (
    <main id="main" className="wrap" style={{ paddingTop: 100, paddingBottom: 100, minHeight: '85vh', display: 'grid', placeItems: 'center' }}>
      <div style={{ maxWidth: 840, width: '100%', display: 'grid', gap: 32 }}>

        {/* Header */}
        <div style={{ textAlign: 'center', display: 'grid', gap: 12 }}>
          <span className="eyebrow" style={{ color: 'var(--accent)', letterSpacing: '.14em', textTransform: 'uppercase', fontSize: 13, fontWeight: 600 }}>Step 2 of 3 • Domain Setup</span>
          <h1 className="h-card" style={{ fontSize: 'clamp(28px, 4vw, 42px)', margin: 0 }}>Select your identity</h1>
          <p className="muted" style={{ fontSize: 16, maxWidth: 560, margin: '0 auto' }}>
            Choose the path that fits where you are. This customizes your dashboard, available templates, and audiences.
          </p>
        </div>

        {/* 5 Options Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
          {options.map(opt => {
            const isSel = selected === opt.id;
            return (
              <div
                key={opt.id}
                role="radio"
                aria-checked={isSel}
                tabIndex={0}
                onClick={() => setSelected(opt.id)}
                onKeyDown={e => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); setSelected(opt.id); } }}
                className={'glass ' + (isSel ? 'is-selected' : '')}
                style={{
                  padding: '24px 22px',
                  borderRadius: 20,
                  cursor: 'pointer',
                  border: isSel ? '2px solid var(--accent)' : '1px solid var(--line)',
                  background: isSel ? 'color-mix(in oklab, var(--accent) 14%, var(--glass))' : 'var(--glass)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 14,
                  position: 'relative',
                  transition: 'all .25s ease',
                  boxShadow: isSel ? '0 12px 30px -10px color-mix(in oklab, var(--accent) 40%, transparent)' : 'none',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span className="serif" style={{ fontSize: 24, color: isSel ? 'var(--accent)' : 'var(--text-2)' }}>
                    {opt.glyph}
                  </span>
                  <span className="badge" style={{ fontSize: 11, height: 20 }}>{opt.badge}</span>
                </div>

                <div>
                  <h3 className="h-card" style={{ fontSize: 20, margin: '0 0 6px' }}>{opt.title}</h3>
                  <p className="muted" style={{ fontSize: 13, margin: 0, lineHeight: 1.45 }}>{opt.desc}</p>
                </div>

                <div style={{ marginTop: 'auto', paddingTop: 10, display: 'flex', justifyContent: 'flex-end' }}>
                  <div
                    style={{
                      width: 22,
                      height: 22,
                      borderRadius: '50%',
                      border: isSel ? '6px solid var(--accent)' : '2px solid var(--line-hi)',
                      background: isSel ? '#fff' : 'transparent',
                      transition: 'all .2s ease',
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* Error message */}
        {error && (
          <p className="field-error" role="alert" style={{ textAlign: 'center', margin: 0 }}>
            {error}
          </p>
        )}

        {/* Confirm Button */}
        <div style={{ display: 'grid', placeItems: 'center', gap: 14 }}>
          <Button
            size="lg"
            variant="accent"
            loading={saving}
            disabled={!selected}
            onClick={confirmIdentity}
            style={{ minWidth: 260 }}
          >
            Continue to Survey →
          </Button>
          <p className="faint" style={{ fontSize: 13, margin: 0 }}>
            You can always customize your sections and audience views later.
          </p>
        </div>

      </div>
    </main>
  );
}

window.IdentityOnboardingPage = IdentityOnboardingPage;
