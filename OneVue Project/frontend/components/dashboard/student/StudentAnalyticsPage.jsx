/* Hooks and Router bindings */
const { useState: sUseState, useEffect: sUseEffect, useMemo: sUseMemo, useRef: sUseRef, useCallback: sUseCallback } = React;
const { useLocation: sUseLocation, useNavigate: sUseNavigate, Link: sLink } = ReactRouterDOM;
/* =========================================================================
   PAGE 4: Student Analytics Page
   ========================================================================= */
function StudentAnalyticsPage({ session }) {
  const [stats, setStats] = sUseState(null);
  const [loading, setLoading] = sUseState(true);

  sUseEffect(() => {
    let alive = true;
    const fetchStats = async () => {
      try {
        const username = session?.user?.username || 'amara';
        const data = await window.OV.services.analytics.getViewStats(username);
        if (alive) setStats(data);
      } catch {
        if (alive) setStats({ total: 0, byOnevue: {} });
      } finally {
        if (alive) setLoading(false);
      }
    };
    fetchStats();
    return () => { alive = false; };
  }, [session]);

  const hasData = stats && stats.total > 0;

  return (
    <div style={{ display: 'grid', gap: 28, maxWidth: 900 }}>
      <div>
        <span className="eyebrow" style={{ color: 'var(--accent)', fontSize: 12 }}>Visitor Intelligence</span>
        <h1 className="h-card" style={{ fontSize: 32, margin: '4px 0 6px' }}>Profile Analytics</h1>
        <p className="muted" style={{ fontSize: 15, margin: 0 }}>
          Track which admissions offices, recruiters, and mentors access your verified views.
        </p>
      </div>

      {loading ? (
        <GlassCard style={{ padding: 40, textAlign: 'center' }}>
          <div className="spin" style={{ margin: '0 auto 12px', width: 24, height: 24 }} />
          <p className="muted">Gathering verified analytics events...</p>
        </GlassCard>
      ) : hasData ? (
        <div style={{ display: 'grid', gap: 24 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16 }}>
            <div className="glass" style={{ padding: 24, borderRadius: 20 }}>
              <span className="faint" style={{ fontSize: 12, textTransform: 'uppercase' }}>Total Profile Views</span>
              <h3 style={{ fontSize: 36, margin: '8px 0 0', color: 'var(--accent)' }}>{stats.total}</h3>
            </div>
            <div className="glass" style={{ padding: 24, borderRadius: 20 }}>
              <span className="faint" style={{ fontSize: 12, textTransform: 'uppercase' }}>College / Intern Views</span>
              <h3 style={{ fontSize: 36, margin: '8px 0 0' }}>{stats.byOnevue.college || 0}</h3>
            </div>
            <div className="glass" style={{ padding: 24, borderRadius: 20 }}>
              <span className="faint" style={{ fontSize: 12, textTransform: 'uppercase' }}>Recruiter Views</span>
              <h3 style={{ fontSize: 36, margin: '8px 0 0' }}>{stats.byOnevue.recruiter || 0}</h3>
            </div>
          </div>
        </div>
      ) : (
        <EmptyState
          title="No profile visits recorded yet"
          body="Analytics events will appear automatically when admissions reps, professors, or recruiters view your public profile."
        />
      )}
    </div>
  );
}


window.StudentAnalyticsPage = StudentAnalyticsPage;
