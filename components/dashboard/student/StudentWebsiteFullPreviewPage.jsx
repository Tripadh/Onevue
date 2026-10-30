/* Hooks and Router bindings */
const { useState: sUseState, useEffect: sUseEffect, useMemo: sUseMemo, useRef: sUseRef, useCallback: sUseCallback } = React;
const { useLocation: sUseLocation, useNavigate: sUseNavigate, Link: sLink } = ReactRouterDOM;


/* =========================================================================
   PAGE 5B: Dedicated Full-Page Website Preview Workspace (Separate Page)
   ========================================================================= */
function StudentWebsiteFullPreviewPage({ session, studentProfile, basePath = '/app/student' }) {
  const navigate = sUseNavigate();
  const toast = useToast();
  const [loading, setLoading] = sUseState(true);
  const [previewData, setPreviewData] = sUseState(null);
  const [viewport, setViewport] = sUseState('desktop'); // 'desktop' | 'mobile'
  const [publishing, setPublishing] = sUseState(false);

  const apiBase = (window.OV_ENV && window.OV_ENV.API_BASE) || 'http://localhost:3000/api';
  const portfolioBase = (window.OV_ENV && window.OV_ENV.PORTFOLIO_BASE) || 'http://localhost:3001';
  const token = session?.token || (window.OV?.core?.db?.get('session')?.token);

  const fetchPreview = sUseCallback(async () => {
    if (!token) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`${apiBase}/student/website/preview`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      if (res.ok) {
        const data = await res.json();
        if (data && data.success) {
          setPreviewData(data);
        }
      }
    } catch (err) {
      console.warn('Could not load preview in separate page:', err);
    } finally {
      setLoading(false);
    }
  }, [apiBase, token]);

  sUseEffect(() => {
    fetchPreview();
  }, [fetchPreview]);

  const handlePublish = async () => {
    if (!token) return;
    setPublishing(true);
    try {
      const res = await fetch(`${apiBase}/student/website/publish`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.push({ title: 'Publication failed', body: data.message || 'Could not publish website.', tone: 'error' });
        return;
      }
      toast.push({
        title: 'Website Published!',
        body: `Revision #${data.revision?.revisionNumber || ''} is now active and live.`,
        tone: 'success',
      });
      await fetchPreview();
    } catch {
      toast.push({ title: 'Network error', body: 'Could not connect to backend server.', tone: 'error' });
    } finally {
      setPublishing(false);
    }
  };

  const username = previewData?.config?.username || session?.user?.username || 'student';
  const publicLiveUrl = `${portfolioBase}/p/${username}`;
  const accentColor = previewData?.config?.customization?.accentColor || '#3b82f6';
  const themeMode = previewData?.config?.customization?.themeMode || 'system';
  const visibleSections = previewData?.config?.customization?.visibleSections || ['about', 'education', 'projects', 'skills', 'work', 'achievements', 'contact'];
  const dto = previewData?.dto;

  if (loading) {
    return (
      <div style={{ maxWidth: 1040, margin: '60px auto', padding: '0 20px', textAlign: 'center' }}>
        <span className="spin" style={{ width: 32, height: 32, display: 'inline-block', marginBottom: 16 }} />
        <h3 style={{ fontSize: 22, margin: '0 0 8px' }}>Loading your website preview...</h3>
        <p className="muted" style={{ fontSize: 14 }}>Fetching your latest saved student identity records and template presentation.</p>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* Top Floating Preview Control Bar */}
      <div
        className="glass"
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 50,
          padding: '12px 24px',
          borderRadius: 16,
          marginBottom: 20,
          border: '1px solid var(--line)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 12,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <button
            onClick={() => navigate(`${basePath}/website`)}
            className="btn btn-glass btn-sm"
            style={{ display: 'flex', alignItems: 'center', gap: 6 }}
          >
            ← Back to Dashboard
          </button>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              className="badge"
              style={{
                background: 'color-mix(in oklab, #3b82f6 15%, transparent)',
                color: '#3b82f6',
                border: '1px solid #3b82f6',
                fontSize: 12,
              }}
            >
              PREVIEW MODE (Draft Data)
            </span>
            <span className="mono muted" style={{ fontSize: 12 }}>
              Target URL: onevue.me/p/{username}
            </span>
          </div>
        </div>

        {/* Viewport & Publish Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div
            style={{
              display: 'flex',
              background: 'color-mix(in oklab, var(--bg-0) 50%, transparent)',
              borderRadius: 10,
              padding: 3,
              border: '1px solid var(--line)',
            }}
          >
            <button
              type="button"
              onClick={() => setViewport('desktop')}
              className={'tab ' + (viewport === 'desktop' ? 'is-active' : '')}
              style={{
                padding: '6px 14px',
                borderRadius: 8,
                fontSize: 12,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                background: viewport === 'desktop' ? 'var(--primary)' : 'transparent',
                color: viewport === 'desktop' ? 'var(--on-primary)' : 'var(--text-2)',
                border: 0,
                cursor: 'pointer',
              }}
            >
              <WebsiteIcons.desktop /> Desktop
            </button>
            <button
              type="button"
              onClick={() => setViewport('mobile')}
              className={'tab ' + (viewport === 'mobile' ? 'is-active' : '')}
              style={{
                padding: '6px 14px',
                borderRadius: 8,
                fontSize: 12,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                background: viewport === 'mobile' ? 'var(--primary)' : 'transparent',
                color: viewport === 'mobile' ? 'var(--on-primary)' : 'var(--text-2)',
                border: 0,
                cursor: 'pointer',
              }}
            >
              <WebsiteIcons.mobile /> Mobile
            </button>
          </div>

          <Button
            size="sm"
            variant="glass"
            icon={<WebsiteIcons.external />}
            onClick={() => window.open(publicLiveUrl, '_blank')}
          >
            Open Live Site
          </Button>

          <Button
            size="sm"
            variant="primary"
            loading={publishing}
            icon={<WebsiteIcons.publish />}
            onClick={handlePublish}
          >
            Publish Website
          </Button>
        </div>
      </div>

      {/* Main Preview Canvas Area */}
      <div
        style={{
          flex: 1,
          display: 'flex',
          justifyContent: 'center',
        }}
      >
        <div
          style={{
            width: viewport === 'mobile' ? 390 : '100%',
            maxWidth: viewport === 'mobile' ? 390 : 920,
            borderRadius: viewport === 'mobile' ? 28 : 16,
            border: viewport === 'mobile' ? '5px solid #334155' : '1px solid var(--line)',
            boxShadow: '0 25px 60px rgba(0,0,0,0.45)',
            background: themeMode === 'light' ? '#ffffff' : '#090d16',
            color: themeMode === 'light' ? '#0f172a' : '#f8fafc',
            overflow: 'hidden',
            transition: 'width .25s ease',
            minHeight: '80vh',
            display: 'flex',
            flexDirection: 'column',
          }}
        >
          {/* Simulated Browser Chrome Top Bar */}
          <div
            style={{
              padding: '10px 16px',
              background: themeMode === 'light' ? '#f1f5f9' : '#0e1424',
              borderBottom: '1px solid rgba(255,255,255,0.06)',
              display: 'flex',
              alignItems: 'center',
              gap: 10,
            }}
          >
            <div style={{ display: 'flex', gap: 6 }}>
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#ef4444' }} />
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#f59e0b' }} />
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#10b981' }} />
            </div>
            <div
              className="mono"
              style={{
                flex: 1,
                textAlign: 'center',
                fontSize: 12,
                color: 'var(--text-3)',
                background: themeMode === 'light' ? '#ffffff' : 'rgba(255,255,255,0.05)',
                borderRadius: 8,
                padding: '4px 12px',
              }}
            >
              https://onevue.me/p/{username} [DRAFT PREVIEW]
            </div>
          </div>

          {/* Full Template Content */}
          <div style={{ padding: viewport === 'mobile' ? '28px 18px' : '48px 40px', display: 'grid', gap: 36, flex: 1 }}>
            {/* Hero / Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap' }}>
              <div style={{ flex: 1 }}>
                <span
                  style={{
                    fontSize: 12,
                    fontWeight: 600,
                    color: accentColor,
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                  }}
                >
                  Student Portfolio
                </span>
                <h1 style={{ fontSize: viewport === 'mobile' ? 26 : 34, margin: '6px 0 8px', fontWeight: 700, letterSpacing: '-0.02em' }}>
                  {dto?.profile?.displayName || studentProfile?.name || 'Student Name'}
                </h1>
                <p style={{ fontSize: 16, margin: '0 0 12px', color: themeMode === 'light' ? '#475569' : '#94a3b8', lineHeight: 1.5 }}>
                  {dto?.profile?.headline || studentProfile?.headline || 'Undergraduate Student & Researcher'}
                </p>
                {dto?.profile?.location?.formatted && (
                  <span style={{ fontSize: 13, color: '#64748b' }}>
                    📍 {dto.profile.location.formatted}
                  </span>
                )}
              </div>
              <div
                style={{
                  width: viewport === 'mobile' ? 70 : 96,
                  height: viewport === 'mobile' ? 70 : 96,
                  borderRadius: '50%',
                  background: accentColor,
                  display: 'grid',
                  placeItems: 'center',
                  color: '#fff',
                  fontSize: viewport === 'mobile' ? 24 : 36,
                  fontWeight: 600,
                  boxShadow: '0 10px 30px rgba(0,0,0,0.3)',
                  border: '3px solid rgba(255,255,255,0.2)',
                }}
              >
                {(dto?.profile?.displayName || studentProfile?.name || 'S').slice(0, 1).toUpperCase()}
              </div>
            </div>

            {/* About Section */}
            {visibleSections.includes('about') && (
              <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 28 }}>
                <h3 style={{ fontSize: 18, margin: '0 0 12px', fontWeight: 600, color: 'inherit' }}>About</h3>
                <p style={{ fontSize: 14.5, lineHeight: 1.7, color: themeMode === 'light' ? '#334155' : '#94a3b8', margin: 0 }}>
                  {dto?.profile?.bio || studentProfile?.bio || 'No biographical summary added yet. You can add one anytime in the Student Identity editor.'}
                </p>
              </div>
            )}

            {/* Education Section */}
            {visibleSections.includes('education') && (
              <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 28 }}>
                <h3 style={{ fontSize: 18, margin: '0 0 16px', fontWeight: 600, color: 'inherit' }}>Education</h3>
                {dto?.education && dto.education.length > 0 ? (
                  <div style={{ display: 'grid', gap: 14 }}>
                    {dto.education.map((edu, i) => (
                      <div
                        key={i}
                        style={{
                          padding: 16,
                          borderRadius: 14,
                          background: themeMode === 'light' ? '#f8fafc' : 'rgba(255,255,255,0.03)',
                          border: '1px solid rgba(255,255,255,0.08)',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap', gap: 6 }}>
                          <strong style={{ fontSize: 16 }}>{edu.institution}</strong>
                          <span style={{ fontSize: 12, color: '#64748b' }}>
                            {edu.startDate ? `${edu.startDate} - ${edu.expectedGradDate || edu.endDate || 'Present'}` : (edu.expectedGradDate || edu.gradYear || '')}
                          </span>
                        </div>
                        <span style={{ display: 'block', fontSize: 14, color: accentColor, marginTop: 4, fontWeight: 500 }}>
                          {edu.degree} {edu.fieldOfStudy ? `in ${edu.fieldOfStudy}` : ''}
                        </span>
                        {edu.gpa && (
                          <span style={{ fontSize: 12, color: '#64748b', display: 'block', marginTop: 4 }}>
                            GPA: {edu.gpa} {edu.gpaScale ? `/ ${edu.gpaScale}` : ''}
                          </span>
                        )}
                        {edu.location && (
                          <span style={{ fontSize: 12, color: '#64748b', display: 'block', marginTop: 2 }}>
                            {edu.location}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p style={{ fontSize: 13, color: '#64748b', margin: 0 }}>No education records added yet.</p>
                )}
              </div>
            )}

            {/* Projects Section */}
            {visibleSections.includes('projects') && (
              <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 28 }}>
                <h3 style={{ fontSize: 18, margin: '0 0 16px', fontWeight: 600, color: 'inherit' }}>Featured Projects</h3>
                {dto?.projects && dto.projects.length > 0 ? (
                  <div style={{ display: 'grid', gridTemplateColumns: viewport === 'mobile' ? '1fr' : 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16 }}>
                    {dto.projects.map((proj, i) => (
                      <div
                        key={i}
                        style={{
                          padding: 18,
                          borderRadius: 14,
                          background: themeMode === 'light' ? '#f8fafc' : 'rgba(255,255,255,0.03)',
                          border: '1px solid rgba(255,255,255,0.08)',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: 10,
                        }}
                      >
                        <strong style={{ fontSize: 15, display: 'block' }}>{proj.title}</strong>
                        <p style={{ fontSize: 12.5, color: '#64748b', margin: 0, lineHeight: 1.5, flex: 1 }}>
                          {proj.shortDescription || proj.detailedDescription || 'Showcase project'}
                        </p>
                        {proj.tags && proj.tags.length > 0 && (
                          <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                            {proj.tags.map((t, ti) => (
                              <span key={ti} style={{ fontSize: 11, padding: '2px 8px', borderRadius: 6, background: 'rgba(59,130,246,0.1)', color: accentColor }}>
                                {t}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p style={{ fontSize: 13, color: '#64748b', margin: 0 }}>No projects showcased yet.</p>
                )}
              </div>
            )}

            {/* Skills Section */}
            {visibleSections.includes('skills') && (
              <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 28 }}>
                <h3 style={{ fontSize: 18, margin: '0 0 14px', fontWeight: 600, color: 'inherit' }}>Skills</h3>
                {dto?.skills && dto.skills.length > 0 ? (
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {dto.skills.map((s, i) => (
                      <span
                        key={i}
                        style={{
                          fontSize: 12,
                          padding: '5px 12px',
                          borderRadius: 999,
                          background: themeMode === 'light' ? '#e2e8f0' : 'rgba(255,255,255,0.08)',
                          color: themeMode === 'light' ? '#1e293b' : '#e2e8f0',
                        }}
                      >
                        {s.name}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p style={{ fontSize: 13, color: '#64748b', margin: 0 }}>No skills recorded yet.</p>
                )}
              </div>
            )}

            {/* Contact Section */}
            {visibleSections.includes('contact') && (
              <div style={{ borderTop: '1px solid rgba(255,255,255,0.08)', paddingTop: 28 }}>
                <h3 style={{ fontSize: 18, margin: '0 0 10px', fontWeight: 600, color: 'inherit' }}>Contact</h3>
                <p style={{ fontSize: 13, color: '#64748b', margin: 0 }}>
                  Feel free to connect or review verified academic credentials via OneVue.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}


window.StudentWebsiteFullPreviewPage = StudentWebsiteFullPreviewPage;
