/* =========================================================================
   Freelancer Identity Page
   ========================================================================= */
function FreelancerIdentityPage({ onSaved }) {
  return (
    <div style={{ display: 'grid', gap: 24 }}>
      <div>
        <span className="eyebrow" style={{ color: 'var(--accent)', fontSize: 12 }}>Domain Architecture</span>
        <h1 className="h-card" style={{ fontSize: 32, margin: '4px 0 6px' }}>Freelancer Identity</h1>
        <p className="muted" style={{ fontSize: 15, margin: 0 }}>
          Manage the services, portfolio, testimonials, and availability that shape your client and pitch views.
        </p>
      </div>

      <IdentityProfileEditor identity="freelancer" onSaved={onSaved} />
    </div>
  );
}
window.FreelancerIdentityPage = FreelancerIdentityPage;
