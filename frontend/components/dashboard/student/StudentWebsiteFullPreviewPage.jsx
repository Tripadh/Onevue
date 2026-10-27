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
  const themeMode = previewData?.config?.customization?.themeMode || 'system';
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

          <PortfolioPreviewFrame
            dto={dto}
            username={username}
            customization={previewData?.config?.customization}
            templateId={previewData?.config?.selectedTemplateId}
            templateVersion={previewData?.config?.selectedTemplateVersion}
            height={viewport === 'mobile' ? 680 : 820}
          />
        </div>
      </div>
    </div>
  );
}


window.StudentWebsiteFullPreviewPage = StudentWebsiteFullPreviewPage;
