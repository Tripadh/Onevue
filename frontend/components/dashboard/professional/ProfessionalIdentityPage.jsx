/* =========================================================================
   Professional Identity Page
   ========================================================================= */
function ProfessionalIdentityPage({ session, onSaved }) {
  return (
    <div style={{ display: 'grid', gap: 24 }}>
      <div>
        <span className="eyebrow" style={{ color: 'var(--accent)', fontSize: 12 }}>Domain Architecture</span>
        <h1 className="h-card" style={{ fontSize: 32, margin: '4px 0 6px' }}>Professional Identity</h1>
        <p className="muted" style={{ fontSize: 15, margin: 0 }}>
          Manage the experience, credentials, skills, and contact details that shape your recruiter and hiring views.
        </p>
      </div>

      <IdentityProfileEditor identity="professional" session={session} onSaved={onSaved} />
    </div>
  );
}
window.ProfessionalIdentityPage = ProfessionalIdentityPage;
