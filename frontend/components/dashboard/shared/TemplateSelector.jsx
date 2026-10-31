/* Template selector component for identity page */
(function () {
  const { useState, useEffect } = React;

  function TemplateSelector({ currentTemplate, onTemplateSelect, disabled }) {
    const toast = useToast();
    const [templates, setTemplates] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [previewing, setPreviewing] = useState(null);
    const [showConfirm, setShowConfirm] = useState(null);

    useEffect(() => {
      loadTemplates();
    }, []);

    async function loadTemplates() {
      setLoading(true);
      setError(null);
      try {
        const base = window.OV.services?.site?.apiBaseUrl || "http://localhost:3000/api";
        const res = await fetch(`${base}/templates`);
        const data = await res.json();
        // The backend registry is authoritative. Only templates this dashboard
        // has a capability mirror for are offered; nothing else is advertised.
        const mirror = (window.OV && window.OV.createCustomize)
          ? window.OV.createCustomize.listTemplates().map((template) => template.id)
          : [];
        const approved = Array.isArray(data.templates) && data.success
          ? data.templates.filter((template) => mirror.indexOf(template.id) !== -1)
          : [];
        if (approved.length) {
          setTemplates(approved);
        } else if (mirror.length) {
          setTemplates(window.OV.createCustomize.listTemplates());
        } else {
          setTemplates([]);
          setError("Templates could not be loaded. Only approved templates are offered.");
        }
      } catch (err) {
        const fallback = window.OV && window.OV.createCustomize
          ? window.OV.createCustomize.listTemplates()
          : [];
        setTemplates(fallback);
        if (!fallback.length) setError(err.message || "Templates could not be loaded.");
      } finally {
        setLoading(false);
      }
    }

    function getTemplateStatus(template) {
      if (!template.presentation) return { accent: false, theme: false, hide: false, reorder: false };
      return {
        accent: !!template.presentation.accentColor,
        theme: !!template.presentation.themeMode,
        hide: !!template.presentation.sectionVisibility,
        reorder: !!template.presentation.sectionOrder
      };
    }

    function getMediaStatus(template) {
      if (!template.media) return { images: false, galleries: false, video: false };
      return {
        images: !!template.media.images,
        galleries: !!template.media.galleries,
        video: !!template.media.externalVideoUrl
      };
    }

    function handleSelectTemplate(template) {
      if (disabled) return;
      if (!template || !templates.some((item) => item.id === template.id)) {
        toast.push({
          title: 'Unsupported template',
          body: 'Only templates in the approved registry can be selected.',
          tone: 'error'
        });
        return;
      }

      if (currentTemplate && currentTemplate.id !== template.id) {
        // Show confirmation when switching away from MagicUI
        if (currentTemplate.id === "magicui-portfolio") {
          setPreviewing(template);
          setShowConfirm("magicui-switch");
          return;
        }
      }

      onTemplateSelect(template);
    }

    async function handleConfirmSwitch() {
      if (!previewing) return;

      try {
        onTemplateSelect(previewing);
        toast.push({
          title: 'Template Updated',
          body: `Switched to ${previewing.name}. Custom fields will be filtered based on template capabilities.`,
          tone: 'success'
        });
      } catch (err) {
        toast.push({
          title: 'Update Failed',
          body: err.message || 'Could not update template.',
          tone: 'error'
        });
      } finally {
        setPreviewing(null);
        setShowConfirm(null);
      }
    }

    return (
      <div className="glass" style={{ padding: 24, borderRadius: 20 }}>
        <div style={{ marginBottom: 20 }}>
          <h3 style={{ fontSize: 18, margin: 0 }}>Portfolio Template</h3>
          <p className="muted" style={{ margin: '4px 0 0', fontSize: 13.5 }}>
            Choose how your public portfolio will look. Some custom fields may be hidden based on template capabilities.
          </p>
        </div>

        {error && (
          <div style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)', color: '#ef4444', padding: 12, borderRadius: 12, marginBottom: 16 }}>
            {error}
          </div>
        )}

        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: 'var(--text-2)' }}>
            <div className="spin" style={{ width: 20, height: 20, borderColor: 'currentColor' }} />
            <span style={{ fontSize: 13 }}>Loading templates...</span>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 12 }}>
            {templates.map((template) => {
              const selected = currentTemplate && currentTemplate.id === template.id;
              const media = getMediaStatus(template);
              const presentation = getTemplateStatus(template);

              return (
                <div key={template.id} style={{ display: 'grid', gap: 12 }}>
                  <button
                    type="button"
                    className="btn"
                    onClick={() => handleSelectTemplate(template)}
                    disabled={disabled}
                    style={{
                      display: 'flex',
                      alignItems: 'flex-start',
                      justifyContent: 'space-between',
                      textAlign: 'left',
                      padding: 16,
                      background: selected ? 'rgba(59,130,246,0.15)' : 'rgba(255,255,255,0.03)',
                      border: `2px solid ${selected ? 'var(--accent, #3b82f6)' : 'rgba(255,255,255,0.08)'}`,
                      borderRadius: 12,
                      transition: 'border 0.2s',
                      cursor: disabled ? 'not-allowed' : 'pointer'
                    }}
                  >
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <span style={{ fontSize: 15, fontWeight: 600 }}>{template.name}</span>
                        {selected && (
                          <span style={{ fontSize: 11, background: 'var(--accent, #3b82f6)', color: '#fff', padding: '2px 8px', borderRadius: 4 }}>
                            Current
                          </span>
                        )}
                        {template.role === 'test-adapter' && (
                          <span style={{ fontSize: 11, background: 'rgba(245,158,11,0.15)', color: '#f59e0b', padding: '2px 8px', borderRadius: 4 }}>
                            Test
                          </span>
                        )}
                      </div>
                      <p style={{ fontSize: 13, color: 'var(--text-2)', margin: '0 0 8px 0', lineHeight: 1.4 }}>
                        {template.description}
                      </p>

                      {/* Template Features */}
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                        {presentation.accent && (
                          <span className="badge" style={{ fontSize: 10, background: 'rgba(255,255,255,0.05)', color: 'var(--text-3)' }}>
                            Accent color
                          </span>
                        )}
                        {presentation.theme && (
                          <span className="badge" style={{ fontSize: 10, background: 'rgba(255,255,255,0.05)', color: 'var(--text-3)' }}>
                            Light/Dark mode
                          </span>
                        )}
                        {media.images && (
                          <span className="badge" style={{ fontSize: 10, background: 'rgba(255,255,255,0.05)', color: 'var(--text-3)' }}>
                            Images
                          </span>
                        )}
                        {media.galleries && (
                          <span className="badge" style={{ fontSize: 10, background: 'rgba(255,255,255,0.05)', color: 'var(--text-3)' }}>
                            Galleries
                          </span>
                        )}
                        {media.video && (
                          <span className="badge" style={{ fontSize: 10, background: 'rgba(255,255,255,0.05)', color: 'var(--text-3)' }}>
                            Video links
                          </span>
                        )}
                      </div>
                    </div>

                    {selected && (
                      <span style={{ fontSize: 20, color: 'var(--accent, #3b82f6)', marginLeft: 8 }}>✓</span>
                    )}
                  </button>

                  {/* Compatibility Warning for MagicUI → Other templates */}
                  {selected && currentTemplate?.id === "magicui-portfolio" && template.id === "magicui-portfolio" ? (
                    <div style={{ fontSize: 12, color: 'var(--text-3)', background: 'rgba(255,255,255,0.02)', padding: 8, borderRadius: 8 }}>
                      <strong>Current template</strong> — Supports all custom field types. Switching to another template may hide some fields on your public page.
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}

        {/* Confirmation Modal */}
        {showConfirm === "magicui-switch" && previewing && (
          <div className="scrim" style={{ zIndex: 9999, display: 'grid', placeItems: 'center', padding: 20 }}>
            <div className="glass" style={{ width: '100%', maxWidth: 460, padding: 24, borderRadius: 20, boxShadow: '0 24px 48px -12px var(--shade)' }}>
              <h3 style={{ fontSize: 18, margin: '0 0 8px 0', color: '#f59e0b' }}>
                Switch from Magic UI?
              </h3>
              <p style={{ fontSize: 13.5, margin: '0 0 20px 0', lineHeight: 1.5 }}>
                Magic UI supports <strong>all custom field types</strong>. {previewing.name} does not show:
              </p>

              <div style={{ marginBottom: 20 }}>
                {["image", "gallery", "file", "multiselect"].map((type) => (
                  <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#ef4444' }} />
                    <span style={{ fontSize: 12.5, color: 'var(--text-2)' }}>
                      {type === "multiselect" ? "Multiple choice dropdowns" : type === "gallery" ? "Image galleries" : type + " files"}
                    </span>
                  </div>
                ))}
              </div>

              <p style={{ fontSize: 13, margin: '0 0 20px 0', color: 'var(--text-2)' }}>
                <strong>Note:</strong> Hidden fields stay on your profile and remain editable.
              </p>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setPreviewing(null);
                    setShowConfirm(null);
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  onClick={handleConfirmSwitch}
                >
                  Switch to {previewing.name}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Information Footer */}
        <div style={{ marginTop: 20, paddingTop: 16, borderTop: '1px solid rgba(255,255,255,0.08)' }}>
          <p style={{ fontSize: 12, color: 'var(--text-3)', margin: 0, lineHeight: 1.5 }}>
            <strong>How custom fields work:</strong> You can add any field type on the identity page. The selected template determines which fields appear on your <strong>published portfolio</strong>. Hidden fields remain on your draft profile.
          </p>
        </div>
      </div>
    );
  }

  window.TemplateSelector = TemplateSelector;
})();