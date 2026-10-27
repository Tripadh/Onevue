/* =========================================================================
   OneVue — Onboarding Survey Page
   Domain: Authentication / Onboarding
   Route: /onboarding/survey
   ========================================================================= */

const { useState: surState, useEffect: surEffect } = React;

const DISCOVERY_OPTIONS = [
  { id: 'google_search', label: 'Google Search', icon: '🔍' },
  { id: 'instagram', label: 'Instagram', icon: '📸' },
  { id: 'youtube', label: 'YouTube', icon: '▶️' },
  { id: 'linkedin', label: 'LinkedIn', icon: '💼' },
  { id: 'facebook', label: 'Facebook', icon: '👥' },
  { id: 'x_twitter', label: 'X (Twitter)', icon: '𝕏' },
  { id: 'reddit', label: 'Reddit', icon: '🤖' },
  { id: 'friend_family', label: 'Friend or Family', icon: '🤝' },
  { id: 'college_university', label: 'College or University', icon: '🎓' },
  { id: 'online_advertisement', label: 'Online Advertisement', icon: '📢' },
  { id: 'blog_article', label: 'Blog or Online Article', icon: '📝' },
  { id: 'developer_community', label: 'Developer or Online Community', icon: '💻' },
  { id: 'other', label: 'Other', icon: '✨' },
];

function SurveyOnboardingPage() {
  const session = useSession();
  const navigate = ReactRouterDOM.useNavigate();
  const toast = useToast();

  const [selectedSource, setSelectedSource] = surState('');
  const [otherDetails, setOtherDetails] = surState('');
  const [saving, setSaving] = surState(false);
  const [error, setError] = surState('');

  // Routing guard: Ensure user is logged in, has identity, and hasn't already completed survey
  surEffect(() => {
    if (!session) {
      navigate('/');
    } else if (!session.user?.identity) {
      // Must select identity first
      navigate('/onboarding/identity', { replace: true });
    } else if (session.user?.onboarding?.surveyCompleted) {
      // Already completed survey: route directly to role dashboard
      navigate(resolveDashboardRoute(session.user.identity), { replace: true });
    }
  }, [session, navigate]);

  const handleSubmit = async (e) => {
    if (e) e.preventDefault();

    if (!selectedSource) {
      setError('Please select how you discovered OneVue.');
      return;
    }

    if (selectedSource === 'other' && !otherDetails.trim()) {
      setError('Please tell us where you discovered OneVue.');
      return;
    }

    setError('');
    setSaving(true);

    try {
      const payload = {
        discoverySource: selectedSource,
        otherDetails: selectedSource === 'other' ? otherDetails.trim() : null,
      };

      const updatedSession = await window.OV.services.auth.submitSurvey(payload);

      toast.push({
        title: 'Thank you!',
        body: 'Your response was saved. Welcome to your OneVue dashboard.',
        tone: 'success',
      });

      // Authoritatively route to their role dashboard
      const targetIdentity = updatedSession?.user?.identity || session.user?.identity;
      const destination = String(targetIdentity || '').toLowerCase() === 'student'
        ? '/app/student/identity'
        : resolveDashboardRoute(targetIdentity);
      navigate(destination, { replace: true });
    } catch (err) {
      setError(err.message || 'Failed to save your response. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <main id="main" className="wrap" style={{ paddingTop: 90, paddingBottom: 100, minHeight: '85vh', display: 'grid', placeItems: 'center' }}>
      <div style={{ maxWidth: 860, width: '100%', display: 'grid', gap: 32 }}>

        {/* Page Heading & Supporting Copy */}
        <div style={{ textAlign: 'center', display: 'grid', gap: 12 }}>
          <span className="eyebrow" style={{ color: 'var(--accent)', letterSpacing: '.14em', textTransform: 'uppercase', fontSize: 13, fontWeight: 600 }}>
            Step 3 of 3 • Community Survey
          </span>
          <h1 className="h-card" style={{ fontSize: 'clamp(28px, 4vw, 42px)', margin: 0 }}>
            How did you discover OneVue?
          </h1>
          <p className="muted" style={{ fontSize: 16, maxWidth: 620, margin: '0 auto', lineHeight: 1.55 }}>
            We'd love to know how you found us. Your answer helps us understand how people discover OneVue and improve the platform.
          </p>
        </div>

        {/* Options Card Grid (Single Choice) */}
        <div
          role="radiogroup"
          aria-label="How did you hear about OneVue?"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
            gap: 14,
          }}
        >
          {DISCOVERY_OPTIONS.map((opt) => {
            const isSelected = selectedSource === opt.id;
            return (
              <div
                key={opt.id}
                role="radio"
                aria-checked={isSelected}
                tabIndex={0}
                onClick={() => {
                  setSelectedSource(opt.id);
                  if (error) setError('');
                }}
                onKeyDown={(e) => {
                  if (e.key === ' ' || e.key === 'Enter') {
                    e.preventDefault();
                    setSelectedSource(opt.id);
                    if (error) setError('');
                  }
                }}
                className={'glass ' + (isSelected ? 'is-selected' : '')}
                style={{
                  padding: '16px 20px',
                  borderRadius: 16,
                  cursor: 'pointer',
                  border: isSelected ? '2px solid var(--accent)' : '1px solid var(--line)',
                  background: isSelected
                    ? 'color-mix(in oklab, var(--accent) 14%, var(--glass))'
                    : 'var(--glass)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  transition: 'all .2s ease',
                  boxShadow: isSelected
                    ? '0 8px 24px -6px color-mix(in oklab, var(--accent) 35%, transparent)'
                    : 'none',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <span style={{ fontSize: 20 }}>{opt.icon}</span>
                  <span
                    style={{
                      fontSize: 14.5,
                      fontWeight: isSelected ? 600 : 500,
                      color: isSelected ? 'var(--text-1)' : 'var(--text-2)',
                    }}
                  >
                    {opt.label}
                  </span>
                </div>

                {/* Radio Indicator */}
                <div
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: '50%',
                    border: isSelected ? '6px solid var(--accent)' : '2px solid var(--line-hi)',
                    background: isSelected ? '#fff' : 'transparent',
                    flex: 'none',
                    transition: 'all .2s ease',
                  }}
                />
              </div>
            );
          })}
        </div>

        {/* Question 2: Conditional "Other" Details Field */}
        {selectedSource === 'other' && (
          <div
            className="glass"
            style={{
              padding: 24,
              borderRadius: 20,
              display: 'grid',
              gap: 10,
              border: '1px solid var(--line-hi)',
              animation: 'fadeIn .25s ease',
            }}
          >
            <label
              htmlFor="other-details-input"
              className="field-label"
              style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-1)' }}
            >
              Please tell us where you discovered OneVue.
            </label>
            <input
              id="other-details-input"
              className="input"
              placeholder="e.g. Podcast, conference, newsletter..."
              maxLength={500}
              value={otherDetails}
              onChange={(e) => {
                setOtherDetails(e.target.value);
                if (error) setError('');
              }}
              style={{ width: '100%' }}
              autoFocus
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="field-hint" style={{ fontSize: 12 }}>
                Be as specific as you like.
              </span>
              <span className="faint mono" style={{ fontSize: 12 }}>
                {otherDetails.length}/500
              </span>
            </div>
          </div>
        )}

        {/* Validation Error Banner */}
        {error && (
          <p
            className="field-error"
            role="alert"
            style={{
              textAlign: 'center',
              margin: 0,
              padding: '10px 16px',
              borderRadius: 12,
              background: 'color-mix(in oklab, #ef4444 12%, transparent)',
            }}
          >
            {error}
          </p>
        )}

        {/* Action Button */}
        <div style={{ display: 'grid', placeItems: 'center', gap: 14 }}>
          <Button
            size="lg"
            variant="accent"
            loading={saving}
            disabled={!selectedSource || saving}
            onClick={handleSubmit}
            style={{ minWidth: 260 }}
          >
            Continue to Dashboard →
          </Button>
          <p className="faint" style={{ fontSize: 13, margin: 0 }}>
            Saved to your OneVue account. Redirects to your role-specific dashboard.
          </p>
        </div>

      </div>
    </main>
  );
}

window.SurveyOnboardingPage = SurveyOnboardingPage;
