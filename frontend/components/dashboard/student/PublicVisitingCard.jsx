/* =========================================================================
   OneVue — Public Digital Visiting Card Page (Route: #/card/:username)
   Renders the frozen published card snapshot for recruiters & peers with
   an interactive 3D flip effect between Front and Back sides.
   ========================================================================= */

(function () {
  const { useState, useEffect } = React;
  const { useParams, Link } = ReactRouterDOM;

  function PublicVisitingCard() {
    const { username } = useParams();
    const [cardData, setCardData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [activeSide, setActiveSide] = useState('front'); // 'front' | 'back'
    const [isFlipped, setIsFlipped] = useState(false);
    const toast = useToast();

    useEffect(() => {
      async function fetchCard() {
        setLoading(true);
        setError(null);
        try {
          const res = await window.OV.services.visitingCard.getPublicCard(username);
          setCardData(res.card);
        } catch (err) {
          setError(err.message || 'Public visiting card not found or unpublished.');
        } finally {
          setLoading(false);
        }
      }
      if (username) fetchCard();
    }, [username]);

    const handleFlip = () => {
      const nextSide = activeSide === 'front' ? 'back' : 'front';
      setActiveSide(nextSide);
      setIsFlipped(!isFlipped);
    };

    if (loading) {
      return (
        <main className="wrap" style={{ minHeight: '80vh', display: 'grid', placeItems: 'center', paddingTop: 80 }}>
          <div style={{ textAlign: 'center' }}>
            <div className="spin" style={{ margin: '0 auto 16px', width: 32, height: 32 }} />
            <h3 className="h-card" style={{ fontSize: 18 }}>Retrieving verified visiting card...</h3>
          </div>
        </main>
      );
    }

    if (error || !cardData) {
      return (
        <main className="wrap" style={{ minHeight: '80vh', display: 'grid', placeItems: 'center', paddingTop: 80 }}>
          <GlassCard style={{ maxWidth: 440, padding: 36, textAlign: 'center' }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>🪪</div>
            <h2 className="h-card" style={{ fontSize: 22, margin: '0 0 8px 0' }}>Card Unavailable</h2>
            <p className="muted" style={{ fontSize: 14, margin: '0 0 24px 0', lineHeight: 1.5 }}>
              The digital visiting card for <strong>@{username}</strong> has not been published yet or is currently inactive.
            </p>
            <Link to="/" className="btn btn-primary">
              Explore OneVue
            </Link>
          </GlassCard>
        </main>
      );
    }

    const { design, user = {} } = cardData;
    const publicUrl = `onevue.id/card/${username}`;
    const isVertical = design?.dimensions?.orientation === 'vertical';

    return (
      <main className="wrap" style={{ minHeight: '85vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '50px 20px' }}>
        <div style={{ maxWidth: 900, width: '100%', display: 'grid', gap: 24, justifyItems: 'center' }}>
          {/* Header Brand Bar */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%', maxWidth: 740 }}>
            <Link to="/" style={{ display: 'flex', alignItems: 'center', gap: 10, textDecoration: 'none', color: 'inherit' }}>
              <div className="brand-mark" style={{ width: 22, height: 22 }}><span /></div>
              <span className="serif" style={{ fontSize: 20, fontWeight: 600 }}>OneVue Card</span>
            </Link>
            <span className="badge badge-verified" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Icon.seal width="12" height="12" /> Verified Profile
            </span>
          </div>

          {/* Interactive Flip Side Controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              onClick={handleFlip}
              className="btn btn-glass"
              style={{
                borderRadius: 24,
                padding: '6px 18px',
                fontSize: 13,
                fontWeight: 500,
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
              }}
              title="Click or tap to view opposite side"
            >
              <span>🔄 Flip Card</span>
              <span className="badge" style={{ fontSize: 11, padding: '2px 8px' }}>
                {activeSide === 'front' ? 'Side A (Front)' : 'Side B (Back)'}
              </span>
            </button>
            <span className="faint" style={{ fontSize: 12 }}>
              Click card to flip
            </span>
          </div>

          {/* 3D Flip Card Container */}
          <div
            style={{
              perspective: 1200,
              maxWidth: '100%',
              display: 'grid',
              placeItems: 'center',
              cursor: 'pointer',
              userSelect: 'none',
              padding: '10px 0',
            }}
            onClick={handleFlip}
            title="Click to flip card"
          >
            <div
              style={{
                transition: 'transform 0.6s cubic-bezier(0.4, 0, 0.2, 1)',
                transformStyle: 'preserve-3d',
                transform: isFlipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
              }}
            >
              {window.CardCanvasView && (
                <div style={{ transform: isFlipped ? 'scaleX(-1)' : 'none' }}>
                  <window.CardCanvasView
                    designDocument={design}
                    side={activeSide}
                    scale={isVertical ? 0.55 : 0.62}
                  />
                </div>
              )}
            </div>
          </div>

          {/* Quick Action Buttons */}
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'center', marginTop: 8 }}>
            <Button
              variant="primary"
              onClick={() => {
                window.OV.services.visitingCard.exportVCard({
                  name: user.name,
                  username,
                  websiteUrl: `https://${publicUrl}`,
                });
                toast.push({ title: 'Contact Saved', body: 'vCard (.vcf) downloaded to your address book.', tone: 'success' });
              }}
            >
              Save Contact (vCard)
            </Button>

            <Button
              variant="glass"
              icon={<Icon.copy />}
              onClick={async () => {
                await copyText(`https://${publicUrl}`);
                toast.push({ title: 'Link Copied', body: `https://${publicUrl}`, tone: 'success' });
              }}
            >
              Copy Link
            </Button>

            <Button
              variant="glass"
              onClick={() => window.OV.services.visitingCard.exportPng(design, `${username}_card_${activeSide}.png`, activeSide)}
            >
              Download {activeSide === 'front' ? 'Front' : 'Back'} (PNG)
            </Button>

            <Button
              variant="glass"
              onClick={() => window.OV.services.visitingCard.exportPdf(design, `${username}_double_sided_card.pdf`)}
            >
              Print-Ready PDF
            </Button>
          </div>

          {/* Footer details */}
          <p className="faint mono" style={{ fontSize: 12.5, textAlign: 'center', margin: 0 }}>
            https://{publicUrl}
          </p>
        </div>
      </main>
    );
  }

  window.PublicVisitingCard = PublicVisitingCard;
})();
