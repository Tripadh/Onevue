/* Draft preview host. Renders the saved public DTO with the portfolio app. */
const { useEffect: frameUseEffect, useRef: frameUseRef } = React;

function PortfolioPreviewFrame({
  dto,
  username,
  customization,
  templateId,
  templateVersion,
  height = 720,
}) {
  const frameRef = frameUseRef(null);
  const portfolioBase = (window.OV_ENV && window.OV_ENV.PORTFOLIO_BASE) || 'http://localhost:3001';

  frameUseEffect(() => {
    const frame = frameRef.current;
    if (!frame || !dto) return undefined;

    const website = {
      username: username || 'preview',
      templateId: templateId || 'magicui-portfolio',
      templateVersion: templateVersion || '1.0.0',
      publishedAt: '',
      revisionNumber: 0,
      customization: customization || {
        visibleSections: ['about', 'education', 'projects', 'skills', 'achievements', 'contact'],
      },
    };

    function post() {
      if (!frame.contentWindow) return;
      frame.contentWindow.postMessage(
        { type: 'onevue-draft-preview', dto, website },
        portfolioBase
      );
    }

    function onMessage(event) {
      if (event.origin !== portfolioBase) return;
      if (!event.data || event.data.type !== 'onevue-preview-ready') return;
      post();
    }

    window.addEventListener('message', onMessage);
    post();
    return () => window.removeEventListener('message', onMessage);
  }, [dto, username, customization, templateId, templateVersion, portfolioBase]);

  if (!dto) {
    return (
      <p className="muted" style={{ fontSize: 13, margin: 24 }}>
        Save your profile to preview the draft.
      </p>
    );
  }

  return (
    <iframe
      ref={frameRef}
      title="Portfolio draft preview"
      src={portfolioBase + '/preview'}
      style={{ width: '100%', height: height, border: 0, background: '#090d16', display: 'block' }}
    />
  );
}

window.PortfolioPreviewFrame = PortfolioPreviewFrame;
