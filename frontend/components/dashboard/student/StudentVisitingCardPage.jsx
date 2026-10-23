/* =========================================================================
   OneVue — Visiting Card Studio (Canva/Design.com-Inspired Creation Studio)
   Includes:
   - Experience A: Template Discovery (Search, 9 Categories, Orientation, Favorites)
   - Experience B: Double-Sided Canvas Studio (Front/Back, 8-Point Handles, Layers Panel, Alignment Guides)
   - Experience C: My Cards Management (Multi-Card CRUD, Duplicate, Make Primary, Exports)
   ========================================================================= */

(function () {
  const { useState, useEffect, useRef, useMemo, useCallback } = React;
  const { useLocation, useNavigate, useParams } = ReactRouterDOM;

  /* =========================================================================
     1. Shared Card Canvas Renderer Component
     ========================================================================= */
  function CardCanvasView({
    designDocument,
    side = 'front',
    scale = 1,
    selectedElementId,
    onSelectElement,
    isInteractive = false,
    onElementMouseDown,
    onResizeHandleMouseDown,
    onRotateMouseDown,
    guideLines = [],
  }) {
    if (!designDocument) return null;

    const isVertical = designDocument.dimensions?.orientation === 'vertical';
    const docWidth = designDocument.dimensions?.width || (isVertical ? 600 : 1050);
    const docHeight = designDocument.dimensions?.height || (isVertical ? 1050 : 600);

    // Resolve side data
    const sideData =
      (side === 'back' ? designDocument.back : designDocument.front) ||
      (side === 'back' ? null : designDocument);

    const background =
      sideData?.background ||
      (side === 'back' ? { type: 'solid', color: '#0F1E36' } : { type: 'solid', color: '#FAF8F5' });

    const elements = sideData?.elements || [];

    const bgStyle = useMemo(() => {
      if (background.type === 'gradient' && background.gradient) {
        return { background: background.gradient };
      }
      return { backgroundColor: background.color || (side === 'back' ? '#0F1E36' : '#FAF8F5') };
    }, [background, side]);

    return (
      <div
        className="card-canvas-viewport"
        style={{
          width: docWidth * scale,
          height: docHeight * scale,
          position: 'relative',
          overflow: 'hidden',
          borderRadius: 14 * scale,
          boxShadow: '0 24px 64px -16px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.12)',
          userSelect: 'none',
          transition: 'box-shadow 0.2s ease',
          ...bgStyle,
        }}
        onClick={(e) => {
          if (isInteractive && e.target === e.currentTarget && typeof onSelectElement === 'function') {
            onSelectElement(null);
          }
        }}
      >
        {/* Dynamic Alignment Snapping Guides */}
        {isInteractive &&
          guideLines.map((guide, idx) => {
            if (guide.type === 'vertical') {
              return (
                <div
                  key={`v_${idx}`}
                  style={{
                    position: 'absolute',
                    top: 0,
                    bottom: 0,
                    left: guide.pos * scale,
                    width: 1,
                    background: '#38BDF8',
                    zIndex: 998,
                    pointerEvents: 'none',
                    boxShadow: '0 0 4px #38BDF8',
                  }}
                />
              );
            }
            return (
              <div
                key={`h_${idx}`}
                style={{
                  position: 'absolute',
                  left: 0,
                  right: 0,
                  top: guide.pos * scale,
                  height: 1,
                  background: '#38BDF8',
                  zIndex: 998,
                  pointerEvents: 'none',
                  boxShadow: '0 0 4px #38BDF8',
                }}
              />
            );
          })}

        {/* Elements Rendering */}
        {elements.map((el) => {
          if (el.visible === false) return null;
          const isSelected = isInteractive && selectedElementId === el.id;

          const elStyle = {
            position: 'absolute',
            left: el.x * scale,
            top: el.y * scale,
            width: el.width * scale,
            height: el.height * scale,
            transform: el.rotation ? `rotate(${el.rotation}deg)` : undefined,
            transformOrigin: 'center center',
            zIndex: el.zIndex || 1,
            cursor: isInteractive ? (isSelected ? 'move' : el.locked ? 'not-allowed' : 'pointer') : 'default',
            boxSizing: 'border-box',
          };

          return (
            <div
              key={el.id}
              style={elStyle}
              onMouseDown={(e) => {
                if (isInteractive && typeof onElementMouseDown === 'function') {
                  onElementMouseDown(e, el.id);
                }
              }}
              onClick={(e) => {
                if (isInteractive) {
                  e.stopPropagation();
                  onSelectElement(el.id);
                }
              }}
            >
              {/* Active Selection Frame & 8-Point Resize Handles */}
              {isSelected && isInteractive && (
                <div
                  style={{
                    position: 'absolute',
                    inset: -2,
                    border: '2px solid #38BDF8',
                    pointerEvents: 'none',
                    zIndex: 999,
                    borderRadius: 3,
                  }}
                >
                  {/* Rotation handle */}
                  {!el.locked && (
                    <div
                      onMouseDown={(e) => onRotateMouseDown && onRotateMouseDown(e, el.id)}
                      style={{
                        position: 'absolute',
                        top: -24,
                        left: '50%',
                        transform: 'translateX(-50%)',
                        width: 14,
                        height: 14,
                        borderRadius: '50%',
                        background: '#38BDF8',
                        border: '2px solid #FFFFFF',
                        cursor: 'grab',
                        pointerEvents: 'auto',
                        boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
                      }}
                      title="Drag to rotate"
                    />
                  )}

                  {/* 8-Point Resize Handles */}
                  {!el.locked &&
                    [
                      { handle: 'nw', top: -5, left: -5, cursor: 'nwse-resize' },
                      { handle: 'n', top: -5, left: '50%', cursor: 'ns-resize', transform: 'translateX(-50%)' },
                      { handle: 'ne', top: -5, right: -5, cursor: 'nesw-resize' },
                      { handle: 'e', top: '50%', right: -5, cursor: 'ew-resize', transform: 'translateY(-50%)' },
                      { handle: 'se', bottom: -5, right: -5, cursor: 'nwse-resize' },
                      { handle: 's', bottom: -5, left: '50%', cursor: 'ns-resize', transform: 'translateX(-50%)' },
                      { handle: 'sw', bottom: -5, left: -5, cursor: 'nesw-resize' },
                      { handle: 'w', top: '50%', left: -5, cursor: 'ew-resize', transform: 'translateY(-50%)' },
                    ].map((pt) => (
                      <div
                        key={pt.handle}
                        onMouseDown={(e) => onResizeHandleMouseDown && onResizeHandleMouseDown(e, el.id, pt.handle)}
                        style={{
                          position: 'absolute',
                          top: pt.top,
                          left: pt.left,
                          right: pt.right,
                          bottom: pt.bottom,
                          transform: pt.transform,
                          width: 9,
                          height: 9,
                          background: '#FFFFFF',
                          border: '2px solid #38BDF8',
                          borderRadius: 2,
                          cursor: pt.cursor,
                          pointerEvents: 'auto',
                          boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
                        }}
                      />
                    ))}
                </div>
              )}

              {/* Element Type Renderers */}
              {el.type === 'text' && (
                <div
                  style={{
                    width: '100%',
                    height: '100%',
                    color: el.color || '#0F1E36',
                    fontSize: (el.fontSize || 16) * scale,
                    fontFamily: el.fontFamily || 'Inter, sans-serif',
                    fontWeight: el.fontWeight || 'normal',
                    textAlign: el.align || 'left',
                    lineHeight: el.lineHeight || 1.25,
                    letterSpacing: el.letterSpacing ? `${el.letterSpacing}px` : undefined,
                    whiteSpace: 'pre-wrap',
                    overflow: 'hidden',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent:
                      el.align === 'center'
                        ? 'center'
                        : el.align === 'right'
                        ? 'flex-end'
                        : 'flex-start',
                  }}
                >
                  {el.content || ''}
                </div>
              )}

              {el.type === 'contact' && (
                <div
                  style={{
                    width: '100%',
                    height: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8 * scale,
                    color: el.color || '#0F1E36',
                    fontSize: (el.fontSize || 14) * scale,
                    fontFamily: el.fontFamily || 'Inter, sans-serif',
                    fontWeight: 500,
                  }}
                >
                  <span style={{ fontSize: (el.fontSize || 14) * scale * 1.1 }}>
                    {el.icon === 'mail' ? '✉' : el.icon === 'phone' ? '📞' : el.icon === 'map-pin' ? '📍' : el.icon === 'github' ? '🐙' : '🔗'}
                  </span>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {el.value || ''}
                  </span>
                </div>
              )}

              {el.type === 'shape' && (
                <div
                  style={{
                    width: '100%',
                    height: '100%',
                    backgroundColor: el.fillColor || 'transparent',
                    border:
                      el.strokeColor && el.strokeWidth
                        ? `${el.strokeWidth * scale}px solid ${el.strokeColor}`
                        : undefined,
                    borderRadius:
                      el.shapeType === 'pill'
                        ? 9999
                        : (el.borderRadius || 0) * scale,
                  }}
                />
              )}

              {el.type === 'divider' && (
                <div
                  style={{
                    width: '100%',
                    height: '100%',
                    backgroundColor: el.fillColor || '#C5A880',
                  }}
                />
              )}

              {(el.type === 'photo' || el.type === 'logo') && (
                <div
                  style={{
                    width: '100%',
                    height: '100%',
                    borderRadius: (el.borderRadius || 0) * scale,
                    overflow: 'hidden',
                    border:
                      el.borderColor && el.borderWidth
                        ? `${el.borderWidth * scale}px solid ${el.borderColor}`
                        : undefined,
                    backgroundColor: '#E5E7EB',
                  }}
                >
                  {el.assetUrl ? (
                    <img
                      src={el.assetUrl}
                      alt="Element"
                      draggable={false}
                      style={{
                        width: '100%',
                        height: '100%',
                        objectFit: el.objectFit || 'cover',
                        display: 'block',
                      }}
                    />
                  ) : (
                    <div
                      style={{
                        width: '100%',
                        height: '100%',
                        display: 'grid',
                        placeItems: 'center',
                        fontSize: 24 * scale,
                        color: '#9CA3AF',
                      }}
                    >
                      👤
                    </div>
                  )}
                </div>
              )}

              {el.type === 'qr' && (
                <div
                  style={{
                    width: '100%',
                    height: '100%',
                    padding: 8 * scale,
                    borderRadius: (el.borderRadius || 8) * scale,
                    backgroundColor: el.bgColor || '#FFFFFF',
                    border:
                      el.borderColor && el.borderWidth
                        ? `${el.borderWidth * scale}px solid ${el.borderColor}`
                        : '1px solid #E5E7EB',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxSizing: 'border-box',
                  }}
                >
                  <svg
                    viewBox="0 0 21 21"
                    style={{ width: '100%', height: '100%', display: 'block' }}
                    shapeRendering="crispEdges"
                  >
                    <rect width="21" height="21" fill={el.bgColor || '#FFFFFF'} />
                    {/* Finder 1 */}
                    <rect x="0" y="0" width="7" height="7" fill={el.fgColor || '#000000'} />
                    <rect x="1" y="1" width="5" height="5" fill={el.bgColor || '#FFFFFF'} />
                    <rect x="2" y="2" width="3" height="3" fill={el.fgColor || '#000000'} />
                    {/* Finder 2 */}
                    <rect x="14" y="0" width="7" height="7" fill={el.fgColor || '#000000'} />
                    <rect x="15" y="1" width="5" height="5" fill={el.bgColor || '#FFFFFF'} />
                    <rect x="16" y="2" width="3" height="3" fill={el.fgColor || '#000000'} />
                    {/* Finder 3 */}
                    <rect x="0" y="14" width="7" height="7" fill={el.fgColor || '#000000'} />
                    <rect x="1" y="15" width="5" height="5" fill={el.bgColor || '#FFFFFF'} />
                    <rect x="2" y="16" width="3" height="3" fill={el.fgColor || '#000000'} />
                    {/* Timing & Data */}
                    {[8, 10, 12].map((x) => (
                      <rect key={x} x={x} y="6" width="1" height="1" fill={el.fgColor || '#000000'} />
                    ))}
                    {[8, 10, 12].map((y) => (
                      <rect key={y} x="6" y={y} width="1" height="1" fill={el.fgColor || '#000000'} />
                    ))}
                    <rect x="9" y="9" width="3" height="3" fill={el.fgColor || '#000000'} />
                    <rect x="14" y="10" width="2" height="2" fill={el.fgColor || '#000000'} />
                    <rect x="10" y="14" width="2" height="2" fill={el.fgColor || '#000000'} />
                    <rect x="16" y="16" width="3" height="3" fill={el.fgColor || '#000000'} />
                  </svg>
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  }
  window.CardCanvasView = CardCanvasView;

  /* =========================================================================
     2. Main StudentVisitingCardPage Component
     ========================================================================= */
  function StudentVisitingCardPage({ session, studentProfile }) {
    const toast = useToast();
    const toastRef = useRef(toast);
    toastRef.current = toast;
    const user = session?.user || {};
    const username = user.username || `user_${user.id || 'student'}`;
    const publicUrl = `onevue.id/card/${username}`;

    // Location and Route Bindings
    const location = useLocation();
    const navigate = useNavigate();
    const params = useParams();

    const pathname = (location.pathname || '').toLowerCase();
    const routeCardId = useMemo(() => {
      if (params?.cardId) return params.cardId;
      if (pathname.includes('/studio/') && !pathname.endsWith('/new')) {
        const seg = pathname.split('/studio/')[1];
        if (seg) return seg.split(/[?#/]/)[0] || null;
      }
      return null;
    }, [params, pathname]);

    const viewMode = useMemo(() => {
      if (pathname.includes('/visiting-card/templates')) return 'templates';
      if (pathname.includes('/visiting-card/studio/new')) return 'studio-new';
      if (pathname.includes('/visiting-card/studio')) return 'studio';
      return 'my-cards';
    }, [pathname]);

    const searchParams = useMemo(() => new URLSearchParams(location.search || ''), [location.search]);
    const queryCardId = searchParams.get('cardId');

    // Navigation Helpers
    const goToOverview = useCallback(() => {
      navigate('/app/student/visiting-card/overview');
    }, [navigate]);

    const goToTemplates = useCallback((targetCardId = null) => {
      // Ignore click events when this helper is passed directly to onClick.
      const id = typeof targetCardId === 'string' && targetCardId && !targetCardId.includes('[object')
        ? targetCardId
        : null;
      const q = id ? `?cardId=${encodeURIComponent(id)}` : '';
      navigate(`/app/student/visiting-card/templates${q}`);
    }, [navigate]);

    const goToStudio = useCallback((targetCardId) => {
      if (targetCardId) {
        navigate(`/app/student/visiting-card/studio/${targetCardId}`);
      } else {
        navigate('/app/student/visiting-card/overview');
      }
    }, [navigate]);

    const goToNewCard = useCallback((tmplId) => {
      const q = tmplId ? `?templateId=${encodeURIComponent(tmplId)}` : '';
      navigate(`/app/student/visiting-card/studio/new${q}`);
    }, [navigate]);

    // Multi-Card Data State
    const [cardData, setCardData] = useState(null);
    const [userCards, setUserCards] = useState([]);
    const [templates, setTemplates] = useState([]);
    const [loading, setLoading] = useState(true);
    const [cardNotFoundError, setCardNotFoundError] = useState(false);
    const [saveStatus, setSaveStatus] = useState('Saved'); // 'Saved' | 'Unsaved' | 'Saving...'
    const [publishing, setPublishing] = useState(false);
    const [unpublishing, setUnpublishing] = useState(false);
    const [showUnpublishModal, setShowUnpublishModal] = useState(false);
    const [cardToUnpublish, setCardToUnpublish] = useState(null);
    const [cardToDelete, setCardToDelete] = useState(null);

    // Studio Canvas Editor State
    const [designDoc, setDesignDoc] = useState(null);
    const [activeSide, setActiveSide] = useState('front'); // 'front' | 'back'
    const [selectedElementId, setSelectedElementId] = useState(null);
    const [studioTab, setStudioTab] = useState('layers'); // 'layers'|'text'|'shapes'|'uploads'|'contact'|'background'|'qr'|'templates'
    const [zoomLevel, setZoomLevel] = useState(0.7);
    const [historyStack, setHistoryStack] = useState([]);
    const [historyIndex, setHistoryIndex] = useState(-1);
    const [isDragging, setIsDragging] = useState(false);
    const [dragMode, setDragMode] = useState(null); // 'move' | 'resize' | 'rotate'
    const [resizeHandle, setResizeHandle] = useState(null);
    const [guideLines, setGuideLines] = useState([]);
    const dragStartRef = useRef({ mouseX: 0, mouseY: 0, elX: 0, elY: 0, elW: 0, elH: 0, rot: 0 });

    const assetInputRef = useRef(null);

    // Template Discovery Filter State
    const [templateSearch, setTemplateSearch] = useState('');
    const [selectedCategory, setSelectedCategory] = useState('All');
    const [selectedOrientation, setSelectedOrientation] = useState('All');
    const [favoriteTemplateIds, setFavoriteTemplateIds] = useState(() => {
      try {
        const stored = localStorage.getItem('onevue_fav_templates');
        return stored ? JSON.parse(stored) : [];
      } catch (_) {
        return [];
      }
    });

    const toggleFavoriteTemplate = (tmplId) => {
      setFavoriteTemplateIds((prev) => {
        const next = prev.includes(tmplId) ? prev.filter((id) => id !== tmplId) : [...prev, tmplId];
        try {
          localStorage.setItem('onevue_fav_templates', JSON.stringify(next));
        } catch (_) {}
        return next;
      });
    };

    // Load card data with strict card ID validation
    const loadCardData = useCallback(async (specificCardId = null) => {
      setLoading(true);
      setCardNotFoundError(false);
      try {
        const data = await window.OV.services.visitingCard.getCard(specificCardId);
        setUserCards(data.cards || []);
        setTemplates(data.templates || []);

        // Strict validation: if a specific card was requested, verify ID match
        if (specificCardId && (!data.card || data.card._id !== specificCardId)) {
          setCardNotFoundError(true);
          setCardData(null);
          setDesignDoc(null);
          toastRef.current.push({ title: 'Card Not Found', body: 'The requested card was not found or has been removed.', tone: 'error' });
        } else {
          setCardData(data.card);
          if (data.card?.designDocument) {
            setDesignDoc(data.card.designDocument);
            setHistoryStack([JSON.parse(JSON.stringify(data.card.designDocument))]);
            setHistoryIndex(0);
          }
        }
      } catch (err) {
        if (specificCardId) {
          setCardNotFoundError(true);
          setCardData(null);
          setDesignDoc(null);
        }
        toastRef.current.push({ title: 'Load Error', body: err.message || 'Could not load visiting card', tone: 'error' });
      } finally {
        setLoading(false);
      }
    }, []);

    // Handle /studio/new route: prevent duplicate draft creation using ref
    const creatingDraftRef = useRef(false);
    useEffect(() => {
      if (viewMode !== 'studio-new') return;
      if (creatingDraftRef.current) return;
      creatingDraftRef.current = true;

      const tid = searchParams.get('templateId') || 'academic-classic';

      async function createDraftFromTemplate() {
        try {
          const res = await window.OV.services.visitingCard.createCard({
            templateId: tid,
            designName: `New ${tid.replace('-', ' ')} Card`,
          });
          toastRef.current.push({ title: 'Card Created', body: 'Opened in Visiting Card Studio.', tone: 'success' });
          // Navigate with replace to actual saved card ID
          navigate(`/app/student/visiting-card/studio/${res.card._id}`, { replace: true });
        } catch (err) {
          toastRef.current.push({ title: 'Creation Failed', body: err.message, tone: 'error' });
          navigate('/app/student/visiting-card/templates', { replace: true });
        } finally {
          creatingDraftRef.current = false;
        }
      }

      createDraftFromTemplate();
    }, [viewMode, searchParams, navigate]);

    // Route-driven loading effect
    useEffect(() => {
      if (viewMode === 'studio-new') return;
      if (viewMode === 'studio') {
        if (routeCardId) {
          loadCardData(routeCardId);
        } else {
          goToOverview();
        }
      } else {
        // Overview or Templates
        loadCardData();
      }
    }, [viewMode, routeCardId, loadCardData, goToOverview]);

    // Protect against accidental loss of unsaved changes
    useEffect(() => {
      const handleBeforeUnload = (e) => {
        if (saveStatus === 'Unsaved' && viewMode === 'studio') {
          e.preventDefault();
          e.returnValue = '';
        }
      };
      window.addEventListener('beforeunload', handleBeforeUnload);
      return () => window.removeEventListener('beforeunload', handleBeforeUnload);
    }, [saveStatus, viewMode]);

    const handleExitStudio = () => {
      if (saveStatus === 'Unsaved') {
        const confirmExit = window.confirm('You have unsaved changes in this card. Leave without saving?');
        if (!confirmExit) return;
      }
      goToOverview();
    };

    // Active side elements
    const activeElements = useMemo(() => {
      if (!designDoc) return [];
      const sideData = activeSide === 'back' ? designDoc.back : designDoc.front;
      return sideData?.elements || [];
    }, [designDoc, activeSide]);

    const selectedElement = useMemo(() => {
      if (!selectedElementId) return null;
      return activeElements.find((el) => el.id === selectedElementId) || null;
    }, [activeElements, selectedElementId]);

    // History stack management
    const pushHistory = (newDoc) => {
      const nextIndex = historyIndex + 1;
      const nextStack = historyStack.slice(0, nextIndex);
      nextStack.push(JSON.parse(JSON.stringify(newDoc)));
      if (nextStack.length > 40) nextStack.shift();
      setHistoryStack(nextStack);
      setHistoryIndex(nextStack.length - 1);
      setDesignDoc(newDoc);
      setSaveStatus('Unsaved');
    };

    const handleUndo = () => {
      if (historyIndex > 0) {
        const prev = historyStack[historyIndex - 1];
        setHistoryIndex(historyIndex - 1);
        setDesignDoc(JSON.parse(JSON.stringify(prev)));
        setSaveStatus('Unsaved');
      }
    };

    const handleRedo = () => {
      if (historyIndex < historyStack.length - 1) {
        const next = historyStack[historyIndex + 1];
        setHistoryIndex(historyIndex + 1);
        setDesignDoc(JSON.parse(JSON.stringify(next)));
        setSaveStatus('Unsaved');
      }
    };

    // D3: Save Draft returns success/failure and navigates to overview on success when requested
    const handleSaveDraft = async (docToSave = designDoc, metaOverrides = {}, options = {}) => {
      const targetCardId = metaOverrides.cardId || cardData?._id;
      if (!docToSave || !targetCardId) {
        toast.push({ title: 'Save Failed', body: 'No card selected to save.', tone: 'error' });
        return false;
      }
      setSaveStatus('Saving...');
      try {
        const res = await window.OV.services.visitingCard.saveCard({
          cardId: targetCardId,
          selectedTemplateId: metaOverrides.selectedTemplateId || cardData?.selectedTemplateId,
          designName: metaOverrides.designName || cardData?.designName,
          designDocument: docToSave,
          visibilitySettings: cardData?.visibilitySettings,
        });
        if (res && res.card) {
          setCardData(res.card);
          setUserCards((prev) =>
            prev.map((c) => (c._id === res.card._id ? { ...c, ...res.card } : c))
          );
        }
        setSaveStatus('Saved');
        toast.push({ title: 'Draft Saved', body: 'Visiting card saved to database.', tone: 'success' });
        if (options.navigateOnSuccess) {
          goToOverview();
        }
        return true;
      } catch (err) {
        setSaveStatus('Unsaved');
        toast.push({ title: 'Save Failed', body: err.message, tone: 'error' });
        return false;
      }
    };

    // Publish Card: aborts publication if required draft save fails
    const handlePublish = async (targetCardId = cardData?._id) => {
      setPublishing(true);
      try {
        if (targetCardId === cardData?._id && viewMode === 'studio') {
          const saveOk = await handleSaveDraft(designDoc);
          if (!saveOk) {
            toast.push({
              title: 'Publish Aborted',
              body: 'Card changes could not be saved. Publication cancelled.',
              tone: 'error',
            });
            return false;
          }
        }
        const res = await window.OV.services.visitingCard.publishCard(targetCardId);
        setCardData(res.card);
        await loadCardData(targetCardId);
        toast.push({
          title: 'Card Published!',
          body: `Your digital visiting card is live at https://${publicUrl}`,
          tone: 'success',
        });
        return true;
      } catch (err) {
        toast.push({ title: 'Publish Failed', body: err.message, tone: 'error' });
        return false;
      } finally {
        setPublishing(false);
      }
    };

    // Unpublish Card: deactivates public live link
    const handleUnpublish = async (targetCardId = cardData?._id) => {
      setUnpublishing(true);
      try {
        const res = await window.OV.services.visitingCard.unpublishCard(targetCardId);
        setCardData(res.card);
        setShowUnpublishModal(false);
        setCardToUnpublish(null);
        await loadCardData(targetCardId || cardData?._id);
        toast.push({ title: 'Card Unpublished', body: 'Public link is now inactive.', tone: 'info' });
        return true;
      } catch (err) {
        toast.push({ title: 'Unpublish Failed', body: err.message, tone: 'error' });
        return false;
      } finally {
        setUnpublishing(false);
      }
    };

    // Create New Card: routes to canonical new studio path
    const handleCreateCard = (tmplId = 'academic-classic') => {
      goToNewCard(tmplId);
    };

    // Duplicate Card
    const handleDuplicateCard = async (cardId) => {
      try {
        const res = await window.OV.services.visitingCard.duplicateCard(cardId);
        toast.push({ title: 'Card Duplicated', body: `${res.card.designName} created.`, tone: 'success' });
        await loadCardData();
      } catch (err) {
        toast.push({ title: 'Duplication Failed', body: err.message, tone: 'error' });
      }
    };

    // Delete Card
    const handleDeleteCard = async (cardId) => {
      try {
        await window.OV.services.visitingCard.deleteCard(cardId);
        toast.push({ title: 'Card Deleted', body: 'Card permanently removed.', tone: 'info' });
        setCardToDelete(null);
        await loadCardData();
      } catch (err) {
        toast.push({ title: 'Delete Failed', body: err.message, tone: 'error' });
      }
    };

    // Asset Upload
    const handleAssetUpload = async (e) => {
      const file = e.target.files?.[0];
      if (!file) return;

      if (file.size > 2 * 1024 * 1024) {
        toast.push({ title: 'File Too Large', body: 'Maximum asset size is 2 MB.', tone: 'error' });
        return;
      }

      try {
        const asset = await window.OV.services.visitingCard.uploadAsset(file);
        toast.push({ title: 'Asset Uploaded', body: 'Logo/image ready to insert.', tone: 'success' });
        await loadCardData(cardData?._id);
        handleAddElement('logo', { assetUrl: asset.publicUrl, assetKey: asset.key });
      } catch (err) {
        toast.push({ title: 'Upload Failed', body: err.message, tone: 'error' });
      } finally {
        if (assetInputRef.current) assetInputRef.current.value = '';
      }
    };

    // Add Element to Active Side
    const handleAddElement = (type, extra = {}) => {
      if (!designDoc) return;
      const id = 'el_' + Math.random().toString(36).slice(2, 9);
      const sideKey = activeSide === 'back' ? 'back' : 'front';
      const sideData = designDoc[sideKey] || { background: { type: 'solid', color: '#FAF8F5' }, elements: [] };
      const currentEls = [...(sideData.elements || [])];
      const maxZ = currentEls.reduce((max, el) => Math.max(max, el.zIndex || 1), 1);

      let newEl = {
        id,
        type,
        x: 100,
        y: 100,
        width: 280,
        height: 60,
        zIndex: maxZ + 1,
        visible: true,
        locked: false,
        ...extra,
      };

      if (type === 'text') {
        newEl = {
          ...newEl,
          content: extra.content || 'New Heading',
          fontSize: extra.fontSize || 28,
          fontFamily: extra.fontFamily || 'Inter, sans-serif',
          fontWeight: extra.fontWeight || '700',
          color: extra.color || '#0F1E36',
          align: extra.align || 'left',
          width: extra.width || 380,
          height: extra.height || 48,
        };
      } else if (type === 'shape') {
        newEl = {
          ...newEl,
          shapeType: extra.shapeType || 'rect',
          fillColor: extra.fillColor || 'rgba(56, 189, 248, 0.15)',
          strokeColor: extra.strokeColor || '#38BDF8',
          strokeWidth: extra.strokeWidth !== undefined ? extra.strokeWidth : 1.5,
          borderRadius: extra.borderRadius || 8,
          width: extra.width || 180,
          height: extra.height || 100,
        };
      } else if (type === 'divider') {
        newEl = {
          ...newEl,
          fillColor: extra.fillColor || '#C5A880',
          width: extra.width || 500,
          height: 2,
        };
      } else if (type === 'qr') {
        newEl = {
          ...newEl,
          targetUrl: `https://${publicUrl}`,
          fgColor: '#000000',
          bgColor: '#FFFFFF',
          borderRadius: 12,
          width: 170,
          height: 170,
        };
      }

      const nextSide = { ...sideData, elements: [...currentEls, newEl] };
      const nextDoc = {
        ...designDoc,
        [sideKey]: nextSide,
        elements: sideKey === 'front' ? nextSide.elements : designDoc.elements,
      };
      pushHistory(nextDoc);
      setSelectedElementId(id);
    };

    // Update Selected Element
    const handleUpdateSelectedElement = (updates) => {
      if (!designDoc || !selectedElementId) return;
      const sideKey = activeSide === 'back' ? 'back' : 'front';
      const sideData = designDoc[sideKey];
      const nextElements = sideData.elements.map((el) => {
        if (el.id === selectedElementId) {
          return { ...el, ...updates };
        }
        return el;
      });

      const nextSide = { ...sideData, elements: nextElements };
      const nextDoc = {
        ...designDoc,
        [sideKey]: nextSide,
        elements: sideKey === 'front' ? nextElements : designDoc.elements,
      };
      pushHistory(nextDoc);
    };

    // Delete Selected Element
    const handleDeleteSelectedElement = (targetId = selectedElementId) => {
      if (!designDoc || !targetId) return;
      const sideKey = activeSide === 'back' ? 'back' : 'front';
      const sideData = designDoc[sideKey];
      const nextElements = sideData.elements.filter((el) => el.id !== targetId);

      const nextSide = { ...sideData, elements: nextElements };
      const nextDoc = {
        ...designDoc,
        [sideKey]: nextSide,
        elements: sideKey === 'front' ? nextElements : designDoc.elements,
      };
      pushHistory(nextDoc);
      setSelectedElementId(null);
    };

    // Duplicate Selected Element
    const handleDuplicateSelectedElement = (targetId = selectedElementId) => {
      if (!designDoc || !targetId) return;
      const sideKey = activeSide === 'back' ? 'back' : 'front';
      const sideData = designDoc[sideKey];
      const target = sideData.elements.find((el) => el.id === targetId);
      if (!target) return;

      const newId = 'el_' + Math.random().toString(36).slice(2, 9);
      const cloned = {
        ...JSON.parse(JSON.stringify(target)),
        id: newId,
        x: target.x + 20,
        y: target.y + 20,
        zIndex: (target.zIndex || 1) + 1,
      };

      const nextSide = { ...sideData, elements: [...sideData.elements, cloned] };
      const nextDoc = {
        ...designDoc,
        [sideKey]: nextSide,
        elements: sideKey === 'front' ? nextSide.elements : designDoc.elements,
      };
      pushHistory(nextDoc);
      setSelectedElementId(newId);
    };

    // Layer Ordering (Reorder in array & adjust zIndex)
    const handleLayerOrder = (direction, targetId = selectedElementId) => {
      if (!designDoc || !targetId) return;
      const sideKey = activeSide === 'back' ? 'back' : 'front';
      const sideData = designDoc[sideKey];
      const list = [...sideData.elements];
      const idx = list.findIndex((el) => el.id === targetId);
      if (idx === -1) return;

      if (direction === 'forward' && idx < list.length - 1) {
        const temp = list[idx];
        list[idx] = list[idx + 1];
        list[idx + 1] = temp;
      } else if (direction === 'backward' && idx > 0) {
        const temp = list[idx];
        list[idx] = list[idx - 1];
        list[idx - 1] = temp;
      } else if (direction === 'top') {
        const el = list.splice(idx, 1)[0];
        list.push(el);
      } else if (direction === 'bottom') {
        const el = list.splice(idx, 1)[0];
        list.unshift(el);
      }

      // Re-index zIndices cleanly
      list.forEach((el, i) => {
        el.zIndex = i + 1;
      });

      const nextSide = { ...sideData, elements: list };
      const nextDoc = {
        ...designDoc,
        [sideKey]: nextSide,
        elements: sideKey === 'front' ? list : designDoc.elements,
      };
      pushHistory(nextDoc);
    };

    // Toggle element lock/visibility
    const handleToggleLock = (targetId) => {
      const el = activeElements.find((e) => e.id === targetId);
      if (el) handleUpdateSelectedElement({ locked: !el.locked });
    };

    const handleToggleVisible = (targetId) => {
      const el = activeElements.find((e) => e.id === targetId);
      if (el) handleUpdateSelectedElement({ visible: el.visible === false ? true : false });
    };

    /* ---------------- Mouse Drag & Resize Handlers ---------------- */
    const handleElementMouseDown = (e, elId) => {
      if (e.button !== 0) return;
      const el = activeElements.find((item) => item.id === elId);
      if (!el || el.locked) return;

      e.stopPropagation();
      setSelectedElementId(elId);
      setIsDragging(true);
      setDragMode('move');

      dragStartRef.current = {
        mouseX: e.clientX,
        mouseY: e.clientY,
        elX: el.x,
        elY: el.y,
        elW: el.width,
        elH: el.height,
        rot: el.rotation || 0,
      };
    };

    const handleResizeHandleMouseDown = (e, elId, handle) => {
      if (e.button !== 0) return;
      const el = activeElements.find((item) => item.id === elId);
      if (!el || el.locked) return;

      e.stopPropagation();
      setSelectedElementId(elId);
      setIsDragging(true);
      setDragMode('resize');
      setResizeHandle(handle);

      dragStartRef.current = {
        mouseX: e.clientX,
        mouseY: e.clientY,
        elX: el.x,
        elY: el.y,
        elW: el.width,
        elH: el.height,
        rot: el.rotation || 0,
      };
    };

    const handleRotateMouseDown = (e, elId) => {
      if (e.button !== 0) return;
      const el = activeElements.find((item) => item.id === elId);
      if (!el || el.locked) return;

      e.stopPropagation();
      setSelectedElementId(elId);
      setIsDragging(true);
      setDragMode('rotate');

      dragStartRef.current = {
        mouseX: e.clientX,
        mouseY: e.clientY,
        elX: el.x,
        elY: el.y,
        elW: el.width,
        elH: el.height,
        rot: el.rotation || 0,
      };
    };

    useEffect(() => {
      const onMouseMove = (e) => {
        if (!isDragging || !selectedElementId || !designDoc) return;
        const dx = (e.clientX - dragStartRef.current.mouseX) / zoomLevel;
        const dy = (e.clientY - dragStartRef.current.mouseY) / zoomLevel;

        const isVertical = designDoc.dimensions?.orientation === 'vertical';
        const docW = designDoc.dimensions?.width || (isVertical ? 600 : 1050);
        const docH = designDoc.dimensions?.height || (isVertical ? 1050 : 600);

        if (dragMode === 'move') {
          let newX = Math.round(dragStartRef.current.elX + dx);
          let newY = Math.round(dragStartRef.current.elY + dy);

          // Snapping to center
          const activeGuides = [];
          const centerX = newX + dragStartRef.current.elW / 2;
          const centerY = newY + dragStartRef.current.elH / 2;
          const docMidX = docW / 2;
          const docMidY = docH / 2;

          if (Math.abs(centerX - docMidX) < 10) {
            newX = Math.round(docMidX - dragStartRef.current.elW / 2);
            activeGuides.push({ type: 'vertical', pos: docMidX });
          }
          if (Math.abs(centerY - docMidY) < 10) {
            newY = Math.round(docMidY - dragStartRef.current.elH / 2);
            activeGuides.push({ type: 'horizontal', pos: docMidY });
          }

          setGuideLines(activeGuides);

          const sideKey = activeSide === 'back' ? 'back' : 'front';
          const sideData = designDoc[sideKey];
          const nextElements = sideData.elements.map((el) => {
            if (el.id === selectedElementId) {
              return { ...el, x: newX, y: newY };
            }
            return el;
          });
          setDesignDoc({
            ...designDoc,
            [sideKey]: { ...sideData, elements: nextElements },
            elements: sideKey === 'front' ? nextElements : designDoc.elements,
          });
        } else if (dragMode === 'resize') {
          let { elX, elY, elW, elH } = dragStartRef.current;
          const h = resizeHandle;

          if (h.includes('e')) elW = Math.max(20, Math.round(elW + dx));
          if (h.includes('s')) elH = Math.max(10, Math.round(elH + dy));
          if (h.includes('w')) {
            const nextW = Math.max(20, Math.round(elW - dx));
            elX = Math.round(elX + (elW - nextW));
            elW = nextW;
          }
          if (h.includes('n')) {
            const nextH = Math.max(10, Math.round(elH - dy));
            elY = Math.round(elY + (elH - nextH));
            elH = nextH;
          }

          const sideKey = activeSide === 'back' ? 'back' : 'front';
          const sideData = designDoc[sideKey];
          const nextElements = sideData.elements.map((el) => {
            if (el.id === selectedElementId) {
              return { ...el, x: elX, y: elY, width: elW, height: elH };
            }
            return el;
          });
          setDesignDoc({
            ...designDoc,
            [sideKey]: { ...sideData, elements: nextElements },
            elements: sideKey === 'front' ? nextElements : designDoc.elements,
          });
        } else if (dragMode === 'rotate') {
          const { elX, elY, elW, elH } = dragStartRef.current;
          const cx = (elX + elW / 2) * zoomLevel;
          const cy = (elY + elH / 2) * zoomLevel;
          const angle = Math.atan2(e.clientY - cy, e.clientX - cx) * (180 / Math.PI);
          const normalizedAngle = Math.round(angle + 90) % 360;

          const sideKey = activeSide === 'back' ? 'back' : 'front';
          const sideData = designDoc[sideKey];
          const nextElements = sideData.elements.map((el) => {
            if (el.id === selectedElementId) {
              return { ...el, rotation: normalizedAngle };
            }
            return el;
          });
          setDesignDoc({
            ...designDoc,
            [sideKey]: { ...sideData, elements: nextElements },
            elements: sideKey === 'front' ? nextElements : designDoc.elements,
          });
        }
      };

      const onMouseUp = () => {
        if (isDragging) {
          setIsDragging(false);
          setDragMode(null);
          setResizeHandle(null);
          setGuideLines([]);
          pushHistory(designDoc);
        }
      };

      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
      return () => {
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onMouseUp);
      };
    }, [isDragging, dragMode, resizeHandle, selectedElementId, zoomLevel, designDoc, activeSide]);

    // Keyboard navigation & shortcuts
    useEffect(() => {
      const handleKeyDown = (e) => {
        if (!selectedElementId || viewMode !== 'studio') return;
        // Don't intercept when typing in inputs/textareas
        if (['INPUT', 'TEXTAREA', 'SELECT'].includes(e.target.tagName)) return;

        if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault();
          handleDeleteSelectedElement(selectedElementId);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          const step = e.shiftKey ? 10 : 1;
          handleUpdateSelectedElement({ y: (selectedElement?.y || 0) - step });
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          const step = e.shiftKey ? 10 : 1;
          handleUpdateSelectedElement({ y: (selectedElement?.y || 0) + step });
        } else if (e.key === 'ArrowLeft') {
          e.preventDefault();
          const step = e.shiftKey ? 10 : 1;
          handleUpdateSelectedElement({ x: (selectedElement?.x || 0) - step });
        } else if (e.key === 'ArrowRight') {
          e.preventDefault();
          const step = e.shiftKey ? 10 : 1;
          handleUpdateSelectedElement({ x: (selectedElement?.x || 0) + step });
        } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
          e.preventDefault();
          if (e.shiftKey) handleRedo();
          else handleUndo();
        } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
          e.preventDefault();
          handleRedo();
        } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
          e.preventDefault();
          handleDuplicateSelectedElement(selectedElementId);
        }
      };

      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }, [selectedElementId, viewMode, selectedElement]);

    // Filtered templates for discovery
    const filteredTemplates = useMemo(() => {
      return templates.filter((tmpl) => {
        if (selectedCategory !== 'All' && tmpl.category !== selectedCategory) return false;
        if (selectedOrientation !== 'All' && tmpl.orientation !== selectedOrientation.toLowerCase()) return false;
        if (templateSearch.trim()) {
          const q = templateSearch.toLowerCase().trim();
          const matchName = tmpl.name.toLowerCase().includes(q);
          const matchDesc = tmpl.description.toLowerCase().includes(q);
          const matchCat = tmpl.category.toLowerCase().includes(q);
          const matchTags = Array.isArray(tmpl.tags) && tmpl.tags.some((t) => t.toLowerCase().includes(q));
          if (!matchName && !matchDesc && !matchCat && !matchTags) return false;
        }
        return true;
      });
    }, [templates, selectedCategory, selectedOrientation, templateSearch]);

    const pageSwitch = (
      <div role="tablist" aria-label="Visiting card pages" style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {[
          { key: 'cards', label: 'My Cards', active: viewMode === 'my-cards', onClick: goToOverview },
          { key: 'templates', label: 'Templates', active: viewMode === 'templates', onClick: () => goToTemplates() },
          {
            key: 'studio',
            label: 'Studio',
            active: viewMode === 'studio' || viewMode === 'studio-new',
            onClick: () => {
              const id = cardData?._id || userCards[0]?._id;
              if (id) goToStudio(id);
              else goToTemplates();
            },
          },
        ].map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={item.active}
            onClick={item.onClick}
            className={`btn ${item.active ? 'btn-primary' : 'btn-ghost'}`}
            style={{ height: 34, fontSize: 13, padding: '0 16px', borderRadius: 999 }}
          >
            {item.label}
          </button>
        ))}
      </div>
    );

    if (loading) {
      return (
        <div style={{ display: 'grid', gap: 24 }}>
          {pageSwitch}
          <div style={{ padding: '80px 0', textAlign: 'center' }}>
            <div className="spin" style={{ margin: '0 auto 16px', width: 32, height: 32 }} />
            <p className="muted">Loading Visiting Card Studio...</p>
          </div>
        </div>
      );
    }

    if (viewMode === 'studio-new') {
      return (
        <div style={{ display: 'grid', gap: 24 }}>
          {pageSwitch}
          <div style={{ padding: '80px 0', textAlign: 'center' }}>
            <div className="spin" style={{ margin: '0 auto 16px', width: 32, height: 32 }} />
            <p className="muted">Creating your new card from template...</p>
          </div>
        </div>
      );
    }

    if (viewMode === 'studio' && (cardNotFoundError || (!cardData && !loading))) {
      return (
        <div style={{ display: 'grid', gap: 24, maxWidth: 1180, margin: '0 auto' }}>
          {pageSwitch}
        <div style={{ maxWidth: 500, margin: '40px auto', textAlign: 'center', padding: 24 }}>
          <GlassCard style={{ padding: 36, display: 'grid', gap: 18 }}>
            <div style={{ fontSize: 48 }}>🪪</div>
            <h2 className="h-display" style={{ fontSize: 22, margin: 0 }}>Visiting Card Not Found</h2>
            <p className="muted" style={{ fontSize: 14, margin: 0, lineHeight: 1.5 }}>
              The requested card could not be found or may have been deleted.
            </p>
            <div style={{ display: 'flex', justifyContent: 'center', gap: 12, marginTop: 8 }}>
              <Button variant="primary" onClick={goToOverview}>
                ← Back to My Cards
              </Button>
            </div>
          </GlassCard>
        </div>
        </div>
      );
    }

    /* =========================================================================
       VIEW 1: MY CARDS (MULTI-CARD MANAGEMENT OVERVIEW)
       ========================================================================= */
    if (viewMode === 'my-cards') {
      const activeCard = cardData || userCards[0];
      const isPublished = activeCard?.publicationStatus === 'published';

      return (
        <div style={{ display: 'grid', gap: 32, maxWidth: 1180, margin: '0 auto' }}>
          {pageSwitch}
          {/* Top Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
                <h1 className="h-display" style={{ fontSize: 28, margin: 0 }}>My Visiting Cards</h1>
                <span className="badge" style={{ fontSize: 12, padding: '3px 10px' }}>
                  {userCards.length} {userCards.length === 1 ? 'Card' : 'Cards'} Managed
                </span>
              </div>
              <p className="muted" style={{ margin: 0, fontSize: 14.5 }}>
                Professional digital business card creator with double-sided layouts, QR code sharing, and print-ready exports.
              </p>
            </div>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <Button
                variant="primary"
                onClick={() => goToTemplates()}
                icon={Icon?.sparkle ? <Icon.sparkle /> : <span style={{ marginLeft: 6 }}>+</span>}
              >
                + Create New Card
              </Button>
              <Button
                variant="glass"
                onClick={() => goToStudio(activeCard?._id)}
              >
                Open Studio Editor
              </Button>
            </div>
          </div>

          {/* Cards Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))', gap: 24 }}>
            {userCards.map((c) => {
              const isDefaultCard = c.isDefault;
              const isCardPublished = c.publicationStatus === 'published';
              const isCardSelected = String(cardData?._id || '') === String(c._id || '');
              const previewDoc = c.designDocument || (isCardSelected ? designDoc : null);

              return (
                <GlassCard
                  key={c._id}
                  style={{
                    padding: 22,
                    display: 'grid',
                    gap: 16,
                    border: isCardSelected ? '2px solid var(--accent)' : '1px solid var(--line)',
                    position: 'relative',
                    transition: 'transform 0.2s ease, box-shadow 0.2s ease',
                  }}
                >
                  {/* Card Header & Badges */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                    <div>
                      <h3 className="h-card" style={{ fontSize: 17, margin: '0 0 4px 0' }}>
                        {c.designName || 'Visiting Card'}
                      </h3>
                      <span className="faint" style={{ fontSize: 11.5 }}>
                        Template: {c.selectedTemplateId ? c.selectedTemplateId.replace('-', ' ').toUpperCase() : 'ACADEMIC'}
                      </span>
                    </div>

                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      {isDefaultCard && (
                        <span className="badge" style={{ backgroundColor: 'rgba(217, 119, 6, 0.15)', color: '#D97706', border: '1px solid rgba(217, 119, 6, 0.3)' }}>
                          ★ Primary
                        </span>
                      )}
                      <span
                        className="badge"
                        style={{
                          backgroundColor: isCardPublished ? 'rgba(16, 185, 129, 0.15)' : 'rgba(234, 179, 8, 0.15)',
                          color: isCardPublished ? '#10B981' : '#EAB308',
                          border: `1px solid ${isCardPublished ? 'rgba(16, 185, 129, 0.3)' : 'rgba(234, 179, 8, 0.3)'}`,
                        }}
                      >
                        {isCardPublished ? 'Published' : 'Draft'}
                      </span>
                    </div>
                  </div>

                  {/* Scaled Interactive Card Thumbnail */}
                  <div
                    style={{
                      height: 180,
                      display: 'grid',
                      placeItems: 'center',
                      background: 'radial-gradient(circle at center, rgba(255,255,255,0.03) 0%, rgba(0,0,0,0.2) 100%)',
                      borderRadius: 12,
                      overflow: 'hidden',
                      cursor: 'pointer',
                    }}
                    onClick={() => {
                      goToStudio(c._id);
                    }}
                    title="Click to edit in Studio"
                  >
                    {previewDoc ? (
                      <CardCanvasView designDocument={previewDoc} side="front" scale={0.28} />
                    ) : (
                      <div style={{ textAlign: 'center', color: 'var(--text-3)', fontSize: 13 }}>
                        <span style={{ fontSize: 28, display: 'block', marginBottom: 4 }}>🪪</span>
                        Click to Load Design
                      </div>
                    )}
                  </div>

                  {/* Action Buttons Toolbar */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid var(--line)', paddingTop: 14, gap: 8, flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() => {
                          goToStudio(c._id);
                        }}
                      >
                        Edit in Studio
                      </Button>
                      <Button
                        size="sm"
                        variant="glass"
                        onClick={() => handleDuplicateCard(c._id)}
                        title="Duplicate this card"
                      >
                        Duplicate
                      </Button>
                    </div>

                    <div style={{ display: 'flex', gap: 6 }}>
                      {isCardPublished ? (
                        <>
                          <Button
                            size="sm"
                            variant="ghost"
                            icon={<Icon.copy />}
                            onClick={async () => {
                              await copyText(`https://${publicUrl}`);
                              toast.push({ title: 'Link Copied', body: `https://${publicUrl}`, tone: 'success' });
                            }}
                            title="Copy public card link"
                          />
                          <Button
                            size="sm"
                            variant="ghost"
                            style={{ color: '#EAB308' }}
                            onClick={() => {
                              setCardToUnpublish(c);
                              setShowUnpublishModal(true);
                            }}
                            title="Unpublish this card"
                          >
                            Unpublish
                          </Button>
                        </>
                      ) : (
                        <Button
                          size="sm"
                          variant="glass"
                          onClick={() => handlePublish(c._id)}
                        >
                          Publish
                        </Button>
                      )}

                      {userCards.length > 1 && (
                        <Button
                          size="sm"
                          variant="ghost"
                          style={{ color: '#EF4444' }}
                          onClick={() => setCardToDelete(c)}
                          title="Delete card"
                        >
                          ✕
                        </Button>
                      )}
                    </div>
                  </div>
                </GlassCard>
              );
            })}
          </div>

          {/* Delete Card Confirmation Modal */}
          {cardToDelete && (
            <div
              style={{
                position: 'fixed',
                inset: 0,
                backgroundColor: 'rgba(0,0,0,0.7)',
                zIndex: 9999,
                display: 'grid',
                placeItems: 'center',
                padding: 20,
              }}
            >
              <GlassCard style={{ maxWidth: 420, padding: 28, display: 'grid', gap: 18 }}>
                <h3 className="h-card" style={{ fontSize: 18, margin: 0 }}>Delete Visiting Card?</h3>
                <p className="muted" style={{ fontSize: 13.5, margin: 0, lineHeight: 1.5 }}>
                  Are you sure you want to delete <strong>{cardToDelete.designName}</strong>? This action cannot be undone.
                </p>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                  <Button variant="ghost" onClick={() => setCardToDelete(null)}>
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    style={{ backgroundColor: '#EF4444', borderColor: '#EF4444' }}
                    onClick={() => handleDeleteCard(cardToDelete._id)}
                  >
                    Confirm Delete
                  </Button>
                </div>
              </GlassCard>
            </div>
          )}

          {/* Unpublish Card Confirmation Modal */}
          {showUnpublishModal && cardToUnpublish && (
            <div
              style={{
                position: 'fixed',
                inset: 0,
                backgroundColor: 'rgba(0,0,0,0.7)',
                zIndex: 9999,
                display: 'grid',
                placeItems: 'center',
                padding: 20,
              }}
            >
              <GlassCard style={{ maxWidth: 420, padding: 28, display: 'grid', gap: 18 }}>
                <h3 className="h-card" style={{ fontSize: 18, margin: 0 }}>Unpublish Visiting Card?</h3>
                <p className="muted" style={{ fontSize: 13.5, margin: 0, lineHeight: 1.5 }}>
                  Are you sure you want to unpublish <strong>{cardToUnpublish.designName}</strong>? The public live link will become inactive until you publish it again.
                </p>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                  <Button variant="ghost" onClick={() => { setShowUnpublishModal(false); setCardToUnpublish(null); }}>
                    Cancel
                  </Button>
                  <Button
                    variant="primary"
                    style={{ backgroundColor: '#EAB308', borderColor: '#EAB308', color: '#000' }}
                    disabled={unpublishing}
                    onClick={() => handleUnpublish(cardToUnpublish._id)}
                  >
                    {unpublishing ? 'Unpublishing...' : 'Confirm Unpublish'}
                  </Button>
                </div>
              </GlassCard>
            </div>
          )}
        </div>
      );
    }

    /* =========================================================================
       VIEW 2: TEMPLATE DISCOVERY & GALLERY
       ========================================================================= */
    if (viewMode === 'templates') {
      const categories = [
        'All',
        'Professional',
        'Minimal',
        'Creative',
        'Corporate',
        'Student',
        'Freelancer',
        'Developer',
        'Creator',
        'Business',
      ];

      return (
        <div style={{ display: 'grid', gap: 28, maxWidth: 1180, margin: '0 auto' }}>
          {pageSwitch}
          {/* Header */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 14 }}>
            <div>
              <Button size="sm" variant="ghost" onClick={goToOverview} style={{ marginBottom: 6 }}>
                ← Back to My Cards
              </Button>
              <h1 className="h-display" style={{ fontSize: 28, margin: 0 }}>Template Gallery</h1>
              <p className="muted" style={{ margin: '4px 0 0', fontSize: 14 }}>
                Choose an original designer layout tailored for your professional identity.
              </p>
            </div>
          </div>

          {/* Search Bar & Filters */}
          <GlassCard style={{ padding: 20, display: 'grid', gap: 16 }}>
            <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
              <div style={{ flex: 1, minWidth: 260 }}>
                <input
                  type="text"
                  placeholder="Search templates by keyword, style, profession, or brand name..."
                  value={templateSearch}
                  onChange={(e) => setTemplateSearch(e.target.value)}
                  className="input"
                  style={{ width: '100%', height: 40, fontSize: 14 }}
                />
              </div>

              {/* Orientation Filter */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span className="faint" style={{ fontSize: 12 }}>Orientation:</span>
                {['All', 'Horizontal', 'Vertical'].map((ori) => (
                  <button
                    key={ori}
                    onClick={() => setSelectedOrientation(ori)}
                    className={`btn ${selectedOrientation === ori ? 'btn-primary' : 'btn-ghost'}`}
                    style={{ height: 32, fontSize: 12, padding: '0 12px' }}
                  >
                    {ori}
                  </button>
                ))}
              </div>
            </div>

            {/* Category Pills */}
            <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 4 }}>
              {categories.map((cat) => (
                <button
                  key={cat}
                  onClick={() => setSelectedCategory(cat)}
                  className={`btn ${selectedCategory === cat ? 'btn-primary' : 'btn-ghost'}`}
                  style={{
                    height: 32,
                    fontSize: 12.5,
                    padding: '0 14px',
                    borderRadius: 20,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {cat}
                </button>
              ))}
            </div>
          </GlassCard>

          {/* Template Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(350px, 1fr))', gap: 24 }}>
            {filteredTemplates.map((tmpl) => {
              const isFav = favoriteTemplateIds.includes(tmpl.id);
              const isSelected = cardData?.selectedTemplateId === tmpl.id;
              const isVertical = tmpl.orientation === 'vertical';

              return (
                <GlassCard
                  key={tmpl.id}
                  style={{
                    padding: 22,
                    display: 'grid',
                    gap: 16,
                    border: isSelected ? '2px solid var(--accent)' : '1px solid var(--line)',
                    position: 'relative',
                  }}
                >
                  {/* Top Bar with Category & Favorite Star */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <span className="badge" style={{ fontSize: 11 }}>{tmpl.category}</span>
                      <span className="faint" style={{ fontSize: 11 }}>
                        {isVertical ? 'Vertical (600×1050)' : 'Horizontal (1050×600)'}
                      </span>
                    </div>

                    <button
                      onClick={() => toggleFavoriteTemplate(tmpl.id)}
                      className="icon-btn"
                      style={{
                        width: 28,
                        height: 28,
                        color: isFav ? '#F59E0B' : 'var(--text-3)',
                        fontSize: 16,
                      }}
                      title={isFav ? 'Remove from favorites' : 'Add to favorites'}
                    >
                      {isFav ? '★' : '☆'}
                    </button>
                  </div>

                  {/* Template Visual Miniature */}
                  <div
                    style={{
                      height: 180,
                      borderRadius: 10,
                      backgroundColor: tmpl.defaultBackground?.color || '#FAF8F5',
                      backgroundImage: tmpl.defaultBackground?.gradient,
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'center',
                      padding: '0 24px',
                      color: tmpl.primaryColor || '#000',
                      fontFamily: tmpl.fontFamily,
                      boxShadow: 'inset 0 2px 10px rgba(0,0,0,0.06)',
                    }}
                  >
                    <span style={{ fontSize: 20, fontWeight: 700 }}>{user.name || 'Alex Mercer'}</span>
                    <span style={{ fontSize: 12.5, opacity: 0.8, marginTop: 4 }}>
                      {studentProfile?.headline || 'Senior Scholar & Researcher'}
                    </span>
                    <div style={{ marginTop: 12, width: 44, height: 2, background: tmpl.accentColor || '#C5A880' }} />
                  </div>

                  <div>
                    <h3 className="h-card" style={{ fontSize: 16.5, margin: '0 0 6px 0' }}>{tmpl.name}</h3>
                    <p className="faint" style={{ fontSize: 12.5, margin: 0, minHeight: 36, lineHeight: 1.45 }}>
                      {tmpl.description}
                    </p>
                  </div>

                  {/* Actions */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, borderTop: '1px solid var(--line)', paddingTop: 14 }}>
                    <Button
                      size="sm"
                      variant="glass"
                      onClick={() => handleCreateCard(tmpl.id)}
                    >
                      Use as New Card
                    </Button>
                    <Button
                      size="sm"
                      variant={isSelected ? 'primary' : 'glass'}
                      onClick={async () => {
                        const safeQueryCardId = typeof queryCardId === 'string' && !queryCardId.includes('[object')
                          ? queryCardId
                          : null;
                        const targetCardId = safeQueryCardId || cardData?._id || userCards[0]?._id;
                        if (!targetCardId) {
                          handleCreateCard(tmpl.id);
                          return;
                        }
                        const seedInfo = {
                          name: user.name,
                          headline: studentProfile?.headline,
                          institution: studentProfile?.education?.[0]?.institution,
                          degree: studentProfile?.education?.[0]?.degree,
                          email: user.email,
                          phone: studentProfile?.contacts?.phone,
                          location: user.location,
                          username,
                          photoUrl: user.profilePhotoUrl,
                          github: studentProfile?.contacts?.github,
                        };
                        const nextDoc = window.generateDefaultCardDesign
                          ? window.generateDefaultCardDesign(tmpl.id, seedInfo)
                          : { ...designDoc, background: tmpl.defaultBackground };

                        setDesignDoc(nextDoc);
                        pushHistory(nextDoc);
                        setCardData((prev) => (prev ? { ...prev, selectedTemplateId: tmpl.id } : prev));
                        const saveOk = await handleSaveDraft(nextDoc, { cardId: targetCardId, selectedTemplateId: tmpl.id });
                        if (saveOk) {
                          toast.push({ title: 'Template Applied', body: `Switched active design to ${tmpl.name}.`, tone: 'success' });
                          goToStudio(targetCardId);
                        }
                      }}
                    >
                      {isSelected ? 'Active (Open Studio)' : 'Apply to Active Card'}
                    </Button>
                  </div>
                </GlassCard>
              );
            })}
          </div>
        </div>
      );
    }

    /* =========================================================================
       VIEW 3: CANVA-STYLE DESIGN STUDIO
       ========================================================================= */
    const isVerticalDesign = designDoc?.dimensions?.orientation === 'vertical';

    return (
      <div className="visiting-card-studio-root" style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - 110px)', minHeight: 700, gap: 12 }}>
        {pageSwitch}
        {/* Hidden File Picker for Uploads */}
        <input
          type="file"
          ref={assetInputRef}
          onChange={handleAssetUpload}
          accept="image/png,image/jpeg,image/webp"
          style={{ display: 'none' }}
        />

        {/* Top Studio Control Bar */}
        <header
          className="glass"
          style={{
            height: 54,
            padding: '0 18px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '1px solid var(--line)',
            borderRadius: '16px 16px 0 0',
            zIndex: 20,
          }}
        >
          {/* Left: Exit + Design Name + Save Status */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <Button size="sm" variant="ghost" onClick={handleExitStudio}>
              ← My Cards
            </Button>
            <div style={{ height: 20, width: 1, background: 'var(--line)' }} />
            <input
              type="text"
              value={cardData?.designName || 'My Visiting Card'}
              onChange={(e) => setCardData({ ...cardData, designName: e.target.value })}
              className="input"
              style={{ height: 32, fontSize: 13.5, fontWeight: 500, width: 180, padding: '0 8px' }}
              title="Click to rename design"
            />
            <span
              className="mono faint"
              style={{ fontSize: 11.5, color: saveStatus === 'Unsaved' ? '#EAB308' : '#10B981' }}
            >
              ● {saveStatus}
            </span>
          </div>

          {/* Center: Undo / Redo + Front/Back Switcher + Zoom */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              className="icon-btn"
              onClick={handleUndo}
              disabled={historyIndex <= 0}
              title="Undo (Ctrl+Z)"
              style={{ width: 32, height: 32 }}
            >
              ↶
            </button>
            <button
              className="icon-btn"
              onClick={handleRedo}
              disabled={historyIndex >= historyStack.length - 1}
              title="Redo (Ctrl+Y)"
              style={{ width: 32, height: 32 }}
            >
              ↷
            </button>

            <div style={{ height: 20, width: 1, background: 'var(--line)', margin: '0 4px' }} />

            {/* Front / Back Side Toggle Button */}
            <div style={{ display: 'flex', borderRadius: 8, overflow: 'hidden', border: '1px solid var(--line)' }}>
              <button
                onClick={() => {
                  setActiveSide('front');
                  setSelectedElementId(null);
                }}
                className={`btn ${activeSide === 'front' ? 'btn-primary' : 'btn-ghost'}`}
                style={{ height: 30, fontSize: 12, padding: '0 12px', borderRadius: 0 }}
              >
                Side A (Front)
              </button>
              <button
                onClick={() => {
                  setActiveSide('back');
                  setSelectedElementId(null);
                }}
                className={`btn ${activeSide === 'back' ? 'btn-primary' : 'btn-ghost'}`}
                style={{ height: 30, fontSize: 12, padding: '0 12px', borderRadius: 0 }}
              >
                Side B (Back)
              </button>
            </div>

            <div style={{ height: 20, width: 1, background: 'var(--line)', margin: '0 4px' }} />

            <span className="faint" style={{ fontSize: 12 }}>Zoom</span>
            <select
              value={zoomLevel}
              onChange={(e) => setZoomLevel(parseFloat(e.target.value))}
              className="input"
              style={{ height: 30, fontSize: 12, padding: '0 6px', width: 75 }}
            >
              <option value="0.5">50%</option>
              <option value="0.6">60%</option>
              <option value="0.7">70%</option>
              <option value="0.8">80%</option>
              <option value="1.0">100%</option>
            </select>
          </div>

          {/* Right: Actions */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Button size="sm" variant="glass" onClick={() => handleSaveDraft(designDoc, {}, { navigateOnSuccess: true })}>
              Save Draft
            </Button>
            {cardData?.publicationStatus === 'published' && (
              <Button
                size="sm"
                variant="ghost"
                style={{ color: '#EAB308' }}
                onClick={() => {
                  setCardToUnpublish(cardData);
                  setShowUnpublishModal(true);
                }}
                disabled={unpublishing}
              >
                Unpublish
              </Button>
            )}
            <Button size="sm" variant="primary" onClick={() => handlePublish()} loading={publishing}>
              {cardData?.publicationStatus === 'published' ? 'Update Published' : 'Publish Card'}
            </Button>

            {/* Export Dropdown */}
            <select
              className="input"
              style={{ height: 32, fontSize: 12, padding: '0 8px', cursor: 'pointer' }}
              onChange={(e) => {
                const val = e.target.value;
                if (!val) return;
                if (val === 'png_front') window.OV.services.visitingCard.exportPng(designDoc, `${username}_front.png`, 'front');
                if (val === 'png_back') window.OV.services.visitingCard.exportPng(designDoc, `${username}_back.png`, 'back');
                if (val === 'png_both') window.OV.services.visitingCard.exportPng(designDoc, `${username}_card.png`, 'both');
                if (val === 'pdf_2page') window.OV.services.visitingCard.exportPdf(designDoc, `${username}_print_card.pdf`);
                e.target.value = '';
              }}
            >
              <option value="">Export ▾</option>
              <option value="png_front">PNG (Front Side)</option>
              <option value="png_back">PNG (Back Side)</option>
              <option value="png_both">PNG (Both Sides)</option>
              <option value="pdf_2page">PDF (2-Page Print-Ready)</option>
            </select>
          </div>
        </header>

        {/* Main Editor Work Area: Left Tools + Center Canvas + Right Properties */}
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden', position: 'relative' }}>
          {/* Left Toolbar */}
          <aside
            className="glass"
            style={{
              width: 260,
              borderRight: '1px solid var(--line)',
              display: 'flex',
              flexDirection: 'column',
              borderRadius: 0,
              zIndex: 10,
              background: 'color-mix(in oklab, var(--bg-0) 85%, transparent)',
            }}
          >
            {/* Tool Tabs */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4, padding: '8px', borderBottom: '1px solid var(--line)' }}>
              {[
                { id: 'layers', label: 'Layers' },
                { id: 'text', label: 'Text' },
                { id: 'shapes', label: 'Shapes' },
                { id: 'uploads', label: 'Media' },
                { id: 'contact', label: 'Contact' },
                { id: 'background', label: 'Color' },
                { id: 'qr', label: 'QR' },
                { id: 'templates', label: 'Layout' },
              ].map((t) => (
                <button
                  key={t.id}
                  onClick={() => setStudioTab(t.id)}
                  className={`btn ${studioTab === t.id ? 'btn-primary' : 'btn-ghost'}`}
                  style={{ height: 28, fontSize: 11, padding: 0 }}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* Tab Specific Options */}
            <div style={{ flex: 1, overflowY: 'auto', padding: 14, display: 'grid', gap: 12, alignContent: 'start' }}>
              {/* TAB 1: LAYERS PANEL */}
              {studioTab === 'layers' && (
                <div style={{ display: 'grid', gap: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span className="eyebrow" style={{ fontSize: 11 }}>
                      {activeSide === 'front' ? 'Side A Elements' : 'Side B Elements'}
                    </span>
                    <span className="faint" style={{ fontSize: 11 }}>
                      {activeElements.length} items
                    </span>
                  </div>

                  {activeElements.length === 0 ? (
                    <p className="faint" style={{ fontSize: 12, textAlign: 'center', padding: '20px 0' }}>
                      No elements on this side yet. Use tabs above to add text, shapes, or QR codes.
                    </p>
                  ) : (
                    <div style={{ display: 'grid', gap: 6 }}>
                      {[...activeElements].reverse().map((el) => {
                        const isElSelected = selectedElementId === el.id;
                        return (
                          <div
                            key={el.id}
                            onClick={() => setSelectedElementId(el.id)}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'space-between',
                              padding: '8px 10px',
                              borderRadius: 8,
                              backgroundColor: isElSelected ? 'rgba(56, 189, 248, 0.15)' : 'rgba(255, 255, 255, 0.03)',
                              border: isElSelected ? '1px solid #38BDF8' : '1px solid var(--line)',
                              cursor: 'pointer',
                              fontSize: 12,
                            }}
                          >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, overflow: 'hidden' }}>
                              <span>{el.type === 'text' ? 'T' : el.type === 'shape' ? '▢' : el.type === 'photo' ? '🖼' : el.type === 'qr' ? '▦' : '•'}</span>
                              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 120 }}>
                                {el.content || el.type}
                              </span>
                            </div>

                            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleToggleLock(el.id);
                                }}
                                className="icon-btn"
                                style={{ width: 22, height: 22, fontSize: 11 }}
                                title={el.locked ? 'Unlock' : 'Lock'}
                              >
                                {el.locked ? '🔒' : '🔓'}
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleToggleVisible(el.id);
                                }}
                                className="icon-btn"
                                style={{ width: 22, height: 22, fontSize: 11 }}
                                title={el.visible === false ? 'Show' : 'Hide'}
                              >
                                {el.visible === false ? '👁‍🗨' : '👁'}
                              </button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteSelectedElement(el.id);
                                }}
                                className="icon-btn"
                                style={{ width: 22, height: 22, fontSize: 11, color: '#EF4444' }}
                                title="Delete"
                              >
                                ✕
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* TAB 2: TEXT */}
              {studioTab === 'text' && (
                <>
                  <span className="eyebrow" style={{ fontSize: 11 }}>Typography</span>
                  <Button size="sm" variant="glass" onClick={() => handleAddElement('text', { content: 'Display Heading', fontSize: 32, fontWeight: '700' })}>
                    + Add Title
                  </Button>
                  <Button size="sm" variant="glass" onClick={() => handleAddElement('text', { content: studentProfile?.headline || 'Academic Scholar', fontSize: 18, fontWeight: '500' })}>
                    + Add Subtitle
                  </Button>
                  <Button size="sm" variant="glass" onClick={() => handleAddElement('text', { content: 'Custom note or bio...', fontSize: 14 })}>
                    + Add Body Text
                  </Button>
                  <Button size="sm" variant="glass" onClick={() => handleAddElement('text', { content: user.name?.slice(0, 2).toUpperCase() || 'OV', fontSize: 36, fontWeight: '700' })}>
                    + Add Monogram
                  </Button>
                </>
              )}

              {/* TAB 3: SHAPES */}
              {studioTab === 'shapes' && (
                <>
                  <span className="eyebrow" style={{ fontSize: 11 }}>Shapes & Separators</span>
                  <Button size="sm" variant="glass" onClick={() => handleAddElement('shape', { shapeType: 'rect', fillColor: 'rgba(56, 189, 248, 0.1)', strokeColor: '#38BDF8', strokeWidth: 1.5 })}>
                    + Rectangle
                  </Button>
                  <Button size="sm" variant="glass" onClick={() => handleAddElement('shape', { shapeType: 'circle', borderRadius: 999, width: 100, height: 100, fillColor: 'rgba(255, 255, 255, 0.1)' })}>
                    + Circle / Crest
                  </Button>
                  <Button size="sm" variant="glass" onClick={() => handleAddElement('shape', { shapeType: 'pill', fillColor: 'rgba(217, 119, 6, 0.15)', strokeColor: '#D97706', width: 200, height: 36 })}>
                    + Pill Badge
                  </Button>
                  <Button size="sm" variant="glass" onClick={() => handleAddElement('divider', { fillColor: '#C5A880' })}>
                    + Divider Line
                  </Button>
                </>
              )}

              {/* TAB 4: UPLOADS & MEDIA */}
              {studioTab === 'uploads' && (
                <>
                  <span className="eyebrow" style={{ fontSize: 11 }}>Logos & Media</span>
                  <Button size="sm" variant="primary" onClick={() => assetInputRef.current?.click()}>
                    Upload Image (Max 2MB)
                  </Button>

                  {user.profilePhotoUrl && (
                    <div style={{ display: 'grid', gap: 6, marginTop: 8 }}>
                      <span className="faint" style={{ fontSize: 11 }}>Profile Avatar</span>
                      <Button
                        size="sm"
                        variant="glass"
                        onClick={() => handleAddElement('photo', { assetUrl: user.profilePhotoUrl, borderRadius: 70, width: 140, height: 140 })}
                      >
                        + Insert Photo
                      </Button>
                    </div>
                  )}

                  {cardData?.assetReferences?.length > 0 && (
                    <div style={{ display: 'grid', gap: 8, marginTop: 8 }}>
                      <span className="faint" style={{ fontSize: 11 }}>Uploaded Library</span>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
                        {cardData.assetReferences.map((ast, i) => (
                          <div
                            key={i}
                            onClick={() => handleAddElement('logo', { assetUrl: ast.publicUrl, assetKey: ast.key })}
                            style={{
                              height: 60,
                              borderRadius: 8,
                              border: '1px solid var(--line)',
                              overflow: 'hidden',
                              cursor: 'pointer',
                              background: '#fff',
                            }}
                            title={ast.name}
                          >
                            <img src={ast.publicUrl} alt={ast.name} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* TAB 5: CONTACT FIELDS */}
              {studioTab === 'contact' && (
                <>
                  <span className="eyebrow" style={{ fontSize: 11 }}>Verified Contact Fields</span>
                  <Button size="sm" variant="glass" onClick={() => handleAddElement('contact', { fieldKey: 'email', value: user.email, icon: 'mail' })}>
                    + Email ({user.email || 'None'})
                  </Button>
                  {studentProfile?.contacts?.phone && (
                    <Button size="sm" variant="glass" onClick={() => handleAddElement('contact', { fieldKey: 'phone', value: studentProfile.contacts.phone, icon: 'phone' })}>
                      + Phone ({studentProfile.contacts.phone})
                    </Button>
                  )}
                  {user.location && (
                    <Button size="sm" variant="glass" onClick={() => handleAddElement('contact', { fieldKey: 'location', value: user.location, icon: 'map-pin' })}>
                      + Location ({user.location})
                    </Button>
                  )}
                  {studentProfile?.contacts?.github && (
                    <Button size="sm" variant="glass" onClick={() => handleAddElement('contact', { fieldKey: 'github', value: `github.com/${studentProfile.contacts.github}`, icon: 'github' })}>
                      + GitHub
                    </Button>
                  )}
                </>
              )}

              {/* TAB 6: BACKGROUND */}
              {studioTab === 'background' && (
                <>
                  <span className="eyebrow" style={{ fontSize: 11 }}>
                    {activeSide === 'front' ? 'Front Backdrop' : 'Back Backdrop'}
                  </span>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
                    {['#FAF8F5', '#FFFFFF', '#0B0F19', '#0D1117', '#F8FAFC', '#FFF7ED', '#1E1B4B', '#064E3B'].map((c) => (
                      <div
                        key={c}
                        onClick={() => {
                          const sideKey = activeSide === 'back' ? 'back' : 'front';
                          const sideData = designDoc[sideKey];
                          const nextDoc = {
                            ...designDoc,
                            [sideKey]: { ...sideData, background: { type: 'solid', color: c } },
                          };
                          pushHistory(nextDoc);
                        }}
                        style={{
                          height: 36,
                          borderRadius: 8,
                          backgroundColor: c,
                          border: '2px solid var(--line)',
                          cursor: 'pointer',
                        }}
                        title={c}
                      />
                    ))}
                  </div>

                  <span className="eyebrow" style={{ fontSize: 11, marginTop: 12 }}>Custom Color</span>
                  <input
                    type="color"
                    value={
                      (activeSide === 'back' ? designDoc?.back?.background?.color : designDoc?.front?.background?.color) ||
                      '#FAF8F5'
                    }
                    onChange={(e) => {
                      const sideKey = activeSide === 'back' ? 'back' : 'front';
                      const sideData = designDoc[sideKey];
                      const nextDoc = {
                        ...designDoc,
                        [sideKey]: { ...sideData, background: { type: 'solid', color: e.target.value } },
                      };
                      pushHistory(nextDoc);
                    }}
                    style={{ width: '100%', height: 36, border: 'none', borderRadius: 8, cursor: 'pointer' }}
                  />
                </>
              )}

              {/* TAB 7: QR CODE */}
              {studioTab === 'qr' && (
                <>
                  <span className="eyebrow" style={{ fontSize: 11 }}>QR Code Element</span>
                  <Button size="sm" variant="primary" onClick={() => handleAddElement('qr', {})}>
                    + Insert QR Code
                  </Button>
                  <p className="faint" style={{ fontSize: 11.5, margin: '8px 0 0', lineHeight: 1.45 }}>
                    Encodes direct link to your live public digital card address: <code>onevue.id/card/{username}</code>.
                  </p>
                </>
              )}

              {/* TAB 8: TEMPLATES SWITCHER */}
              {studioTab === 'templates' && (
                <>
                  <span className="eyebrow" style={{ fontSize: 11 }}>Layout Presets</span>
                  <Button size="sm" variant="glass" onClick={() => goToTemplates(cardData?._id)}>
                    Browse All 9 Templates
                  </Button>
                </>
              )}
            </div>
          </aside>

          {/* Center Canvas Workspace */}
          <main
            style={{
              flex: 1,
              display: 'grid',
              placeItems: 'center',
              overflow: 'auto',
              padding: 40,
              background: 'radial-gradient(circle at center, rgba(255,255,255,0.02) 0%, rgba(0,0,0,0.22) 100%)',
            }}
            onClick={() => setSelectedElementId(null)}
          >
            <CardCanvasView
              designDocument={designDoc}
              side={activeSide}
              scale={zoomLevel}
              selectedElementId={selectedElementId}
              onSelectElement={setSelectedElementId}
              isInteractive={true}
              onElementMouseDown={handleElementMouseDown}
              onResizeHandleMouseDown={handleResizeHandleMouseDown}
              onRotateMouseDown={handleRotateMouseDown}
              guideLines={guideLines}
            />
          </main>

          {/* Right Properties Panel */}
          <aside
            className="glass"
            style={{
              width: 280,
              borderLeft: '1px solid var(--line)',
              display: 'flex',
              flexDirection: 'column',
              borderRadius: 0,
              zIndex: 10,
              background: 'color-mix(in oklab, var(--bg-0) 85%, transparent)',
              padding: 16,
              overflowY: 'auto',
            }}
          >
            <h3 style={{ margin: '0 0 14px 0', fontSize: 15 }}>
              {selectedElement ? `${selectedElement.type.toUpperCase()} Properties` : 'Card Overview'}
            </h3>

            {selectedElement ? (
              <div style={{ display: 'grid', gap: 14 }}>
                {/* Text Content */}
                {selectedElement.type === 'text' && (
                  <div>
                    <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>Text Content</label>
                    <textarea
                      value={selectedElement.content || ''}
                      onChange={(e) => handleUpdateSelectedElement({ content: e.target.value })}
                      className="input"
                      rows={2}
                      style={{ width: '100%', fontSize: 13 }}
                    />
                  </div>
                )}

                {/* Typography Settings */}
                {(selectedElement.type === 'text' || selectedElement.type === 'contact') && (
                  <>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      <div>
                        <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>Font Size</label>
                        <input
                          type="number"
                          value={selectedElement.fontSize || 16}
                          onChange={(e) => handleUpdateSelectedElement({ fontSize: parseInt(e.target.value, 10) || 16 })}
                          className="input"
                          style={{ width: '100%', height: 32 }}
                        />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>Weight</label>
                        <select
                          value={selectedElement.fontWeight || '400'}
                          onChange={(e) => handleUpdateSelectedElement({ fontWeight: e.target.value })}
                          className="input"
                          style={{ width: '100%', height: 32 }}
                        >
                          <option value="400">Regular</option>
                          <option value="500">Medium</option>
                          <option value="600">SemiBold</option>
                          <option value="700">Bold</option>
                        </select>
                      </div>
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>Font Family</label>
                      <select
                        value={selectedElement.fontFamily || 'Inter, sans-serif'}
                        onChange={(e) => handleUpdateSelectedElement({ fontFamily: e.target.value })}
                        className="input"
                        style={{ width: '100%', height: 32 }}
                      >
                        <option value="Inter, sans-serif">Inter (Modern Clean)</option>
                        <option value="Cormorant Garamond, serif">Cormorant (Academic Serif)</option>
                        <option value="monospace">Monospace (Terminal Code)</option>
                      </select>
                    </div>

                    <div>
                      <label style={{ display: 'block', fontSize: 12, marginBottom: 4 }}>Text Color</label>
                      <input
                        type="color"
                        value={selectedElement.color || '#0F1E36'}
                        onChange={(e) => handleUpdateSelectedElement({ color: e.target.value })}
                        style={{ width: '100%', height: 32, border: 'none', borderRadius: 6, cursor: 'pointer' }}
                      />
                    </div>
                  </>
                )}

                {/* Dimensions & Coordinates */}
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 11, marginBottom: 2 }}>Width (px)</label>
                    <input
                      type="number"
                      value={selectedElement.width}
                      onChange={(e) => handleUpdateSelectedElement({ width: parseInt(e.target.value, 10) || 10 })}
                      className="input"
                      style={{ width: '100%', height: 30 }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: 11, marginBottom: 2 }}>Height (px)</label>
                    <input
                      type="number"
                      value={selectedElement.height}
                      onChange={(e) => handleUpdateSelectedElement({ height: parseInt(e.target.value, 10) || 10 })}
                      className="input"
                      style={{ width: '100%', height: 30 }}
                    />
                  </div>
                </div>

                {/* Shape / Pill Styling */}
                {selectedElement.type === 'shape' && (
                  <>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                      <div>
                        <label style={{ display: 'block', fontSize: 11, marginBottom: 2 }}>Fill Color</label>
                        <input
                          type="color"
                          value={selectedElement.fillColor || '#38BDF8'}
                          onChange={(e) => handleUpdateSelectedElement({ fillColor: e.target.value })}
                          style={{ width: '100%', height: 30, border: 'none', borderRadius: 4, cursor: 'pointer' }}
                        />
                      </div>
                      <div>
                        <label style={{ display: 'block', fontSize: 11, marginBottom: 2 }}>Border Color</label>
                        <input
                          type="color"
                          value={selectedElement.strokeColor || '#38BDF8'}
                          onChange={(e) => handleUpdateSelectedElement({ strokeColor: e.target.value })}
                          style={{ width: '100%', height: 30, border: 'none', borderRadius: 4, cursor: 'pointer' }}
                        />
                      </div>
                    </div>
                  </>
                )}

                {/* Layer Ordering Controls */}
                <div style={{ display: 'grid', gap: 6, borderTop: '1px solid var(--line)', paddingTop: 10 }}>
                  <span className="eyebrow" style={{ fontSize: 11 }}>Layer Ordering</span>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                    <Button size="sm" variant="glass" onClick={() => handleLayerOrder('forward')}>
                      Bring Forward
                    </Button>
                    <Button size="sm" variant="glass" onClick={() => handleLayerOrder('backward')}>
                      Send Backward
                    </Button>
                  </div>
                </div>

                {/* Element Actions */}
                <div style={{ display: 'grid', gap: 8, borderTop: '1px solid var(--line)', paddingTop: 12 }}>
                  <Button size="sm" variant="glass" onClick={() => handleDuplicateSelectedElement(selectedElement.id)}>
                    Duplicate Element (Ctrl+D)
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => handleDeleteSelectedElement(selectedElement.id)} style={{ color: '#EF4444' }}>
                    Delete Element (Del)
                  </Button>
                </div>
              </div>
            ) : (
              <div style={{ display: 'grid', gap: 12 }}>
                <p className="faint" style={{ fontSize: 13, lineHeight: 1.5, margin: 0 }}>
                  Click any element on the card canvas to position, resize, or adjust properties.
                </p>
                <div style={{ padding: '12px 14px', borderRadius: 10, background: 'color-mix(in oklab, var(--bg-0) 50%, transparent)', border: '1px solid var(--line)', fontSize: 12 }}>
                  <strong style={{ display: 'block', marginBottom: 4 }}>Keyboard Shortcuts</strong>
                  <div>• <code>Delete</code> / <code>Backspace</code>: Delete</div>
                  <div>• <code>Arrow Keys</code>: Fine 1px nudge</div>
                  <div>• <code>Shift + Arrows</code>: 10px nudge</div>
                  <div>• <code>Ctrl + Z</code>: Undo</div>
                  <div>• <code>Ctrl + Y</code>: Redo</div>
                  <div>• <code>Ctrl + D</code>: Duplicate</div>
                </div>
              </div>
            )}
          </aside>
        </div>

        {/* Unpublish Confirmation Modal in Studio */}
        {showUnpublishModal && cardToUnpublish && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              backgroundColor: 'rgba(0,0,0,0.7)',
              zIndex: 9999,
              display: 'grid',
              placeItems: 'center',
              padding: 20,
            }}
          >
            <GlassCard style={{ maxWidth: 420, padding: 28, display: 'grid', gap: 18 }}>
              <h3 className="h-card" style={{ fontSize: 18, margin: 0 }}>Unpublish Visiting Card?</h3>
              <p className="muted" style={{ fontSize: 13.5, margin: 0, lineHeight: 1.5 }}>
                Are you sure you want to unpublish <strong>{cardToUnpublish.designName}</strong>? The public live link will become inactive until you publish it again.
              </p>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <Button variant="ghost" onClick={() => { setShowUnpublishModal(false); setCardToUnpublish(null); }}>
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  style={{ backgroundColor: '#EAB308', borderColor: '#EAB308', color: '#000' }}
                  disabled={unpublishing}
                  onClick={() => handleUnpublish(cardToUnpublish._id)}
                >
                  {unpublishing ? 'Unpublishing...' : 'Confirm Unpublish'}
                </Button>
              </div>
            </GlassCard>
          </div>
        )}
      </div>
    );
  }

  window.StudentVisitingCardPage = StudentVisitingCardPage;
})();
