/* =========================================================================
   Creator Identity Page
   ========================================================================= */
function CreatorIdentityPage({ session, onSaved }) {
  return (
    <div style={{ display: 'grid', gap: 24 }}>
      <div>
        <span className="eyebrow" style={{ color: 'var(--accent)', fontSize: 12 }}>Domain Architecture</span>
        <h1 className="h-card" style={{ fontSize: 32, margin: '4px 0 6px' }}>Creator Identity</h1>
        <p className="muted" style={{ fontSize: 15, margin: 0 }}>
          Manage the content, channels, audience stats, and media kit that shape your media and brand views.
        </p>
      </div>

      <IdentityProfileEditor identity="creator" session={session} onSaved={onSaved} />
    </div>
  );
}
window.CreatorIdentityPage = CreatorIdentityPage;
