/* Hooks and Router bindings */
const { useState: sUseState, useEffect: sUseEffect, useMemo: sUseMemo, useRef: sUseRef, useCallback: sUseCallback } = React;
const { useLocation: sUseLocation, useNavigate: sUseNavigate, Link: sLink } = ReactRouterDOM;
const getPrimaryEducation = window.getPrimaryEducation || (() => null);

function StudentVisitingCardPage({ session, studentProfile }) {
  const toast = useToast();
  const publicUrl = session?.user?.username ? `onevue.id/${session.user.username}` : 'onevue.id/student.demo';
  const primaryEdu = getPrimaryEducation(studentProfile);

  return (
    <div style={{ display: 'grid', gap: 28, maxWidth: 840 }}>
      <div>
        <span className="eyebrow" style={{ color: 'var(--accent)', fontSize: 12 }}>Digital Identity Card</span>
        <h1 className="h-card" style={{ fontSize: 32, margin: '4px 0 6px' }}>Student Visiting Card</h1>
        <p className="muted" style={{ fontSize: 15, margin: 0 }}>
          Designed for quick scanning and exchange at academic conferences, campus hackathons, and recruiter fairs.
        </p>
      </div>

      <div
        className="glass"
        style={{
          padding: 32,
          borderRadius: 24,
          background: 'linear-gradient(135deg, color-mix(in oklab, var(--bg-1) 85%, transparent), color-mix(in oklab, var(--bg-2) 90%, transparent))',
          border: '1.5px solid var(--line-hi)',
          display: 'grid',
          gap: 24,
          boxShadow: '0 20px 48px -12px var(--shade)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
          <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
            <Avatar initials={(session?.user?.name || 'S').slice(0, 2).toUpperCase()} size={60} ring />
            <div>
              <h2 className="h-card" style={{ fontSize: 26, margin: 0 }}>{session?.user?.name || 'Student'}</h2>
              <p className="muted" style={{ fontSize: 14, margin: '4px 0 0' }}>
                {studentProfile?.headline ? (
                  `${studentProfile.headline}${primaryEdu?.institution ? ' • ' + primaryEdu.institution : ''}`
                ) : (
                  primaryEdu?.institution || 'Student'
                )}
              </p>
              <span className="badge badge-verified" style={{ marginTop: 8 }}>
                <Icon.seal width="12" height="12" /> Verified Student ID
              </span>
            </div>
          </div>

          <div
            style={{
              padding: 12,
              borderRadius: 14,
              background: '#FFFFFF',
              color: '#050A1A',
              display: 'grid',
              placeItems: 'center',
              boxShadow: '0 8px 24px -4px rgba(0,0,0,0.3)',
            }}
          >
            <div style={{ width: 68, height: 68, display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 2 }}>
              {Array.from({ length: 25 }).map((_, i) => (
                <div
                  key={i}
                  style={{
                    background: (i % 2 === 0 || i % 3 === 0) ? '#050A1A' : '#FFFFFF',
                    borderRadius: 1.5,
                  }}
                />
              ))}
            </div>
          </div>
        </div>

        <div style={{ borderTop: '1px solid var(--line)', paddingTop: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <span className="mono" style={{ fontSize: 13.5, color: 'var(--text-1)' }}>
            https://{publicUrl}
          </span>
          <div style={{ display: 'flex', gap: 10 }}>
            <Button
              size="sm"
              variant="glass"
              icon={<Icon.copy />}
              onClick={async () => {
                await copyText('https://' + publicUrl);
                toast.push({ title: 'Card link copied', tone: 'success' });
              }}
            >
              Copy Link
            </Button>
            <Button
              size="sm"
              variant="accent"
              onClick={() => toast.push({ title: 'vCard export ready', tone: 'info' })}
            >
              Export vCard
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

window.StudentVisitingCardPage = StudentVisitingCardPage;
