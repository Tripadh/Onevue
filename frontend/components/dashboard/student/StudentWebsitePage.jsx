/* Hooks and Router bindings */
const { useState: sUseState, useEffect: sUseEffect, useMemo: sUseMemo, useRef: sUseRef, useCallback: sUseCallback } = React;
const { useLocation: sUseLocation, useNavigate: sUseNavigate, Link: sLink } = ReactRouterDOM;

/* =========================================================================
   PAGE 5: Student My Website Management Dashboard (Phase 5)
   Complete, production-oriented website experience:
   - Overview: Truthful backend status, active revision, public URL
   - Templates: Approved canonical template registry & switching
   - Customize: Theme mode, accent color, visible section toggles
   - Publish & History: Pre-publish confirmation, immutable revisions, rollback
   - Preview: Live draft preview with Desktop / Mobile viewport toggle
   ========================================================================= */

/* Approved templates come from the shared registry. Only registered adapters are listed. */
const CANONICAL_TEMPLATES = (window.OV && window.OV.createCustomize)
  ? window.OV.createCustomize.listTemplates()
  : [];

/* Specialized Website Icons */
const WebsiteIcons = {
  overview: (p) => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </svg>
  ),
  templates: (p) => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  ),
  customize: (p) => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <circle cx="13.5" cy="6.5" r=".5" fill="currentColor" />
      <circle cx="17.5" cy="10.5" r=".5" fill="currentColor" />
      <circle cx="8.5" cy="7.5" r=".5" fill="currentColor" />
      <circle cx="6.5" cy="12.5" r=".5" fill="currentColor" />
      <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />
    </svg>
  ),
  publish: (p) => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
      <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
      <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
      <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
    </svg>
  ),
  history: (p) => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </svg>
  ),
  preview: (p) => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ),
  rollback: (p) => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <polyline points="1 4 1 10 7 10" />
      <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
    </svg>
  ),
  desktop: (p) => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <rect x="2" y="3" width="20" height="14" rx="2" />
      <line x1="8" y1="21" x2="16" y2="21" />
      <line x1="12" y1="17" x2="12" y2="21" />
    </svg>
  ),
  mobile: (p) => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <rect x="5" y="2" width="14" height="20" rx="2" />
      <line x1="12" y1="18" x2="12.01" y2="18" />
    </svg>
  ),
  external: (p) => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  ),
  copy: (p) => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  ),
  check: (p) => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  ),
  alert: (p) => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}>
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  ),
};

function StudentWebsitePage({ session, studentProfile, basePath = '/app/student' }) {
  const toast = useToast();
  const navigate = sUseNavigate();

  /* Navigation sub-tabs */
  const [subTab, setSubTab] = sUseState('overview'); // 'overview' | 'templates' | 'customize' | 'publish-history'

  /* Backend state */
  const [loading, setLoading] = sUseState(true);
  const [config, setConfig] = sUseState(null);
  const [history, setHistory] = sUseState([]);
  const [activeRevisionId, setActiveRevisionId] = sUseState(null);
  const [activeRevisionNumber, setActiveRevisionNumber] = sUseState(null);
  const [previewData, setPreviewData] = sUseState(null);
  const [contract, setContract] = sUseState(null);
  const [templates, setTemplates] = sUseState(CANONICAL_TEMPLATES);

  /* Working customization form state. Initial values come from the identity
     contract; they are replaced by the stored draft before any interaction. */
  const [themeMode, setThemeMode] = sUseState('system');
  const [accentColor, setAccentColor] = sUseState('#3b82f6');
  const [visibleSections, setVisibleSections] = sUseState([]);
  const [sectionOrder, setSectionOrder] = sUseState([]);
  const configRef = sUseRef(null);
  const defaultsAppliedRef = sUseRef(false);
  const [savingCustomization, setSavingCustomization] = sUseState(false);
  const [selectingTemplate, setSelectingTemplate] = sUseState(false);

  /* Modals */
  const [previewOpen, setPreviewOpen] = sUseState(false);
  const [previewViewport, setPreviewViewport] = sUseState('desktop'); // 'desktop' | 'mobile'
  const [previewLoading, setPreviewLoading] = sUseState(false);
  const [publishModalOpen, setPublishModalOpen] = sUseState(false);
  const [publishing, setPublishing] = sUseState(false);
  const [rollbackModalItem, setRollbackModalItem] = sUseState(null);
  const [rollingBack, setRollingBack] = sUseState(false);
  const [claimUsernameOpen, setClaimUsernameOpen] = sUseState(false);
  const [desiredUsername, setDesiredUsername] = sUseState(() => {
    return (
      session?.user?.username ||
      (session?.user?.name ? session.user.name.toLowerCase().replace(/[^a-z0-9_-]/g, '') : '') ||
      (session?.user?.email ? session.user.email.split('@')[0].toLowerCase().replace(/[^a-z0-9_-]/g, '') : '') ||
      ''
    );
  });
  const [claimingUsername, setClaimingUsername] = sUseState(false);

  /* Endpoints & Auth */
  const apiBase = (window.OV_ENV && window.OV_ENV.API_BASE) || 'http://localhost:3000/api';
  const portfolioBase = (window.OV_ENV && window.OV_ENV.PORTFOLIO_BASE) || 'http://localhost:3001';

  const getAuthToken = sUseCallback(() => {
    return session?.token || (window.OV?.core?.db?.get('session')?.token);
  }, [session]);

  /* The backend registry is authoritative. Offer only templates that are both
     registered by the backend and implemented by this dashboard's mirror. */
  sUseEffect(() => {
    let cancelled = false;
    const mirrorIds = CANONICAL_TEMPLATES.map((template) => template.id);
    (async () => {
      try {
        const res = await fetch(`${apiBase}/templates`);
        if (!res.ok) return;
        const data = await res.json();
        const list = data && data.success && Array.isArray(data.templates)
          ? data.templates.filter((template) => mirrorIds.indexOf(template.id) !== -1)
          : [];
        if (!cancelled && list.length) setTemplates(list);
      } catch {
        /* Keep the local approved mirror when the registry is unreachable. */
      }
    })();
    return () => { cancelled = true; };
  }, [apiBase]);

  /* ---------------- Data Fetchers ---------------- */

  /* Defaults only apply when the user has never stored a customization. An
     explicitly saved empty list is respected instead of being replaced. */
  const applyContractDefaults = sUseCallback((nextContract) => {
    if (!nextContract || !nextContract.defaultSections || defaultsAppliedRef.current) return;
    const saved = configRef.current && configRef.current.customization;
    if (saved && Array.isArray(saved.visibleSections)) {
      defaultsAppliedRef.current = true;
      return;
    }
    defaultsAppliedRef.current = true;
    if (Array.isArray(nextContract.defaultSections.visible)) {
      setVisibleSections(nextContract.defaultSections.visible.slice());
    }
    if (Array.isArray(nextContract.defaultSections.order)) {
      setSectionOrder(nextContract.defaultSections.order.slice());
    }
  }, []);

  const fetchContract = sUseCallback(async (templateId) => {
    const identity = session && session.user && session.user.identity;
    if (!identity) return null;
    try {
      const res = await fetch(
        `${apiBase}/website/contract?identity=${encodeURIComponent(identity)}&templateId=${encodeURIComponent(templateId || 'magicui-portfolio')}`
      );
      if (res.ok) {
        const data = await res.json();
        const next = data && data.success && Array.isArray(data.contracts) ? data.contracts[0] : null;
        if (next) {
          setContract(next);
          applyContractDefaults(next);
          return next;
        }
      }
    } catch (err) {
      console.warn('Failed to load website contract:', err);
    }
    return null;
  }, [apiBase, session, applyContractDefaults]);

  const fetchConfig = sUseCallback(async () => {
    const token = getAuthToken();
    if (!token) return null;
    try {
      const res = await fetch(`${apiBase}/student/website/config`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      if (res.ok) {
        const data = await res.json();
        if (data && data.config) {
          configRef.current = data.config;
          setConfig(data.config);
          if (data.config.username) {
            setDesiredUsername(data.config.username);
          }
          if (data.config.customization) {
            if (data.config.customization.themeMode) setThemeMode(data.config.customization.themeMode);
            if (data.config.customization.accentColor) setAccentColor(data.config.customization.accentColor);
            if (Array.isArray(data.config.customization.visibleSections)) {
              setVisibleSections(data.config.customization.visibleSections);
            }
            if (Array.isArray(data.config.customization.sectionOrder) && data.config.customization.sectionOrder.length) {
              setSectionOrder(data.config.customization.sectionOrder);
            }
          }
          if (data.config.activeRevisionId) setActiveRevisionId(data.config.activeRevisionId);
          if (data.config.activeRevisionNumber) setActiveRevisionNumber(data.config.activeRevisionNumber);
          return data.config;
        } else {
          configRef.current = null;
          setConfig(null);
          // If no config, ensure desiredUsername is primed from user session
          const fallbackHandle = (
            session?.user?.username ||
            (session?.user?.name ? session.user.name.toLowerCase().replace(/[^a-z0-9_-]/g, '') : '') ||
            (session?.user?.email ? session.user.email.split('@')[0].toLowerCase().replace(/[^a-z0-9_-]/g, '') : '') ||
            (session?.user?.identity || 'user')
          );
          setDesiredUsername((prev) => prev || fallbackHandle);
          return null;
        }
      }
    } catch (err) {
      console.warn('Failed to load website config:', err);
    }
    return null;
  }, [apiBase, getAuthToken]);

  const fetchHistory = sUseCallback(async () => {
    const token = getAuthToken();
    if (!token) return;
    try {
      const res = await fetch(`${apiBase}/student/website/history`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      if (res.ok) {
        const data = await res.json();
        if (data && data.success) {
          setHistory(Array.isArray(data.revisions) ? data.revisions : []);
          if (data.activeRevisionId) setActiveRevisionId(data.activeRevisionId);
          if (data.activeRevisionNumber) setActiveRevisionNumber(data.activeRevisionNumber);
        }
      }
    } catch (err) {
      console.warn('Failed to load website history:', err);
    }
  }, [apiBase, getAuthToken]);

  const fetchPreview = sUseCallback(async () => {
    const token = getAuthToken();
    if (!token) return null;
    setPreviewLoading(true);
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
          return data;
        }
      }
    } catch (err) {
      console.warn('Failed to load website preview:', err);
    } finally {
      setPreviewLoading(false);
    }
    return null;
  }, [apiBase, getAuthToken]);

  /* Initial Load */
  sUseEffect(() => {
    let mounted = true;
    (async () => {
      setLoading(true);
      const loadedConfig = await fetchConfig();
      await Promise.all([
        fetchHistory(),
        fetchPreview(),
        fetchContract(loadedConfig && loadedConfig.selectedTemplateId),
      ]);
      if (mounted) setLoading(false);
    })();
    return () => {
      mounted = false;
    };
  }, [fetchConfig, fetchHistory, fetchPreview, fetchContract]);

  /* Preview embeds the identity contract, so it covers a failed contract request. */
  sUseEffect(() => {
    if (!contract && previewData && previewData.contract) {
      setContract(previewData.contract);
      applyContractDefaults(previewData.contract);
    }
  }, [contract, previewData, applyContractDefaults]);

  /* Open Preview Handler: Opens in a dedicated separate page tab */
  const handleOpenPreview = async () => {
    window.open(`/#${basePath}/website/preview`, '_blank');
  };

  /* ---------------- Claim / Initialize Username ---------------- */
  const handleClaimUsername = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    const token = getAuthToken();
    if (!token) {
      toast.push({ title: 'Authentication missing', body: 'Please sign in to continue.', tone: 'error' });
      return;
    }
    const cleanUsername = String(desiredUsername || '').toLowerCase().trim();
    if (!cleanUsername || cleanUsername.length < 3) {
      toast.push({ title: 'Invalid handle', body: 'Username must be at least 3 characters.', tone: 'error' });
      return;
    }
    setClaimingUsername(true);
    try {
      const res = await fetch(`${apiBase}/student/website/config`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: cleanUsername,
          selectedTemplateId: (config && config.selectedTemplateId) || (activeTemplate && activeTemplate.id) || 'magicui-portfolio',
          selectedTemplateVersion: (config && config.selectedTemplateVersion) || (activeTemplate && activeTemplate.version) || '1.0.0',
          customization: {
            themeMode,
            accentColor,
            visibleSections: sanitizeSectionIds(visibleSections),
            sectionOrder: sanitizeSectionIds(sectionOrder),
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.push({ title: 'Could not claim handle', body: data.message || 'Operation failed.', tone: 'error' });
        return;
      }
      toast.push({ title: 'Portfolio handle claimed!', body: `@${cleanUsername} is registered to your account.`, tone: 'success' });
      setClaimUsernameOpen(false);
      await fetchConfig();
      await fetchHistory();
    } catch (err) {
      toast.push({ title: 'Network error', body: 'Could not connect to backend.', tone: 'error' });
    } finally {
      setClaimingUsername(false);
    }
  };

  /* ---------------- Template Selection ---------------- */
  const handleSelectTemplate = async (templateId, templateVersion) => {
    const token = getAuthToken();
    if (!token) {
      toast.push({ title: 'Authentication missing', body: 'Please sign in to select templates.', tone: 'error' });
      return;
    }

    if (!templates.some((template) => template.id === templateId)) {
      toast.push({ title: 'Unsupported template', body: 'Only templates in the approved registry can be selected.', tone: 'error' });
      return;
    }

    if (!config?.username) {
      const defaultName = (session?.user?.username || session?.user?.name || session?.user?.identity || 'user')
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '');
      setDesiredUsername(defaultName);
      setClaimUsernameOpen(true);
      return;
    }

    setSelectingTemplate(true);
    try {
      const res = await fetch(`${apiBase}/student/website/config`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          selectedTemplateId: templateId,
          selectedTemplateVersion: templateVersion,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.push({ title: 'Selection failed', body: data.message || 'Could not save template selection.', tone: 'error' });
        return;
      }
      toast.push({
        title: 'Template selected',
        body: `${data.template?.name || 'The template'} is now selected for your draft. The live site updates upon publication.`,
        tone: 'success',
      });
      await fetchConfig();
      await fetchContract(templateId);
    } catch (err) {
      toast.push({ title: 'Network error', body: 'Could not update template selection.', tone: 'error' });
    } finally {
      setSelectingTemplate(false);
    }
  };

  /* ---------------- Save Customization ---------------- */
  const handleSaveCustomization = async () => {
    const token = getAuthToken();
    if (!token) {
      toast.push({ title: 'Authentication missing', body: 'Please sign in to save customization.', tone: 'error' });
      return;
    }

    if (!config?.username) {
      const defaultName = (session?.user?.username || session?.user?.name || session?.user?.identity || 'user')
        .toLowerCase()
        .replace(/[^a-z0-9_-]/g, '');
      setDesiredUsername(defaultName);
      setClaimUsernameOpen(true);
      return;
    }

    setSavingCustomization(true);
    try {
      const res = await fetch(`${apiBase}/student/website/config`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          customization: {
            themeMode,
            accentColor,
            visibleSections: sanitizeSectionIds(visibleSections),
            sectionOrder: sanitizeSectionIds(sectionOrder),
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.push({ title: 'Save failed', body: data.message || 'Could not save settings.', tone: 'error' });
        return;
      }
      toast.push({
        title: 'Customization saved to draft',
        body: 'Settings updated. Preview now reflects your changes. Live site remains unaffected until published.',
        tone: 'success',
      });
      await fetchConfig();
    } catch (err) {
      toast.push({ title: 'Network error', body: 'Could not save customization settings.', tone: 'error' });
    } finally {
      setSavingCustomization(false);
    }
  };

  /* ---------------- Explicit Publication ---------------- */
  const handleConfirmPublish = async () => {
    const token = getAuthToken();
    if (!token) {
      toast.push({ title: 'Authentication missing', body: 'Please sign in to publish.', tone: 'error' });
      return;
    }
    setPublishing(true);
    try {
      const isClaimingUsername = !config?.username;
      let activeUsername = config?.username;
      let cleanHandle = '';

      // 1. Claim a handle first when the user has no website configuration yet.
      if (isClaimingUsername) {
        cleanHandle = String(desiredUsername || '').toLowerCase().trim();
        if (!cleanHandle || cleanHandle.length < 3) {
          toast.push({
            title: 'Handle required',
            body: 'Please enter a valid handle (3-30 characters) before publishing.',
            tone: 'error',
          });
          setPublishing(false);
          return;
        }
      }

      // 2. Persist the latest customization before publishing. Publication must
      // build from the exact configuration shown in the Customize tab, and a
      // failed save must prevent publication.
      const configRes = await fetch(`${apiBase}/student/website/config`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          ...(isClaimingUsername
            ? {
                username: cleanHandle,
                selectedTemplateId: config?.selectedTemplateId || 'magicui-portfolio',
                selectedTemplateVersion: config?.selectedTemplateVersion || '1.0.0',
              }
            : {}),
          customization: {
            themeMode,
            accentColor,
            visibleSections: sanitizeSectionIds(visibleSections),
            sectionOrder: sanitizeSectionIds(sectionOrder),
          },
        }),
      });

      const configData = await configRes.json();
      if (!configRes.ok) {
        toast.push({
          title: isClaimingUsername ? 'Could not claim handle' : 'Could not save customization',
          body: isClaimingUsername
            ? configData.message || 'Username may already be taken. Please pick another handle.'
            : configData.message || 'Fix the customization settings before publishing.',
          tone: 'error',
        });
        setPublishing(false);
        return;
      }

      activeUsername = configData.config?.username || activeUsername;
      if (configData.config) setConfig(configData.config);

      // 3. Publish using the configuration persisted above.
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
        body: `Revision #${data.revision?.revisionNumber || ''} is now active and live at onevue.me/p/${activeUsername}.`,
        tone: 'success',
      });
      setPublishModalOpen(false);
      await Promise.all([fetchConfig(), fetchHistory()]);
    } catch (err) {
      toast.push({ title: 'Network error', body: 'Could not complete publication.', tone: 'error' });
    } finally {
      setPublishing(false);
    }
  };

  /* ---------------- Rollback to Revision ---------------- */
  const handleConfirmRollback = async () => {
    if (!rollbackModalItem) return;
    const token = getAuthToken();
    if (!token) {
      toast.push({ title: 'Authentication missing', body: 'Please sign in to rollback.', tone: 'error' });
      return;
    }
    setRollingBack(true);
    try {
      const res = await fetch(`${apiBase}/student/website/rollback`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          revisionNumber: rollbackModalItem.revisionNumber,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.push({ title: 'Rollback failed', body: data.message || 'Could not complete rollback.', tone: 'error' });
        return;
      }
      toast.push({
        title: 'Rollback Successful',
        body: `Active live website restored to Revision #${rollbackModalItem.revisionNumber}.`,
        tone: 'success',
      });
      setRollbackModalItem(null);
      await Promise.all([fetchConfig(), fetchHistory()]);
    } catch (err) {
      toast.push({ title: 'Network error', body: 'Could not complete rollback.', tone: 'error' });
    } finally {
      setRollingBack(false);
    }
  };

  /* ---------------- State Model Derivation ---------------- */
  const username = config?.username;
  const publicPortfolioUrl = username ? `${portfolioBase}/p/${username}` : null;
  const isPublished = config?.status === 'published' && !!config?.activeRevisionId;

  // Determine if there are draft modifications newer than last published timestamp
  const hasChangesAwaitingPublication = sUseMemo(() => {
    if (!isPublished || !config?.publishedAt) return false;
    const pubTime = new Date(config.publishedAt).getTime();
    if (config?.updatedAt && new Date(config.updatedAt).getTime() > pubTime + 1000) return true;
    if (studentProfile?.updatedAt && new Date(studentProfile.updatedAt).getTime() > pubTime + 1000) return true;
    return false;
  }, [isPublished, config?.publishedAt, config?.updatedAt, studentProfile?.updatedAt]);

  const activeTemplate = templates.find((template) => template.id === (config && config.selectedTemplateId))
    || templates[0]
    || CANONICAL_TEMPLATES[0];

  /* Identity, section catalog, and readiness all come from the authoritative
     contract. Nothing below re-declares per-identity section lists. */
  const identity = (previewData && previewData.identity) || (session && session.user && session.user.identity) || (contract && contract.identity) || '';
  const contractData = (contract && contract.identity === identity)
    ? contract
    : (previewData && previewData.contract && previewData.contract.identity === identity ? previewData.contract : null);
  const identityLabel = (contractData && contractData.label) || (identity ? identity.charAt(0).toUpperCase() + identity.slice(1) : 'Website');
  const identityHeading = (contractData && contractData.heading) || `${identityLabel} Website`;
  const identityDescription = (contractData && contractData.description) ||
    `Manage the public website built from your saved ${identityLabel.toLowerCase()} identity, preview draft changes, and publish versioned revisions.`;
  const identityPagePath = (contractData && contractData.identityPagePath) || `${basePath}/identity`;
  const identityPageLabel = (contractData && contractData.identityPageLabel) || `${identityLabel} Identity`;
  const readinessTitle = (contractData && contractData.readinessTitle) || `${identityLabel} content readiness`;

  const templateSupportedSections = sUseMemo(() => {
    if (!activeTemplate || !Array.isArray(activeTemplate.supportedSections)) return null;
    return new Set(activeTemplate.supportedSections);
  }, [activeTemplate]);

  const sectionControls = sUseMemo(() => {
    const sections = contractData && Array.isArray(contractData.sections) ? contractData.sections : [];
    return sections.map((section) => ({
      id: section.id,
      label: section.label,
      description: section.description,
      rendererSection: section.rendererSection,
      supported: templateSupportedSections ? templateSupportedSections.has(section.id) : section.supported !== false,
      recordCustomFields: !!section.recordCustomFields,
      sectionCustomFields: !!section.sectionCustomFields,
    }));
  }, [contractData, templateSupportedSections]);

  const customizableSections = sUseMemo(() => sectionControls.filter((section) => section.supported), [sectionControls]);
  const unsupportedSections = sUseMemo(() => sectionControls.filter((section) => !section.supported), [sectionControls]);
  const allowedSectionIds = sUseMemo(() => customizableSections.map((section) => section.id), [customizableSections]);
  const sectionLabelById = sUseMemo(() => {
    const map = {};
    sectionControls.forEach((section) => { map[section.id] = section.label; });
    return map;
  }, [sectionControls]);

  /* Unknown or template-unsupported ids are dropped before persisting so the
     backend never receives settings it will reject. If the contract is
     unavailable the stored draft is passed through unchanged. */
  const sanitizeSectionIds = sUseCallback((ids) => {
    const source = Array.isArray(ids) ? ids : [];
    if (!allowedSectionIds.length) return source.slice();
    const next = [];
    source.forEach((id) => {
      if (allowedSectionIds.indexOf(id) !== -1 && next.indexOf(id) === -1) next.push(id);
    });
    return next;
  }, [allowedSectionIds]);

  const draftSummarySections = (previewData && previewData.summary && previewData.summary.draft && Array.isArray(previewData.summary.draft.sections))
    ? previewData.summary.draft.sections
    : [];
  const activeSummarySections = (previewData && previewData.summary && previewData.summary.active && Array.isArray(previewData.summary.active.sections))
    ? previewData.summary.active.sections
    : [];
  const draftSummaryById = sUseMemo(() => {
    const map = {};
    draftSummarySections.forEach((section) => { map[section.id] = section; });
    return map;
  }, [draftSummarySections]);
  const activeSummaryById = sUseMemo(() => {
    const map = {};
    activeSummarySections.forEach((section) => { map[section.id] = section; });
    return map;
  }, [activeSummarySections]);
  const liveRevisionNumber = (previewData && previewData.activeRevision && previewData.activeRevision.revisionNumber) || activeRevisionNumber;

  const readinessSections = sUseMemo(() => sectionControls.map((section) => {
    const draft = draftSummaryById[section.id];
    const active = activeSummaryById[section.id];
    return {
      ...section,
      summaryAvailable: !!draft,
      savedCount: draft ? draft.savedCount : null,
      countKind: draft ? draft.countKind : 'records',
      saved: draft ? draft.saved : null,
      enabled: visibleSections.indexOf(section.id) !== -1,
      inActiveRevision: !!active && active.savedCount > 0,
      liveOnPublishedPage: !!active && active.savedCount > 0 && active.enabled,
    };
  }), [sectionControls, draftSummaryById, activeSummaryById, visibleSections]);

  const enabledSectionLabels = sUseMemo(
    () => visibleSections.map((id) => sectionLabelById[id]).filter(Boolean),
    [visibleSections, sectionLabelById]
  );
  const enabledMissingContent = sUseMemo(
    () => readinessSections.filter((section) => section.enabled && section.saved === false),
    [readinessSections]
  );
  const draftSummaryAvailable = !!(previewData && previewData.summary && previewData.summary.draft);
  const activePublishedSectionCount = sUseMemo(
    () => activeSummarySections.filter((section) => section.saved && section.enabled).length,
    [activeSummarySections]
  );
  const publishSummarySections = sUseMemo(
    () => draftSummarySections.filter((section) => section.saved || visibleSections.indexOf(section.id) !== -1),
    [draftSummarySections, visibleSections]
  );
  const customizationDirty = sUseMemo(() => {
    const saved = config && config.customization;
    if (!saved) return false;
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    return (saved.themeMode || 'system') !== themeMode ||
      (saved.accentColor || '#3b82f6') !== accentColor ||
      !same(Array.isArray(saved.visibleSections) ? saved.visibleSections : [], visibleSections) ||
      !same(Array.isArray(saved.sectionOrder) ? saved.sectionOrder : [], sectionOrder);
  }, [config, themeMode, accentColor, visibleSections, sectionOrder]);

  /* ---------------- Loading State ---------------- */
  if (loading) {
    return (
      <div style={{ display: 'grid', gap: 24, maxWidth: 1040 }}>
        <div>
          <Skeleton w={140} h={16} />
          <Skeleton w={320} h={36} style={{ margin: '8px 0 10px' }} />
          <Skeleton w={480} h={16} />
        </div>
        <div className="glass" style={{ padding: 32, borderRadius: 24, display: 'grid', gap: 20 }}>
          <Skeleton w="100%" h={120} />
          <Skeleton w="100%" h={180} />
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 28, maxWidth: 1060 }}>
      {/* Page Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
        <div>
          <span className="eyebrow" style={{ color: 'var(--accent)', fontSize: 12 }}>
            {identityLabel.toUpperCase()} WEBSITE
          </span>
          <h1 className="h-card" style={{ fontSize: 32, margin: '4px 0 6px', letterSpacing: '-0.02em' }}>
            {identityHeading}
          </h1>
          <p className="muted" style={{ fontSize: 15, margin: 0, maxWidth: 640 }}>
            {identityDescription}
          </p>
        </div>

        {/* Global Action Group */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Button
            size="sm"
            variant="glass"
            icon={<WebsiteIcons.preview />}
            onClick={handleOpenPreview}
          >
            Preview Draft
          </Button>
          <Button
            size="sm"
            variant="primary"
            icon={<WebsiteIcons.publish />}
            onClick={() => setPublishModalOpen(true)}
          >
            {isPublished ? 'Republish Changes' : 'Publish Website'}
          </Button>
        </div>
      </div>

      {/* Sub-Navigation Tabs */}
      <div
        className="glass"
        style={{
          display: 'inline-flex',
          gap: 6,
          padding: 6,
          borderRadius: 16,
          width: 'fit-content',
          border: '1px solid var(--line)',
        }}
      >
        {[
          { id: 'overview', label: 'Overview', icon: <WebsiteIcons.overview /> },
          { id: 'templates', label: 'Templates', icon: <WebsiteIcons.templates /> },
          { id: 'customize', label: 'Customize', icon: <WebsiteIcons.customize /> },
          { id: 'publish-history', label: 'Publish & History', icon: <WebsiteIcons.history /> },
        ].map((tab) => {
          const active = subTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setSubTab(tab.id)}
              className="tab"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 18px',
                borderRadius: 12,
                border: active ? '1px solid var(--accent)' : '1px solid transparent',
                background: active ? 'color-mix(in oklab, var(--accent) 15%, transparent)' : 'transparent',
                color: active ? 'var(--text-1)' : 'var(--text-2)',
                fontSize: 14,
                fontWeight: active ? 600 : 500,
                cursor: 'pointer',
                transition: 'all .2s ease',
              }}
            >
              {tab.icon}
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* =========================================================================
          TAB 1: OVERVIEW
          ========================================================================= */}
      {subTab === 'overview' && (
        <div style={{ display: 'grid', gap: 24 }}>
          {/* Quick Setup Card if no handle claimed yet */}
          {!config?.username && (
            <div
              className="glass"
              style={{
                padding: '20px 24px',
                borderRadius: 20,
                border: '1.5px solid var(--accent)',
                background: 'color-mix(in oklab, var(--accent) 8%, transparent)',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 16,
              }}
            >
              <div>
                <span className="eyebrow" style={{ color: 'var(--accent)', fontSize: 11 }}>QUICK SETUP</span>
                <h4 style={{ fontSize: 18, margin: '2px 0 4px', fontWeight: 600 }}>Choose your Public Website Handle</h4>
                <p className="muted" style={{ fontSize: 13, margin: 0 }}>
                  Claim your unique handle before publishing. Your website will be live at <code>onevue.me/p/{desiredUsername || 'yourname'}</code>.
                </p>
              </div>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span className="mono muted" style={{ fontSize: 13 }}>/p/</span>
                  <input
                    className="input"
                    value={desiredUsername}
                    placeholder="e.g. yourname"
                    onChange={(e) => setDesiredUsername(e.target.value.toLowerCase().trim())}
                    style={{ width: 170, height: 40, padding: '0 12px', fontSize: 13 }}
                  />
                </div>
                <Button size="sm" variant="primary" loading={claimingUsername} onClick={handleClaimUsername}>
                  Claim Handle
                </Button>
              </div>
            </div>
          )}

          {/* Status & Live URL Banner Card */}
          <div
            className="glass"
            style={{
              padding: 28,
              borderRadius: 24,
              border: '1px solid var(--line)',
              display: 'grid',
              gap: 22,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 14 }}>
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                  <span className="field-label" style={{ margin: 0, textTransform: 'uppercase', letterSpacing: '0.05em', fontSize: 11 }}>
                    Website Publication Status
                  </span>
                  {/* Truthful Status Badge */}
                  {!username ? (
                    <span className="badge" style={{ background: 'color-mix(in oklab, var(--text-3) 20%, transparent)', color: 'var(--text-2)' }}>
                      No Handle Claimed
                    </span>
                  ) : !isPublished ? (
                    <span className="badge" style={{ background: 'color-mix(in oklab, #3b82f6 15%, transparent)', color: '#3b82f6', border: '1px solid #3b82f6' }}>
                      Draft / Not Published
                    </span>
                  ) : hasChangesAwaitingPublication ? (
                    <span className="badge" style={{ background: 'color-mix(in oklab, #f59e0b 15%, transparent)', color: '#f59e0b', border: '1px solid #f59e0b' }}>
                      <WebsiteIcons.alert style={{ marginRight: 4 }} /> Changes Awaiting Publication
                    </span>
                  ) : (
                    <span className="badge badge-verified" style={{ border: '1px solid var(--accent)' }}>
                      <WebsiteIcons.check style={{ marginRight: 4 }} /> Published & Active
                    </span>
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
                  <h3 style={{ fontSize: 22, margin: 0, fontWeight: 600 }}>
                    {username ? `onevue.me/p/${username}` : 'No Public Handle Set'}
                  </h3>
                  {isPublished && liveRevisionNumber && (
                    <span className="mono" style={{ fontSize: 13, color: 'var(--text-2)' }}>
                      (Revision #{liveRevisionNumber})
                    </span>
                  )}
                </div>

                {isPublished && config?.publishedAt && (
                  <span className="muted" style={{ fontSize: 13, display: 'block', marginTop: 4 }}>
                    Last published: {new Date(config.publishedAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                  </span>
                )}
                {isPublished && liveRevisionNumber && draftSummaryAvailable && (
                  <span className="muted" style={{ fontSize: 13, display: 'block', marginTop: 4 }}>
                    Revision #{liveRevisionNumber} serves {activePublishedSectionCount} section{activePublishedSectionCount === 1 ? '' : 's'} with published content.
                    Draft readiness below is not live until you republish.
                  </span>
                )}
                {!isPublished && username && (
                  <span className="muted" style={{ fontSize: 13, display: 'block', marginTop: 4 }}>
                    Your public website is configured as a draft. Click Publish below to make it live.
                  </span>
                )}
              </div>

              {/* Action Buttons for URL */}
              <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                {publicPortfolioUrl && isPublished ? (
                  <>
                    <Button
                      size="sm"
                      variant="glass"
                      icon={<WebsiteIcons.external />}
                      onClick={() => window.open(publicPortfolioUrl, '_blank')}
                    >
                      Open Live Site
                    </Button>
                    <Button
                      size="sm"
                      variant="primary"
                      icon={<WebsiteIcons.copy />}
                      onClick={async () => {
                        await copyText(publicPortfolioUrl);
                        toast.push({ title: 'Link copied', body: publicPortfolioUrl, tone: 'success' });
                      }}
                    >
                      Copy URL
                    </Button>
                  </>
                ) : (
                  <Button
                    size="sm"
                    variant="glass"
                    onClick={() => {
                      const defaultName = (session?.user?.username || session?.user?.name || session?.user?.identity || 'user')
                        .toLowerCase()
                        .replace(/[^a-z0-9_-]/g, '');
                      setDesiredUsername(defaultName);
                      setClaimUsernameOpen(true);
                    }}
                  >
                    {username ? 'Change Handle' : 'Claim Handle'}
                  </Button>
                )}
              </div>
            </div>

            {/* Quick Overview Metrics Grid */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
                gap: 16,
                paddingTop: 18,
                borderTop: '1px solid var(--line)',
              }}
            >
              <div style={{ padding: '14px 18px', borderRadius: 16, background: 'color-mix(in oklab, var(--bg-0) 40%, transparent)', border: '1px solid var(--line)' }}>
                <span className="field-hint" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>SELECTED TEMPLATE</span>
                <strong style={{ fontSize: 15, display: 'block', color: 'var(--text-1)' }}>
                  {activeTemplate.name}
                </strong>
                <span className="mono muted" style={{ fontSize: 12 }}>v{activeTemplate.version}</span>
              </div>

              <div style={{ padding: '14px 18px', borderRadius: 16, background: 'color-mix(in oklab, var(--bg-0) 40%, transparent)', border: '1px solid var(--line)' }}>
                <span className="field-hint" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>PUBLICLY ENABLED SECTIONS</span>
                <strong style={{ fontSize: 15, display: 'block', color: 'var(--text-1)' }}>
                  {sectionControls.length ? `${enabledSectionLabels.length} of ${sectionControls.length} enabled` : 'Section contract unavailable'}
                </strong>
                <span className="muted" style={{ fontSize: 12 }}>
                  {enabledSectionLabels.length
                    ? `${enabledSectionLabels.slice(0, 3).join(', ')}${enabledSectionLabels.length > 3 ? '…' : ''}`
                    : 'No sections are enabled for public display.'}
                </span>
              </div>

              <div style={{ padding: '14px 18px', borderRadius: 16, background: 'color-mix(in oklab, var(--bg-0) 40%, transparent)', border: '1px solid var(--line)' }}>
                <span className="field-hint" style={{ fontSize: 12, display: 'block', marginBottom: 4 }}>TEMPLATE COMPATIBILITY</span>
                <strong style={{ fontSize: 15, display: 'block', color: 'var(--text-1)' }}>
                  {sectionControls.length
                    ? `${customizableSections.length} of ${sectionControls.length} sections supported`
                    : 'Not available'}
                </strong>
                <span className="muted" style={{ fontSize: 12 }}>
                  {unsupportedSections.length
                    ? `Not rendered by ${activeTemplate.name}: ${unsupportedSections.map((section) => section.label).join(', ')}`
                    : `All sections for your ${identityLabel.toLowerCase()} identity fit this template.`}
                </span>
              </div>
            </div>
          </div>

          {/* Selected Template Spotlight Card */}
          <div
            className="glass"
            style={{
              padding: 28,
              borderRadius: 24,
              border: '1px solid var(--line)',
              display: 'grid',
              gap: 20,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 14 }}>
              <div>
                <span className="eyebrow" style={{ color: 'var(--accent)', fontSize: 11 }}>ACTIVE DESIGN SYSTEM</span>
                <h3 style={{ fontSize: 20, margin: '4px 0 6px' }}>Current Template: {activeTemplate.name}</h3>
                <p className="muted" style={{ fontSize: 14, margin: 0, maxWidth: 560 }}>
                  {activeTemplate.description || activeTemplate.tagline}
                </p>
              </div>

              <div style={{ display: 'flex', gap: 10 }}>
                <Button
                  size="sm"
                  variant="glass"
                  onClick={() => setSubTab('templates')}
                >
                  Gallery
                </Button>
                <Button
                  size="sm"
                  variant="glass"
                  onClick={() => setSubTab('customize')}
                >
                  Customize
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  icon={<WebsiteIcons.preview />}
                  onClick={handleOpenPreview}
                >
                  Preview Data
                </Button>
              </div>
            </div>

            {/* Template Features Pills */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {(activeTemplate.features || [
                activeTemplate.presentation && activeTemplate.presentation.sectionVisibility ? "Section visibility" : "",
                activeTemplate.presentation && activeTemplate.presentation.sectionOrder ? "Section order" : "",
                activeTemplate.media && activeTemplate.media.images ? "Single images" : "",
              ].filter(Boolean)).map((feat, idx) => (
                <span
                  key={idx}
                  style={{
                    padding: '5px 12px',
                    borderRadius: 999,
                    background: 'color-mix(in oklab, var(--bg-0) 50%, transparent)',
                    border: '1px solid var(--line)',
                    fontSize: 12,
                    color: 'var(--text-2)',
                  }}
                >
                  ✓ {feat}
                </span>
              ))}
            </div>
          </div>

          {/* Identity Content Readiness & Status Card */}
          <div
            className="glass"
            style={{
              padding: 24,
              borderRadius: 24,
              border: '1px solid var(--line)',
              display: 'grid',
              gap: 16,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
              <div>
                <span className="eyebrow" style={{ color: 'var(--accent)', fontSize: 11 }}>IDENTITY DATA STATUS</span>
                <h3 style={{ fontSize: 18, margin: '4px 0 2px' }}>{readinessTitle}</h3>
                <p className="muted" style={{ fontSize: 13, margin: 0 }}>
                  Saved records from your {identityLabel.toLowerCase()} identity. A section appears publicly only when it has saved content, is enabled here, and is supported by the selected template.
                </p>
              </div>
              <Button
                size="sm"
                variant="glass"
                onClick={() => navigate(identityPagePath)}
              >
                Edit {identityPageLabel} →
              </Button>
            </div>

            {sectionControls.length === 0 ? (
              <EmptyState
                title="Section contract unavailable"
                body="The website section contract could not be loaded. Reload the page before changing visibility or publishing."
              />
            ) : (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 12 }}>
                  {readinessSections.map((item) => {
                    const countLabel = item.savedCount === null
                      ? 'Readiness not loaded'
                      : item.countKind === 'fields'
                        ? `${item.savedCount} saved field${item.savedCount === 1 ? '' : 's'}`
                        : `${item.savedCount} saved record${item.savedCount === 1 ? '' : 's'}`;
                    const badges = [];
                    if (item.saved !== null) {
                      badges.push({ label: item.saved ? 'Saved' : 'Empty', tone: item.saved ? 'ok' : 'muted' });
                    }
                    badges.push({ label: item.enabled ? 'Enabled for public' : 'Hidden', tone: item.enabled ? 'ok' : 'muted' });
                    badges.push({ label: item.supported ? 'Template-ready' : 'Not supported by template', tone: item.supported ? 'ok' : 'warn' });
                    if (isPublished) {
                      badges.push({
                        label: item.liveOnPublishedPage
                          ? `Live in revision #${liveRevisionNumber}`
                          : item.inActiveRevision
                            ? `In revision #${liveRevisionNumber}, hidden`
                            : 'Not in live revision',
                        tone: item.liveOnPublishedPage ? 'ok' : 'muted',
                      });
                    } else {
                      badges.push({ label: 'No live revision', tone: 'muted' });
                    }
                    return (
                      <div
                        key={item.id}
                        style={{
                          padding: '12px 16px',
                          borderRadius: 14,
                          background: item.liveOnPublishedPage
                            ? 'color-mix(in oklab, var(--accent) 8%, transparent)'
                            : 'color-mix(in oklab, var(--bg-0) 40%, transparent)',
                          border: item.liveOnPublishedPage ? '1px solid var(--accent)' : '1px solid var(--line)',
                          display: 'grid',
                          gap: 8,
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
                          <strong style={{ fontSize: 14 }}>{item.label}</strong>
                          <span className="mono muted" style={{ fontSize: 11 }}>{countLabel}</span>
                        </div>
                        {item.description ? (
                          <span className="muted" style={{ fontSize: 12 }}>{item.description}</span>
                        ) : null}
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          {badges.map((badge, index) => (
                            <span
                              key={index}
                              className={badge.tone === 'ok' ? 'badge badge-verified' : 'badge'}
                              style={{
                                fontSize: 10,
                                ...(badge.tone === 'warn'
                                  ? { color: '#f59e0b', border: '1px solid rgba(245, 158, 11, 0.4)' }
                                  : {}),
                              }}
                            >
                              {badge.label}
                            </span>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {enabledMissingContent.length > 0 && (
                  <div
                    style={{
                      padding: '12px 16px',
                      borderRadius: 14,
                      background: 'color-mix(in oklab, #f59e0b 12%, transparent)',
                      border: '1px solid rgba(245, 158, 11, 0.3)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      fontSize: 13,
                      flexWrap: 'wrap',
                      gap: 10,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 18 }}>💡</span>
                      <span>
                        <strong>{enabledMissingContent.map((section) => section.label).join(', ')}</strong>
                        {enabledMissingContent.length === 1 ? ' is' : ' are'} enabled but {enabledMissingContent.length === 1 ? 'has' : 'have'} no saved content, so {enabledMissingContent.length === 1 ? 'it is' : 'they are'} omitted from the published page. Add content in your {identityPageLabel}.
                      </span>
                    </div>
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={() => navigate(identityPagePath)}
                    >
                      Edit {identityPageLabel} →
                    </Button>
                  </div>
                )}

                {unsupportedSections.length > 0 && (
                  <div
                    style={{
                      padding: '12px 16px',
                      borderRadius: 14,
                      background: 'color-mix(in oklab, var(--bg-0) 40%, transparent)',
                      border: '1px solid var(--line)',
                      fontSize: 13,
                      color: 'var(--text-2)',
                    }}
                  >
                    <strong style={{ color: 'var(--text-1)' }}>Not rendered by {activeTemplate.name}:</strong>{' '}
                    {unsupportedSections.map((section) => section.label).join(', ')}. This content stays saved on your identity; it is not deleted.
                  </div>
                )}

                {!draftSummaryAvailable && (
                  <div className="muted" style={{ fontSize: 12 }}>
                    Readiness counts appear once your saved identity data loads. Counts are never inferred from the template.
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* =========================================================================
          TAB 2: TEMPLATES (GALLERY)
          ========================================================================= */}
      {subTab === 'templates' && (
        <div style={{ display: 'grid', gap: 24 }}>
          <div>
            <h3 style={{ fontSize: 22, margin: '0 0 6px' }}>Template Gallery</h3>
            <p className="muted" style={{ fontSize: 14, margin: 0 }}>
              The registry currently contains one test adapter. Choosing it does not delete profile content the adapter cannot display.
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 24 }}>
            {templates.map((tmpl) => {
              const isSelected = config?.selectedTemplateId === tmpl.id;
              const isCurrentlyPublished = isPublished && history.some((h) => h.isActive && h.templateId === tmpl.id);

              return (
                <div
                  key={tmpl.id}
                  className="glass"
                  style={{
                    borderRadius: 24,
                    overflow: 'hidden',
                    border: isSelected ? '2px solid var(--accent)' : '1px solid var(--line)',
                    display: 'flex',
                    flexDirection: 'column',
                    transition: 'border-color .2s ease',
                  }}
                >
                  {/* Representative Visual Mockup Preview */}
                  <div
                    style={{
                      height: 200,
                      background: 'linear-gradient(135deg, #090d16 0%, #151e32 100%)',
                      padding: 20,
                      position: 'relative',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                      borderBottom: '1px solid var(--line)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span className="mono" style={{ fontSize: 11, color: '#3b82f6', background: 'rgba(59,130,246,0.15)', padding: '3px 8px', borderRadius: 6 }}>
                        NEXT.JS SSR
                      </span>
                      <div style={{ display: 'flex', gap: 6 }}>
                        {isSelected && (
                          <span className="badge badge-verified" style={{ fontSize: 11, padding: '2px 8px', height: 22 }}>
                            Selected
                          </span>
                        )}
                        {isCurrentlyPublished && (
                          <span className="badge" style={{ fontSize: 11, padding: '2px 8px', height: 22, background: 'rgba(16,185,129,0.2)', color: '#10b981', border: '1px solid #10b981' }}>
                            Live on Site
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Miniature UI Card Mockup */}
                    <div
                      style={{
                        background: 'rgba(255,255,255,0.04)',
                        border: '1px solid rgba(255,255,255,0.08)',
                        borderRadius: 14,
                        padding: 12,
                        backdropFilter: 'blur(8px)',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                        <div style={{ width: 28, height: 28, borderRadius: '50%', background: accentColor }} />
                        <div>
                          <div style={{ width: 80, height: 8, borderRadius: 4, background: 'rgba(255,255,255,0.7)', marginBottom: 4 }} />
                          <div style={{ width: 120, height: 6, borderRadius: 3, background: 'rgba(255,255,255,0.3)' }} />
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <div style={{ flex: 1, height: 24, borderRadius: 6, background: 'rgba(255,255,255,0.06)' }} />
                        <div style={{ flex: 1, height: 24, borderRadius: 6, background: 'rgba(255,255,255,0.06)' }} />
                      </div>
                    </div>
                  </div>

                  {/* Template Meta & Info */}
                  <div style={{ padding: 24, display: 'grid', gap: 16, flex: 1 }}>
                    <div>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                        <h4 style={{ fontSize: 18, margin: '0 0 4px', fontWeight: 600 }}>{tmpl.name}</h4>
                        <span className="mono muted" style={{ fontSize: 12 }}>v{tmpl.version}</span>
                      </div>
                      <p className="muted" style={{ fontSize: 13, margin: 0, lineHeight: 1.5 }}>
                        {tmpl.description || tmpl.tagline}
                      </p>
                    </div>

                    {/* Supported Sections Pills */}
                    <div>
                      <span className="field-hint" style={{ fontSize: 11, display: 'block', marginBottom: 6 }}>SUPPORTED SECTIONS</span>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {tmpl.supportedSections.map((sec) => (
                          <span
                            key={sec}
                            style={{
                              padding: '2px 8px',
                              borderRadius: 6,
                              background: 'color-mix(in oklab, var(--bg-0) 50%, transparent)',
                              border: '1px solid var(--line)',
                              fontSize: 11,
                              color: 'var(--text-2)',
                              textTransform: 'capitalize',
                            }}
                          >
                            {sec}
                          </span>
                        ))}
                      </div>
                    </div>
                    {Array.isArray(tmpl.limits) && tmpl.limits.length > 0 ? (
                      <ul className="muted" style={{ margin: 0, paddingLeft: 18, fontSize: 12, display: 'grid', gap: 4 }}>
                        {tmpl.limits.map((limit) => <li key={limit}>{limit}</li>)}
                      </ul>
                    ) : null}

                    {/* Action Bar */}
                    <div style={{ display: 'flex', gap: 10, marginTop: 'auto', paddingTop: 12, borderTop: '1px solid var(--line)' }}>
                      <Button
                        size="sm"
                        variant="glass"
                        block
                        icon={<WebsiteIcons.preview />}
                        onClick={handleOpenPreview}
                      >
                        Preview
                      </Button>
                      <Button
                        size="sm"
                        variant={isSelected ? 'glass' : 'primary'}
                        block
                        disabled={isSelected || selectingTemplate}
                        onClick={() => handleSelectTemplate(tmpl.id, tmpl.version)}
                      >
                        {isSelected ? 'Selected' : 'Select Template'}
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {templates.length === 0 ? (
            <div className="glass" style={{ padding: 20, borderRadius: 18, border: '1px solid var(--line)', fontSize: 13, color: 'var(--text-2)' }}>
              No approved templates are available. The template registry could not be reached, so no template is being advertised.
            </div>
          ) : null}

          <div
            className="glass"
            style={{
              padding: 20,
              borderRadius: 18,
              border: '1px solid var(--line)',
              fontSize: 13,
              color: 'var(--text-2)',
            }}
          >
            <strong style={{ color: 'var(--text-1)' }}>Registry Notice:</strong> Only templates registered by the backend are listed. Changing templates keeps content that the current adapter cannot render; it is never deleted.
          </div>
        </div>
      )}

      {/* =========================================================================
          TAB 3: CUSTOMIZE
          ========================================================================= */}
      {subTab === 'customize' && (
        <div style={{ display: 'grid', gap: 24 }}>
          <div>
            <h3 style={{ fontSize: 22, margin: '0 0 6px' }}>Customize Website Sections</h3>
              <p className="muted" style={{ fontSize: 14, margin: 0 }}>
              Choose which {identityLabel.toLowerCase()} sections appear and the order they use. Only sections supported by {activeTemplate.name} are listed. These choices stay in the draft until you publish.
            </p>
          </div>

          <div
            className="glass"
            style={{
              padding: 28,
              borderRadius: 24,
              border: '1px solid var(--line)',
              display: 'grid',
              gap: 28,
            }}
          >
            {/* Visible Sections Checklist */}
            <div>
              <div style={{ marginBottom: 12 }}>
                <label className="field-label" style={{ fontSize: 14, margin: 0, display: 'block' }}>
                  Publicly Enabled Sections
                </label>
                <span className="muted" style={{ fontSize: 13 }}>
                  {customizableSections.length
                    ? `${customizableSections.length} sections from your ${identityLabel.toLowerCase()} identity can be enabled here.`
                    : 'No sections for this identity are supported by the selected template.'}
                </span>
              </div>

              {customizableSections.length ? (
                <EditorSectionVisibility
                  sections={customizableSections}
                  selected={visibleSections}
                  onChange={setVisibleSections}
                />
              ) : (
                <EmptyState
                  title="No compatible sections"
                  body="The selected template does not render any sections for this identity. Choose another registered template or review the template limits below."
                />
              )}
            </div>

            {activeTemplate && activeTemplate.presentation && activeTemplate.presentation.sectionOrder && customizableSections.length ? (
              <div style={{ borderTop: '1px solid var(--line)', paddingTop: 20 }}>
                <label className="field-label" style={{ fontSize: 14, margin: '0 0 8px', display: 'block' }}>
                  Section order
                </label>
                <p className="muted" style={{ fontSize: 12, margin: '0 0 12px' }}>
                  Reorder the sections available to your identity and this template. Entry order inside each section is saved on the profile.
                </p>
                <EditorSectionOrder
                  sections={customizableSections}
                  order={sectionOrder}
                  disabled={savingCustomization}
                  onChange={setSectionOrder}
                />
              </div>
            ) : null}

            {unsupportedSections.length > 0 && (
              <div style={{ borderTop: '1px solid var(--line)', paddingTop: 20 }}>
                <p className="field-label" style={{ marginTop: 0 }}>Not supported by {activeTemplate.name}</p>
                <p className="muted" style={{ margin: '0 0 8px', fontSize: 13 }}>
                  These sections are not offered or published by the current template. Their saved content stays on your identity and returns when a compatible template is selected.
                </p>
                <ul className="muted" style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                  {unsupportedSections.map((section) => <li key={section.id}>{section.label}</li>)}
                </ul>
              </div>
            )}

            {activeTemplate && Array.isArray(activeTemplate.limits) && activeTemplate.limits.length > 0 ? (
              <div style={{ borderTop: '1px solid var(--line)', paddingTop: 20 }}>
                <p className="field-label" style={{ marginTop: 0 }}>Template limits</p>
                <ul className="muted" style={{ margin: 0, paddingLeft: 18, fontSize: 13 }}>
                  {activeTemplate.limits.map((limit) => <li key={limit}>{limit}</li>)}
                </ul>
              </div>
            ) : null}

            {/* Save Customization Buttons */}
            <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', gap: 12, borderTop: '1px solid var(--line)', paddingTop: 20 }}>
              {customizationDirty && (
                <span className="badge" style={{ fontSize: 11, color: '#f59e0b', border: '1px solid rgba(245, 158, 11, 0.4)' }}>
                  Unsaved draft changes
                </span>
              )}
              <Button
                variant="glass"
                onClick={() => {
                  setThemeMode('system');
                  setAccentColor('#3b82f6');
                  setVisibleSections((contractData && contractData.defaultSections ? contractData.defaultSections.visible : []).filter((id) => allowedSectionIds.indexOf(id) !== -1));
                  setSectionOrder((contractData && contractData.defaultSections ? contractData.defaultSections.order : []).filter((id) => allowedSectionIds.indexOf(id) !== -1));
                }}
              >
                Reset to defaults
              </Button>
              <Button
                variant="primary"
                loading={savingCustomization}
                onClick={handleSaveCustomization}
              >
                Save Preferences
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          TAB 4: PUBLISH & HISTORY
          ========================================================================= */}
      {subTab === 'publish-history' && (
        <div style={{ display: 'grid', gap: 28 }}>
          {/* Explicit Publication Pre-Publish Card */}
          <div
            className="glass"
            style={{
              padding: 28,
              borderRadius: 24,
              border: '1px solid var(--line)',
              display: 'grid',
              gap: 20,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
              <div>
                <span className="eyebrow" style={{ color: 'var(--accent)', fontSize: 12 }}>
                  IMMUTABLE REVISION CONTROL
                </span>
                <h3 style={{ fontSize: 22, margin: '4px 0 6px' }}>Publish Your {identityLabel} Website</h3>
                <p className="muted" style={{ fontSize: 14, margin: 0, maxWidth: 580 }}>
                  Publishing takes an authenticated, immutable snapshot of your saved {identityLabel.toLowerCase()} identity data and website settings. Draft changes that were never saved are not included. The snapshot is permanently recorded and immediately served to visitors at your public URL.
                </p>
              </div>

              <Button
                size="lg"
                variant="primary"
                icon={<WebsiteIcons.publish />}
                onClick={() => setPublishModalOpen(true)}
              >
                {isPublished ? 'Publish New Revision' : 'Publish Initial Website'}
              </Button>
            </div>

            {/* Checklist summary */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: 14,
                padding: '16px 20px',
                borderRadius: 16,
                background: 'color-mix(in oklab, var(--bg-0) 40%, transparent)',
                border: '1px solid var(--line)',
              }}
            >
              <div>
                <span className="field-hint" style={{ fontSize: 11 }}>TEMPLATE</span>
                <span style={{ fontSize: 13, fontWeight: 600, display: 'block', color: 'var(--text-1)' }}>
                  {activeTemplate.name}
                </span>
              </div>
              <div>
                <span className="field-hint" style={{ fontSize: 11 }}>TARGET PUBLIC URL</span>
                <span className="mono" style={{ fontSize: 12, color: 'var(--accent)', display: 'block' }}>
                  {username ? `onevue.me/p/${username}` : 'Pending handle setup'}
                </span>
              </div>
              <div>
                <span className="field-hint" style={{ fontSize: 11 }}>ACTIVE LIVE REVISION</span>
                <span className="mono" style={{ fontSize: 13, fontWeight: 600, display: 'block', color: 'var(--text-1)' }}>
                  {liveRevisionNumber ? `Revision #${liveRevisionNumber} · ${activePublishedSectionCount} published section${activePublishedSectionCount === 1 ? '' : 's'}` : 'Unpublished (Draft)'}
                </span>
              </div>
              <div>
                <span className="field-hint" style={{ fontSize: 11 }}>DRAFT READINESS</span>
                <span style={{ fontSize: 12, color: 'var(--text-2)', display: 'block' }}>
                  {draftSummaryAvailable
                    ? `${readinessSections.filter((section) => section.saved && section.enabled && section.supported).length} of ${visibleSections.length} enabled sections have saved content`
                    : 'Saved content summary not loaded'}
                </span>
              </div>
              <div>
                <span className="field-hint" style={{ fontSize: 11 }}>SNAPSHOT POLICY</span>
                <span style={{ fontSize: 12, color: 'var(--text-2)', display: 'block' }}>
                  Immutable SHA-256
                </span>
              </div>
            </div>
          </div>

          {/* Publication Revisions History Table */}
          <div
            className="glass"
            style={{
              padding: 28,
              borderRadius: 24,
              border: '1px solid var(--line)',
              display: 'grid',
              gap: 18,
            }}
          >
            <div>
              <h3 style={{ fontSize: 20, margin: '0 0 4px' }}>Publication Revision History</h3>
              <p className="muted" style={{ fontSize: 14, margin: 0 }}>
                Every publication creates a versioned, immutable snapshot in MongoDB. You can roll back to any prior revision instantly.
              </p>
              {liveRevisionNumber && draftSummaryAvailable && (
                <p className="muted" style={{ fontSize: 13, margin: '6px 0 0' }}>
                  Revision #{liveRevisionNumber} currently includes {activePublishedSectionCount} section{activePublishedSectionCount === 1 ? '' : 's'} with content on the live page. Draft readiness in the Overview tab is not live until you publish a new revision.
                </p>
              )}
            </div>

            {history.length === 0 ? (
              <EmptyState
                title="No publications yet"
                body="Your revision history will appear here once you publish your website for the first time."
              />
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: 13 }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid var(--line)', color: 'var(--text-2)' }}>
                      <th style={{ padding: '12px 14px' }}>Revision</th>
                      <th style={{ padding: '12px 14px' }}>Status</th>
                      <th style={{ padding: '12px 14px' }}>Published At</th>
                      <th style={{ padding: '12px 14px' }}>Template</th>
                      <th style={{ padding: '12px 14px' }}>Checksum</th>
                      <th style={{ padding: '12px 14px', textAlign: 'right' }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.map((rev) => {
                      const isActive = rev.isActive || (activeRevisionId && rev.id === activeRevisionId);
                      return (
                        <tr
                          key={rev.id || rev.revisionNumber}
                          style={{
                            borderBottom: '1px solid var(--line)',
                            background: isActive ? 'color-mix(in oklab, var(--accent) 6%, transparent)' : 'transparent',
                          }}
                        >
                          <td style={{ padding: '14px', fontWeight: 600 }}>
                            Revision #{rev.revisionNumber}
                          </td>
                          <td style={{ padding: '14px' }}>
                            {isActive ? (
                              <span className="badge badge-verified" style={{ fontSize: 11 }}>
                                Active Live
                              </span>
                            ) : (
                              <span className="badge" style={{ fontSize: 11, color: 'var(--text-3)' }}>
                                Prior
                              </span>
                            )}
                          </td>
                          <td style={{ padding: '14px', color: 'var(--text-2)' }}>
                            {new Date(rev.publishedAt).toLocaleString(undefined, {
                              dateStyle: 'medium',
                              timeStyle: 'short',
                            })}
                          </td>
                          <td style={{ padding: '14px', color: 'var(--text-2)' }}>
                            {rev.templateId} <span className="mono muted">v{rev.templateVersion}</span>
                          </td>
                          <td style={{ padding: '14px' }}>
                            <span className="mono muted" style={{ fontSize: 11 }}>
                              {rev.checksum ? rev.checksum.slice(0, 10) + '...' : '—'}
                            </span>
                          </td>
                          <td style={{ padding: '14px', textAlign: 'right' }}>
                            {isActive ? (
                              <span className="muted" style={{ fontSize: 12 }}>Currently Live</span>
                            ) : (
                              <Button
                                size="sm"
                                variant="glass"
                                icon={<WebsiteIcons.rollback />}
                                onClick={() => setRollbackModalItem(rev)}
                              >
                                Rollback
                              </Button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL 1: PREVIEW WORKSPACE MODAL (Desktop & Mobile Viewport Switcher)
          ========================================================================= */}
      <Modal
        open={previewOpen}
        onClose={() => setPreviewOpen(false)}
        title="Website Preview"
      >
        <div style={{ display: 'grid', gap: 16, minWidth: 320 }}>
          {/* Header Controls */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <span className="eyebrow" style={{ color: 'var(--accent)', fontSize: 11 }}>WEBSITE DRAFT PREVIEW</span>
              <h3 style={{ fontSize: 20, margin: '2px 0 0' }}>{activeTemplate.name}</h3>
            </div>

            {/* Viewport Toggles */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
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
                  onClick={() => setPreviewViewport('desktop')}
                  className={'tab ' + (previewViewport === 'desktop' ? 'is-active' : '')}
                  style={{
                    padding: '5px 12px',
                    borderRadius: 8,
                    fontSize: 12,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    background: previewViewport === 'desktop' ? 'var(--primary)' : 'transparent',
                    color: previewViewport === 'desktop' ? 'var(--on-primary)' : 'var(--text-2)',
                    border: 0,
                    cursor: 'pointer',
                  }}
                >
                  <WebsiteIcons.desktop /> Desktop
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewViewport('mobile')}
                  className={'tab ' + (previewViewport === 'mobile' ? 'is-active' : '')}
                  style={{
                    padding: '5px 12px',
                    borderRadius: 8,
                    fontSize: 12,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    background: previewViewport === 'mobile' ? 'var(--primary)' : 'transparent',
                    color: previewViewport === 'mobile' ? 'var(--on-primary)' : 'var(--text-2)',
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
                onClick={() => window.open(`/#${basePath}/website/preview`, '_blank')}
              >
                Open in Separate Tab
              </Button>

              <Button
                size="sm"
                variant="primary"
                icon={<WebsiteIcons.publish />}
                onClick={() => {
                  setPreviewOpen(false);
                  setPublishModalOpen(true);
                }}
              >
                Publish Now
              </Button>
            </div>
          </div>

          {/* Draft Notice Banner */}
          <div
            style={{
              padding: '8px 14px',
              borderRadius: 10,
              background: 'color-mix(in oklab, #3b82f6 12%, transparent)',
              border: '1px solid rgba(59,130,246,0.3)',
              fontSize: 12,
              color: '#93c5fd',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <WebsiteIcons.alert />
            <span>
              <strong>PREVIEW MODE:</strong> Rendering your saved {identityLabel.toLowerCase()} identity data with the draft settings currently selected on this page. Sections you have hidden are excluded. This is <strong>not</strong> public until you publish.
            </span>
          </div>

          {/* Responsive Preview Frame */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              background: 'var(--bg-0)',
              borderRadius: 18,
              padding: '24px 16px',
              border: '1px solid var(--line)',
              maxHeight: '68vh',
              overflowY: 'auto',
            }}
          >
            {previewLoading ? (
              <div style={{ textAlign: 'center', padding: 48 }}>
                <span className="spin" style={{ width: 28, height: 28, display: 'inline-block', marginBottom: 12 }} />
                <p className="muted" style={{ fontSize: 14 }}>Rendering template preview with saved profile data...</p>
              </div>
            ) : (
              <div
                style={{
                  width: previewViewport === 'mobile' ? 380 : '100%',
                  maxWidth: previewViewport === 'mobile' ? 380 : 860,
                  borderRadius: previewViewport === 'mobile' ? 24 : 12,
                  border: previewViewport === 'mobile' ? '4px solid #334155' : '1px solid var(--line)',
                  boxShadow: '0 20px 50px rgba(0,0,0,0.5)',
                  background: themeMode === 'light' ? '#ffffff' : '#090d16',
                  color: themeMode === 'light' ? '#0f172a' : '#f8fafc',
                  overflow: 'hidden',
                  transition: 'width .25s ease',
                }}
              >
                {/* Browser chrome mockup bar */}
                <div
                  style={{
                    padding: '8px 14px',
                    background: themeMode === 'light' ? '#f1f5f9' : '#0e1424',
                    borderBottom: '1px solid rgba(255,255,255,0.06)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <div style={{ display: 'flex', gap: 5 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ef4444' }} />
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#f59e0b' }} />
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981' }} />
                  </div>
                  <div
                    className="mono"
                    style={{
                      flex: 1,
                      textAlign: 'center',
                      fontSize: 11,
                      color: 'var(--text-3)',
                      background: themeMode === 'light' ? '#ffffff' : 'rgba(255,255,255,0.05)',
                      borderRadius: 6,
                      padding: '2px 8px',
                    }}
                  >
                    https://onevue.me/p/{username || 'preview-draft'}
                  </div>
                </div>

                <PortfolioPreviewFrame
                  dto={previewData?.dto}
                  username={username}
                  customization={{ visibleSections: sanitizeSectionIds(visibleSections), accentColor, themeMode, sectionOrder: sanitizeSectionIds(sectionOrder) }}
                  templateId={activeTemplate ? activeTemplate.id : (config?.selectedTemplateId || 'magicui-portfolio')}
                  templateVersion={(activeTemplate && activeTemplate.version) || config?.selectedTemplateVersion}
                  height={previewViewport === 'mobile' ? 640 : 760}
                />
              </div>
            )}
          </div>
        </div>
      </Modal>

      {/* =========================================================================
          MODAL 2: CONFIRM PUBLISH DIALOG
          ========================================================================= */}
      <Modal
        open={publishModalOpen}
        onClose={() => setPublishModalOpen(false)}
        title="Confirm Publication"
      >
        <div style={{ display: 'grid', gap: 18, minWidth: 320 }}>
          <div>
            <span className="eyebrow" style={{ color: 'var(--accent)', fontSize: 11 }}>EXPLICIT ACTION</span>
            <h3 style={{ fontSize: 20, margin: '4px 0 6px' }}>Publish {identityLabel} Website?</h3>
            <p className="muted" style={{ fontSize: 14, margin: 0 }}>
              This saves the settings shown on this page, then creates a new immutable revision from your saved {identityLabel.toLowerCase()} identity data. The live website updates immediately.
            </p>
          </div>

          <div
            style={{
              padding: 16,
              borderRadius: 14,
              background: 'color-mix(in oklab, var(--bg-0) 50%, transparent)',
              border: '1px solid var(--line)',
              display: 'grid',
              gap: 8,
              fontSize: 13,
            }}
          >
            {/* Handle Display or Inline Claim */}
            {config?.username ? (
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span className="muted">Public Handle:</span>
                <span className="mono" style={{ color: 'var(--accent)' }}>@{config.username}</span>
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 6, padding: '10px 12px', borderRadius: 10, background: 'color-mix(in oklab, var(--accent) 10%, transparent)', border: '1px solid var(--accent)' }}>
                <label className="field-label" style={{ fontSize: 12, margin: 0, color: 'var(--text-1)' }}>
                  Choose your Public Handle to Publish:
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span className="mono muted" style={{ fontSize: 12 }}>onevue.me/p/</span>
                  <input
                    className="input"
                    value={desiredUsername}
                    placeholder="e.g. yourname"
                    onChange={(e) => setDesiredUsername(e.target.value.toLowerCase().trim())}
                    style={{ flex: 1, height: 34, padding: '0 8px', fontSize: 13 }}
                  />
                </div>
                <span className="field-hint" style={{ fontSize: 11, margin: 0 }}>
                  This will be your live website URL.
                </span>
              </div>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="muted">Template:</span>
              <span>{activeTemplate.name} v{activeTemplate.version}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="muted">Publicly enabled:</span>
              <span>{sanitizeSectionIds(visibleSections).length} of {sectionControls.length} sections</span>
            </div>
            {liveRevisionNumber ? (
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span className="muted">Currently live:</span>
                <span>Revision #{liveRevisionNumber} · {activePublishedSectionCount} section{activePublishedSectionCount === 1 ? '' : 's'} with content</span>
              </div>
            ) : null}

            {/* Identity Snapshot Data Summary */}
            <div
              style={{
                display: 'grid',
                gap: 6,
                padding: '10px 12px',
                borderRadius: 10,
                background: 'color-mix(in oklab, var(--bg-0) 60%, transparent)',
                border: '1px solid var(--line)',
                fontSize: 12,
              }}
            >
              <span className="field-hint" style={{ fontSize: 11, marginBottom: 2 }}>
                SAVED {identityLabel.toUpperCase()} CONTENT IN THIS DRAFT:
              </span>
              {publishSummarySections.length ? publishSummarySections.map((section) => {
                const enabled = visibleSections.indexOf(section.id) !== -1;
                const supported = section.templateSupported !== false;
                const countLabel = section.countKind === 'fields'
                  ? `${section.savedCount} saved field${section.savedCount === 1 ? '' : 's'}`
                  : `${section.savedCount} saved record${section.savedCount === 1 ? '' : 's'}`;
                return (
                  <div key={section.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
                    <span>{section.label}:</span>
                    <strong style={{ color: section.saved && enabled && supported ? 'inherit' : '#f59e0b', textAlign: 'right' }}>
                      {section.saved ? countLabel : 'No saved content'}
                      {!enabled ? ' · hidden' : ''}
                      {!supported ? ' · not rendered by this template' : ''}
                    </strong>
                  </div>
                );
              }) : (
                <span className="muted">
                  Saved content summary is unavailable. The revision still uses the data saved on your {identityLabel.toLowerCase()} identity.
                </span>
              )}
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 4 }}>
            <Button variant="glass" onClick={() => setPublishModalOpen(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={publishing}
              icon={<WebsiteIcons.publish />}
              onClick={handleConfirmPublish}
            >
              Confirm & Publish
            </Button>
          </div>
        </div>
      </Modal>

      {/* =========================================================================
          MODAL 3: CONFIRM ROLLBACK DIALOG
          ========================================================================= */}
      <Modal
        open={!!rollbackModalItem}
        onClose={() => setRollbackModalItem(null)}
        title="Confirm Rollback"
      >
        {rollbackModalItem && (
          <div style={{ display: 'grid', gap: 18, minWidth: 320 }}>
            <div>
              <span className="eyebrow" style={{ color: 'var(--accent)', fontSize: 11 }}>REVISION ROLLBACK</span>
              <h3 style={{ fontSize: 20, margin: '4px 0 6px' }}>
                Roll back to Revision #{rollbackModalItem.revisionNumber}?
              </h3>
              <p className="muted" style={{ fontSize: 14, margin: 0 }}>
                Your active live website at <code>onevue.me/p/{username}</code> will immediately revert to serving Revision #{rollbackModalItem.revisionNumber} (published on {new Date(rollbackModalItem.publishedAt).toLocaleDateString()}).
              </p>
            </div>

            <div
              style={{
                padding: 14,
                borderRadius: 14,
                background: 'color-mix(in oklab, #f59e0b 10%, transparent)',
                border: '1px solid rgba(245,158,11,0.3)',
                fontSize: 13,
                color: '#fcd34d',
              }}
            >
              Note: This changes your active public snapshot. Your current draft identity profile and customization settings will remain safe and untouched.
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 4 }}>
              <Button variant="glass" onClick={() => setRollbackModalItem(null)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                loading={rollingBack}
                icon={<WebsiteIcons.rollback />}
                onClick={handleConfirmRollback}
              >
                Confirm Rollback
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* =========================================================================
          MODAL 4: CLAIM / EDIT HANDLE DIALOG
          ========================================================================= */}
      <Modal
        open={claimUsernameOpen}
        onClose={() => setClaimUsernameOpen(false)}
        title="Claim Portfolio Handle"
      >
        <form onSubmit={handleClaimUsername} style={{ display: 'grid', gap: 18, minWidth: 320 }}>
          <div>
            <span className="eyebrow" style={{ color: 'var(--accent)', fontSize: 11 }}>HANDLE SETUP</span>
            <h3 style={{ fontSize: 20, margin: '4px 0 6px' }}>Choose your Public Handle</h3>
            <p className="muted" style={{ fontSize: 14, margin: 0 }}>
              Your website will be accessible at <code>onevue.me/p/yourhandle</code>. Letters, numbers, hyphens, and underscores only.
            </p>
          </div>

          <Input
            label="Portfolio Handle"
            value={desiredUsername}
            placeholder="e.g. alex.rivera"
            onChange={(e) => setDesiredUsername(e.target.value.toLowerCase().trim())}
            hint="Must be 3-30 characters."
            required
          />

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12, marginTop: 4 }}>
            <Button variant="glass" type="button" onClick={() => setClaimUsernameOpen(false)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" loading={claimingUsername}>
              Save Handle
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

window.CANONICAL_TEMPLATES = CANONICAL_TEMPLATES;
window.WebsiteIcons = WebsiteIcons;
window.StudentWebsitePage = StudentWebsitePage;
