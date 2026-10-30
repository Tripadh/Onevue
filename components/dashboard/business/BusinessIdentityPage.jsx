/* =========================================================================
   Business Identity Page
   ========================================================================= */
function BusinessIdentityPage({ onSaved }) {
  return (
    <div style={{ display: 'grid', gap: 24 }}>
      <div>
        <span className="eyebrow" style={{ color: 'var(--accent)', fontSize: 12 }}>Domain Architecture</span>
        <h1 className="h-card" style={{ fontSize: 32, margin: '4px 0 6px' }}>Business Identity</h1>
        <p className="muted" style={{ fontSize: 15, margin: 0 }}>
          Manage the organization details, offerings, team, and public contacts that shape your enterprise and partner views.
        </p>
      </div>

      <IdentityProfileEditor identity="business" onSaved={onSaved} />
    </div>
  );
}
window.BusinessIdentityPage = BusinessIdentityPage;
