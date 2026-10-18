/* =========================================================================
   OneVue Visiting Card Service
   Manages multi-card configuration, canvas persistence, double-sided (Front/Back)
   designs, publishing, asset uploads, and exports (PNG, 2-Page PDF, vCard).
   ========================================================================= */

(function () {
  const { db, ServiceError } = window.OV.core;
  const API_BASE = (window.OV_ENV && window.OV_ENV.API_BASE) || 'http://localhost:3000/api';

  function getSessionToken() {
    const session = db.get('session', null);
    return session?.token || null;
  }

  /** Fetch current user's active card configuration, all cards, and approved templates */
  async function getCard(cardId = null) {
    const token = getSessionToken();
    if (!token) throw new ServiceError('unauthorized', 'Authentication required');

    const query = cardId ? `?cardId=${encodeURIComponent(cardId)}` : '';
    try {
      const res = await fetch(`${API_BASE}/student/card${query}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
      });
      const data = await res.json();
      if (!res.ok) throw new ServiceError('fetch_error', data.message || 'Failed to load card');
      return data;
    } catch (e) {
      if (e instanceof ServiceError) throw e;
      throw new ServiceError('network_error', 'Could not connect to card service.');
    }
  }

  /** Create a new visiting card */
  async function createCard({ templateId, designName }) {
    const token = getSessionToken();
    if (!token) throw new ServiceError('unauthorized', 'Authentication required');

    try {
      const res = await fetch(`${API_BASE}/student/card`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ action: 'create', templateId, designName }),
      });
      const data = await res.json();
      if (!res.ok) throw new ServiceError('create_error', data.message || 'Failed to create card');
      return data;
    } catch (e) {
      if (e instanceof ServiceError) throw e;
      throw new ServiceError('network_error', 'Could not create new visiting card.');
    }
  }

  /** Duplicate an existing visiting card */
  async function duplicateCard(sourceCardId) {
    const token = getSessionToken();
    if (!token) throw new ServiceError('unauthorized', 'Authentication required');

    try {
      const res = await fetch(`${API_BASE}/student/card`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ action: 'duplicate', sourceCardId }),
      });
      const data = await res.json();
      if (!res.ok) throw new ServiceError('duplicate_error', data.message || 'Failed to duplicate card');
      return data;
    } catch (e) {
      if (e instanceof ServiceError) throw e;
      throw new ServiceError('network_error', 'Could not duplicate card.');
    }
  }

  /** Delete a visiting card */
  async function deleteCard(cardId) {
    const token = getSessionToken();
    if (!token) throw new ServiceError('unauthorized', 'Authentication required');

    try {
      const res = await fetch(`${API_BASE}/student/card?cardId=${encodeURIComponent(cardId)}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });
      const data = await res.json();
      if (!res.ok) throw new ServiceError('delete_error', data.message || 'Failed to delete card');
      return data;
    } catch (e) {
      if (e instanceof ServiceError) throw e;
      throw new ServiceError('network_error', 'Could not delete card.');
    }
  }

  /** Save card draft (does not publish) */
  async function saveCard(cardPayload) {
    const token = getSessionToken();
    if (!token) throw new ServiceError('unauthorized', 'Authentication required');

    try {
      const res = await fetch(`${API_BASE}/student/card`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(cardPayload),
      });
      const data = await res.json();
      if (!res.ok) throw new ServiceError('save_error', data.message || 'Failed to save card');
      return data;
    } catch (e) {
      if (e instanceof ServiceError) throw e;
      throw new ServiceError('network_error', 'Could not save card to server.');
    }
  }

  /** Publish the current draft design */
  async function publishCard(cardId = null) {
    const token = getSessionToken();
    if (!token) throw new ServiceError('unauthorized', 'Authentication required');

    try {
      const res = await fetch(`${API_BASE}/student/card/publish`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(cardId ? { cardId } : {}),
      });
      const data = await res.json();
      if (!res.ok) throw new ServiceError('publish_error', data.message || 'Failed to publish card');
      return data;
    } catch (e) {
      if (e instanceof ServiceError) throw e;
      throw new ServiceError('network_error', 'Could not publish card.');
    }
  }

  /** Unpublish the card */
  async function unpublishCard(cardId = null) {
    const token = getSessionToken();
    if (!token) throw new ServiceError('unauthorized', 'Authentication required');

    try {
      const res = await fetch(`${API_BASE}/student/card/unpublish`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(cardId ? { cardId } : {}),
      });
      const data = await res.json();
      if (!res.ok) throw new ServiceError('unpublish_error', data.message || 'Failed to unpublish card');
      return data;
    } catch (e) {
      if (e instanceof ServiceError) throw e;
      throw new ServiceError('network_error', 'Could not unpublish card.');
    }
  }

  /** Upload a custom asset (logo, image) for the card */
  async function uploadAsset(file) {
    const token = getSessionToken();
    if (!token) throw new ServiceError('unauthorized', 'Authentication required');

    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch(`${API_BASE}/student/card/upload`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) throw new ServiceError('upload_error', data.message || 'Failed to upload asset');

      let resolvedUrl = data.asset.publicUrl;
      if (resolvedUrl && !resolvedUrl.startsWith('http')) {
        const origin = API_BASE.replace(/\/api\/?$/, '');
        resolvedUrl = `${origin}${resolvedUrl.startsWith('/') ? '' : '/'}${resolvedUrl}`;
      }
      return {
        ...data.asset,
        publicUrl: resolvedUrl,
      };
    } catch (e) {
      if (e instanceof ServiceError) throw e;
      throw new ServiceError('network_error', 'Could not upload card asset.');
    }
  }

  /** Retrieve public visiting card by username */
  async function getPublicCard(username) {
    const cleanUsername = encodeURIComponent(String(username).trim().toLowerCase());
    try {
      const res = await fetch(`${API_BASE}/public/card/${cleanUsername}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (!res.ok) throw new ServiceError('not_found', data.message || 'Public card not found');
      return data;
    } catch (e) {
      if (e instanceof ServiceError) throw e;
      throw new ServiceError('network_error', 'Could not load public card.');
    }
  }

  /** Generate standard vCard (.vcf) and trigger browser download */
  function exportVCard({ name, title, institution, email, phone, location, username, websiteUrl }) {
    const cleanName = (name || 'Contact').trim();
    const parts = cleanName.split(/\s+/);
    const lastName = parts.length > 1 ? parts[parts.length - 1] : '';
    const firstName = parts.length > 1 ? parts.slice(0, -1).join(' ') : cleanName;

    const lines = [
      'BEGIN:VCARD',
      'VERSION:3.0',
      `N:${lastName};${firstName};;;`,
      `FN:${cleanName}`,
    ];

    if (institution) lines.push(`ORG:${institution}`);
    if (title) lines.push(`TITLE:${title}`);
    if (email) lines.push(`EMAIL;TYPE=INTERNET,WORK:${email}`);
    if (phone) lines.push(`TEL;TYPE=CELL,VOICE:${phone}`);
    if (location) lines.push(`ADR;TYPE=WORK:;;${location};;;`);
    if (websiteUrl) lines.push(`URL:${websiteUrl}`);
    lines.push(`URL;TYPE=ONEVUE:https://onevue.id/card/${username || 'student'}`);
    lines.push('END:VCARD');

    const vcfContent = lines.join('\r\n');
    const blob = new Blob([vcfContent], { type: 'text/vcard;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${username || 'student'}_visiting_card.vcf`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  /** Helper: roundRect polyfill for canvas */
  function drawRoundedRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.lineTo(x + w - r, y);
    c.quadraticCurveTo(x + w, y, x + w, y + r);
    c.lineTo(x + w, y + h - r);
    c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    c.lineTo(x + r, y + h);
    c.quadraticCurveTo(x, y + h, x, y + h - r);
    c.lineTo(x, y + r);
    c.quadraticCurveTo(x, y, x + r, y);
    c.closePath();
  }

  /** Render card design document onto an offscreen canvas at 2x resolution */
  async function renderCardToCanvas(designDoc, side = 'front') {
    if (!designDoc) throw new Error('No design document provided');

    const isVertical = designDoc.dimensions?.orientation === 'vertical';
    const docWidth = designDoc.dimensions?.width || (isVertical ? 600 : 1050);
    const docHeight = designDoc.dimensions?.height || (isVertical ? 1050 : 600);

    const canvas = document.createElement('canvas');
    canvas.width = docWidth * 2;
    canvas.height = docHeight * 2;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');

    ctx.scale(2, 2);

    // Resolve side data (support double-sided or legacy flat)
    const sideData = (side === 'back' ? designDoc.back : designDoc.front) || (side === 'back' ? null : designDoc);
    const background = sideData?.background || (side === 'back' ? { type: 'solid', color: '#0F1E36' } : { type: 'solid', color: '#FAF8F5' });
    const elements = sideData?.elements || [];

    // 1. Draw Background
    if (background) {
      if (background.type === 'gradient' && background.gradient) {
        const grad = ctx.createLinearGradient(0, 0, docWidth, docHeight);
        grad.addColorStop(0, '#FFF7ED');
        grad.addColorStop(1, '#FEE2E2');
        ctx.fillStyle = grad;
      } else {
        ctx.fillStyle = background.color || (side === 'back' ? '#0F1E36' : '#FAF8F5');
      }
      ctx.fillRect(0, 0, docWidth, docHeight);
    }

    // Sort elements by zIndex
    const sorted = [...elements].sort((a, b) => (a.zIndex || 1) - (b.zIndex || 1));

    for (const el of sorted) {
      if (el.visible === false) continue;
      ctx.save();

      // Rotation
      if (el.rotation) {
        const cx = el.x + el.width / 2;
        const cy = el.y + el.height / 2;
        ctx.translate(cx, cy);
        ctx.rotate((el.rotation * Math.PI) / 180);
        ctx.translate(-cx, -cy);
      }

      if (el.type === 'shape') {
        const r = el.shapeType === 'pill' ? Math.min(el.width, el.height) / 2 : (el.borderRadius || 0);
        drawRoundedRect(ctx, el.x, el.y, el.width, el.height, r);
        if (el.fillColor && el.fillColor !== 'transparent') {
          ctx.fillStyle = el.fillColor;
          ctx.fill();
        }
        if (el.strokeColor && el.strokeWidth) {
          ctx.strokeStyle = el.strokeColor;
          ctx.lineWidth = el.strokeWidth;
          ctx.stroke();
        }
      } else if (el.type === 'divider') {
        ctx.fillStyle = el.fillColor || '#C5A880';
        ctx.fillRect(el.x, el.y, el.width, el.height);
      } else if (el.type === 'text') {
        ctx.fillStyle = el.color || '#0F1E36';
        const weight = el.fontWeight || 'normal';
        const size = el.fontSize || 16;
        const family = el.fontFamily || 'Inter, sans-serif';
        ctx.font = `${weight} ${size}px ${family}`;
        ctx.textBaseline = 'top';
        ctx.textAlign = el.align || 'left';
        const tx = el.align === 'center' ? el.x + el.width / 2 : el.align === 'right' ? el.x + el.width : el.x;
        ctx.fillText(el.content || '', tx, el.y);
      } else if (el.type === 'contact') {
        ctx.fillStyle = el.color || '#0F1E36';
        const size = el.fontSize || 14;
        const family = el.fontFamily || 'Inter, sans-serif';
        ctx.font = `500 ${size}px ${family}`;
        ctx.textBaseline = 'top';
        const textVal = el.value || '';
        ctx.fillText(textVal, el.x, el.y);
      } else if (el.type === 'photo' || el.type === 'logo') {
        if (el.assetUrl) {
          try {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            await new Promise((res) => {
              img.onload = res;
              img.onerror = res;
              img.src = el.assetUrl;
            });
            if (img.complete && img.naturalWidth) {
              const r = el.borderRadius || 0;
              ctx.save();
              drawRoundedRect(ctx, el.x, el.y, el.width, el.height, r);
              ctx.clip();
              ctx.drawImage(img, el.x, el.y, el.width, el.height);
              ctx.restore();

              if (el.borderWidth && el.borderColor) {
                ctx.save();
                drawRoundedRect(ctx, el.x, el.y, el.width, el.height, r);
                ctx.strokeStyle = el.borderColor;
                ctx.lineWidth = el.borderWidth;
                ctx.stroke();
                ctx.restore();
              }
            }
          } catch (_) {}
        }
      } else if (el.type === 'qr') {
        const r = el.borderRadius || 8;
        drawRoundedRect(ctx, el.x, el.y, el.width, el.height, r);
        ctx.fillStyle = el.bgColor || '#FFFFFF';
        ctx.fill();
        if (el.borderColor && el.borderWidth) {
          ctx.strokeStyle = el.borderColor;
          ctx.lineWidth = el.borderWidth;
          ctx.stroke();
        }

        const qrSize = Math.min(el.width, el.height) - 16;
        const qrX = el.x + 8;
        const qrY = el.y + 8;
        const cells = 21;
        const cellSize = qrSize / cells;

        ctx.fillStyle = el.fgColor || '#000000';
        const finder = (fx, fy) => {
          ctx.fillRect(qrX + fx * cellSize, qrY + fy * cellSize, 7 * cellSize, 7 * cellSize);
          ctx.fillStyle = el.bgColor || '#FFFFFF';
          ctx.fillRect(qrX + (fx + 1) * cellSize, qrY + (fy + 1) * cellSize, 5 * cellSize, 5 * cellSize);
          ctx.fillStyle = el.fgColor || '#000000';
          ctx.fillRect(qrX + (fx + 2) * cellSize, qrY + (fy + 2) * cellSize, 3 * cellSize, 3 * cellSize);
        };

        finder(0, 0);
        finder(14, 0);
        finder(0, 14);

        let h = 5381;
        const str = el.targetUrl || 'https://onevue.id';
        for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;

        for (let row = 0; row < cells; row++) {
          for (let col = 0; col < cells; col++) {
            const inFinder =
              (row < 8 && col < 8) ||
              (row < 8 && col >= 13) ||
              (row >= 13 && col < 8);
            if (!inFinder) {
              const val = ((h ^ (row * 31 + col * 17)) >>> 0) % 100;
              if (val > 48 || row === 6 || col === 6) {
                ctx.fillRect(qrX + col * cellSize, qrY + row * cellSize, cellSize * 0.9, cellSize * 0.9);
              }
            }
          }
        }
      }

      ctx.restore();
    }

    return canvas;
  }

  /** Export high-resolution PNG (Front, Back, or Both) */
  async function exportPng(designDoc, filename = 'visiting_card.png', side = 'front') {
    if (side === 'both') {
      const baseName = filename.replace(/\.png$/i, '');
      await exportPng(designDoc, `${baseName}_front.png`, 'front');
      await new Promise((res) => setTimeout(res, 500));
      await exportPng(designDoc, `${baseName}_back.png`, 'back');
      return;
    }

    const canvas = await renderCardToCanvas(designDoc, side);
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
    if (!blob) throw new Error('Could not create PNG blob');

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  /** Export 2-page print-ready PDF (Page 1 = Front, Page 2 = Back) conforming to PDF-1.4 standards */
  async function exportPdf(designDoc, filename = 'visiting_card.pdf') {
    const isVertical = designDoc.dimensions?.orientation === 'vertical';
    // Standard business card: 3.5" x 2" at 72 pt/inch = 252 x 144 points (or 144 x 252 for vertical)
    const pdfWidth = isVertical ? 144 : 252;
    const pdfHeight = isVertical ? 252 : 144;

    // 1. Render Front Side
    const canvasFront = await renderCardToCanvas(designDoc, 'front');
    const jpegFront = canvasFront.toDataURL('image/jpeg', 0.95);
    const base64Front = jpegFront.split(',')[1];
    const bytesFront = Uint8Array.from(atob(base64Front), (c) => c.charCodeAt(0));

    // 2. Render Back Side
    const canvasBack = await renderCardToCanvas(designDoc, 'back');
    const jpegBack = canvasBack.toDataURL('image/jpeg', 0.95);
    const base64Back = jpegBack.split(',')[1];
    const bytesBack = Uint8Array.from(atob(base64Back), (c) => c.charCodeAt(0));

    // PDF Object IDs:
    // 1: Catalog, 2: Pages, 3: Page 1 (Front), 4: Image Front, 5: Content 1,
    // 6: Page 2 (Back), 7: Image Back, 8: Content 2
    const objImgFront =
      `4 0 obj\n<< /Type /XObject /Subtype /Image /Width ${canvasFront.width} /Height ${canvasFront.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${bytesFront.length} >>\nstream\n`;
    const streamTrailerFront = `\nendstream\nendobj\n`;

    const contentFront = `q\n${pdfWidth} 0 0 ${pdfHeight} 0 0 cm\n/Im1 Do\nQ\n`;
    const objContentFront = `5 0 obj\n<< /Length ${contentFront.length} >>\nstream\n${contentFront}endstream\nendobj\n`;

    const objPageFront =
      `3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pdfWidth} ${pdfHeight}] /Contents 5 0 R /Resources << /XObject << /Im1 4 0 R >> >> >>\nendobj\n`;

    const objImgBack =
      `7 0 obj\n<< /Type /XObject /Subtype /Image /Width ${canvasBack.width} /Height ${canvasBack.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${bytesBack.length} >>\nstream\n`;
    const streamTrailerBack = `\nendstream\nendobj\n`;

    const contentBack = `q\n${pdfWidth} 0 0 ${pdfHeight} 0 0 cm\n/Im2 Do\nQ\n`;
    const objContentBack = `8 0 obj\n<< /Length ${contentBack.length} >>\nstream\n${contentBack}endstream\nendobj\n`;

    const objPageBack =
      `6 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pdfWidth} ${pdfHeight}] /Contents 8 0 R /Resources << /XObject << /Im2 7 0 R >> >> >>\nendobj\n`;

    const objPages = `2 0 obj\n<< /Type /Pages /Kids [3 0 R 6 0 R] /Count 2 >>\nendobj\n`;
    const objCatalog = `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n`;

    const header = `%PDF-1.4\n`;

    const part1 = new TextEncoder().encode(header + objCatalog + objPages + objPageFront + objImgFront);
    const part2 = bytesFront;
    const part3 = new TextEncoder().encode(streamTrailerFront + objContentFront + objPageBack + objImgBack);
    const part4 = bytesBack;
    const part5 = new TextEncoder().encode(streamTrailerBack + objContentBack);

    // Compute cross-reference offsets
    const o1 = header.length;
    const o2 = o1 + objCatalog.length;
    const o3 = o2 + objPages.length;
    const o4 = o3 + objPageFront.length;
    const o5 = o4 + objImgFront.length + bytesFront.length + streamTrailerFront.length;
    const o6 = o5 + objContentFront.length;
    const o7 = o6 + objPageBack.length;
    const o8 = o7 + objImgBack.length + bytesBack.length + streamTrailerBack.length;

    const xrefStart = o8 + objContentBack.length;
    const xref =
      `xref\n` +
      `0 9\n` +
      `0000000000 65535 f \n` +
      `${String(o1).padStart(10, '0')} 00000 n \n` +
      `${String(o2).padStart(10, '0')} 00000 n \n` +
      `${String(o3).padStart(10, '0')} 00000 n \n` +
      `${String(o4).padStart(10, '0')} 00000 n \n` +
      `${String(o5).padStart(10, '0')} 00000 n \n` +
      `${String(o6).padStart(10, '0')} 00000 n \n` +
      `${String(o7).padStart(10, '0')} 00000 n \n` +
      `${String(o8).padStart(10, '0')} 00000 n \n` +
      `trailer\n<< /Size 9 /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`;

    const part6 = new TextEncoder().encode(xref);

    const pdfBlob = new Blob([part1, part2, part3, part4, part5, part6], { type: 'application/pdf' });
    const url = URL.createObjectURL(pdfBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  /* -------------------------------------------------------------
     Template Design Generator (D2: Apply to Active Card)
     ------------------------------------------------------------- */
  const TEMPLATE_PRESETS = {
    'academic-classic': {
      orientation: 'horizontal',
      defaultBackground: { type: 'solid', color: '#FAF8F5' },
      backBackground: { type: 'solid', color: '#0F1E36' },
      primaryColor: '#0F1E36',
      accentColor: '#C5A880',
      fontFamily: 'Cormorant Garamond, serif',
      category: 'Student',
    },
    'minimal': {
      orientation: 'horizontal',
      defaultBackground: { type: 'solid', color: '#FFFFFF' },
      backBackground: { type: 'solid', color: '#0A0A0A' },
      primaryColor: '#0A0A0A',
      accentColor: '#525252',
      fontFamily: 'Inter, sans-serif',
      category: 'Minimal',
    },
    'corporate-vanguard': {
      orientation: 'horizontal',
      defaultBackground: { type: 'solid', color: '#0B0F19' },
      backBackground: { type: 'solid', color: '#030712' },
      primaryColor: '#F8FAFC',
      accentColor: '#38BDF8',
      fontFamily: 'Inter, sans-serif',
      category: 'Corporate',
    },
    'professional': {
      orientation: 'horizontal',
      defaultBackground: { type: 'solid', color: '#F8FAFC' },
      backBackground: { type: 'solid', color: '#0F172A' },
      primaryColor: '#0F172A',
      accentColor: '#2563EB',
      fontFamily: 'Inter, sans-serif',
      category: 'Professional',
    },
    'developer': {
      orientation: 'horizontal',
      defaultBackground: { type: 'solid', color: '#0D1117' },
      backBackground: { type: 'solid', color: '#010409' },
      primaryColor: '#E6EDF3',
      accentColor: '#10B981',
      fontFamily: 'monospace',
      category: 'Developer',
    },
    'creative': {
      orientation: 'horizontal',
      defaultBackground: {
        type: 'gradient',
        color: '#FFF7ED',
        gradient: 'linear-gradient(135deg, #FFF7ED 0%, #FEE2E2 100%)',
      },
      backBackground: { type: 'solid', color: '#EA580C' },
      primaryColor: '#1E1B4B',
      accentColor: '#EA580C',
      fontFamily: 'Inter, sans-serif',
      category: 'Creative',
    },
    'freelancer-modern': {
      orientation: 'horizontal',
      defaultBackground: { type: 'solid', color: '#FDFCF7' },
      backBackground: { type: 'solid', color: '#1C1917' },
      primaryColor: '#1C1917',
      accentColor: '#B45309',
      fontFamily: 'Inter, sans-serif',
      category: 'Freelancer',
    },
    'creator-bold': {
      orientation: 'vertical',
      defaultBackground: { type: 'solid', color: '#180828' },
      backBackground: { type: 'solid', color: '#090111' },
      primaryColor: '#FAF5FF',
      accentColor: '#A855F7',
      fontFamily: 'Inter, sans-serif',
      category: 'Creator',
    },
    'modern-business': {
      orientation: 'vertical',
      defaultBackground: { type: 'solid', color: '#F8FAF9' },
      backBackground: { type: 'solid', color: '#064E3B' },
      primaryColor: '#064E3B',
      accentColor: '#D97706',
      fontFamily: 'Inter, sans-serif',
      category: 'Business',
    },
  };

  function generateDefaultCardDesign(templateId, info = {}) {
    const tmpl = TEMPLATE_PRESETS[templateId] || TEMPLATE_PRESETS['academic-classic'];
    const name = info.name || 'Alex Mercer';
    const title = info.headline || info.degree || 'Product Specialist & Researcher';
    const institution = info.institution || 'OneVue Innovation Labs';
    const email = info.email || 'alex.mercer@onevue.id';
    const phone = info.phone || '+1 (555) 234-5678';
    const location = info.location || 'San Francisco, CA';
    const username = info.username || 'alexmercer';
    const targetUrl = `https://onevue.id/card/${username}`;
    const photoUrl = info.photoUrl || null;

    const isVertical = tmpl.orientation === 'vertical';
    const width = isVertical ? 600 : 1050;
    const height = isVertical ? 1050 : 600;

    const frontElements = [];
    const backElements = [];

    if (isVertical) {
      frontElements.push({
        id: 'el_border',
        type: 'shape',
        shapeType: 'rect',
        x: 24,
        y: 24,
        width: 552,
        height: 1002,
        strokeColor: tmpl.accentColor,
        strokeWidth: 1.5,
        fillColor: 'transparent',
        borderRadius: 16,
        zIndex: 1,
        locked: true,
      });

      if (photoUrl) {
        frontElements.push({
          id: 'el_photo',
          type: 'photo',
          x: 230,
          y: 80,
          width: 140,
          height: 140,
          assetUrl: photoUrl,
          borderRadius: 70,
          borderWidth: 2,
          borderColor: tmpl.accentColor,
          objectFit: 'cover',
          zIndex: 2,
        });
      }

      frontElements.push({
        id: 'el_name',
        type: 'text',
        x: 40,
        y: photoUrl ? 245 : 120,
        width: 520,
        height: 48,
        content: name,
        fontSize: 32,
        fontFamily: tmpl.fontFamily,
        fontWeight: '700',
        color: tmpl.primaryColor,
        align: 'center',
        zIndex: 3,
      });

      frontElements.push({
        id: 'el_title',
        type: 'text',
        x: 50,
        y: photoUrl ? 300 : 175,
        width: 500,
        height: 36,
        content: title,
        fontSize: 17,
        fontFamily: 'Inter, sans-serif',
        fontWeight: '500',
        color: tmpl.category === 'Creator' ? '#E2E8F0' : '#4B5563',
        align: 'center',
        zIndex: 3,
      });

      frontElements.push({
        id: 'el_inst',
        type: 'text',
        x: 50,
        y: photoUrl ? 340 : 215,
        width: 500,
        height: 30,
        content: institution,
        fontSize: 14,
        fontFamily: 'Inter, sans-serif',
        fontWeight: '600',
        color: tmpl.accentColor,
        align: 'center',
        zIndex: 3,
      });

      frontElements.push({
        id: 'el_divider',
        type: 'divider',
        x: 100,
        y: photoUrl ? 390 : 265,
        width: 400,
        height: 2,
        fillColor: tmpl.accentColor,
        zIndex: 2,
      });

      let curY = photoUrl ? 420 : 295;
      if (email) {
        frontElements.push({
          id: 'el_email',
          type: 'contact',
          fieldKey: 'email',
          label: 'Email',
          value: email,
          x: 60,
          y: curY,
          width: 480,
          height: 36,
          color: tmpl.primaryColor,
          zIndex: 3,
        });
        curY += 45;
      }
      if (phone) {
        frontElements.push({
          id: 'el_phone',
          type: 'contact',
          fieldKey: 'phone',
          label: 'Phone',
          value: phone,
          x: 60,
          y: curY,
          width: 480,
          height: 36,
          color: tmpl.primaryColor,
          zIndex: 3,
        });
        curY += 45;
      }
      if (location) {
        frontElements.push({
          id: 'el_location',
          type: 'contact',
          fieldKey: 'location',
          label: 'Location',
          value: location,
          x: 60,
          y: curY,
          width: 480,
          height: 36,
          color: tmpl.primaryColor,
          zIndex: 3,
        });
        curY += 45;
      }

      frontElements.push({
        id: 'el_qr',
        type: 'qr',
        x: 215,
        y: 810,
        width: 170,
        height: 170,
        targetUrl,
        fgColor: '#000000',
        bgColor: '#FFFFFF',
        borderRadius: 12,
        zIndex: 4,
      });

      // Back Elements (Vertical)
      backElements.push({
        id: 'el_back_border',
        type: 'shape',
        shapeType: 'rect',
        x: 24,
        y: 24,
        width: 552,
        height: 1002,
        strokeColor: tmpl.accentColor,
        strokeWidth: 1.5,
        fillColor: 'transparent',
        borderRadius: 16,
        zIndex: 1,
        locked: true,
      });

      backElements.push({
        id: 'el_back_brand',
        type: 'text',
        x: 50,
        y: 375,
        width: 500,
        height: 30,
        content: 'ONEVUE VERIFIED PROFILE',
        fontSize: 12.5,
        fontFamily: 'Inter, sans-serif',
        fontWeight: '600',
        color: tmpl.accentColor,
        letterSpacing: 2,
        align: 'center',
        zIndex: 3,
      });

      backElements.push({
        id: 'el_back_qr',
        type: 'qr',
        x: 185,
        y: 480,
        width: 230,
        height: 230,
        targetUrl,
        fgColor: '#000000',
        bgColor: '#FFFFFF',
        borderRadius: 16,
        zIndex: 4,
      });

      backElements.push({
        id: 'el_back_scan_hint',
        type: 'text',
        x: 50,
        y: 740,
        width: 500,
        height: 28,
        content: 'Scan with camera to connect instantly',
        fontSize: 14,
        fontFamily: 'Inter, sans-serif',
        color: '#94A3B8',
        align: 'center',
        zIndex: 3,
      });
    } else {
      // Horizontal Card Layout (1050 × 600 px)
      frontElements.push({
        id: 'el_border',
        type: 'shape',
        shapeType: 'rect',
        x: 30,
        y: 30,
        width: 990,
        height: 540,
        strokeColor: tmpl.accentColor,
        strokeWidth: 1.5,
        fillColor: 'transparent',
        borderRadius: 12,
        zIndex: 1,
        locked: true,
      });

      if (photoUrl) {
        frontElements.push({
          id: 'el_photo',
          type: 'photo',
          x: 70,
          y: 75,
          width: 120,
          height: 120,
          assetUrl: photoUrl,
          borderRadius: 60,
          borderWidth: 2,
          borderColor: tmpl.accentColor,
          objectFit: 'cover',
          zIndex: 2,
        });
      }

      const textStartX = photoUrl ? 210 : 80;
      frontElements.push({
        id: 'el_name',
        type: 'text',
        x: textStartX,
        y: 75,
        width: 500,
        height: 44,
        content: name,
        fontSize: 34,
        fontFamily: tmpl.fontFamily,
        fontWeight: '700',
        color: tmpl.primaryColor,
        zIndex: 3,
      });

      frontElements.push({
        id: 'el_title',
        type: 'text',
        x: textStartX,
        y: 125,
        width: 480,
        height: 30,
        content: title,
        fontSize: 16,
        fontFamily: 'Inter, sans-serif',
        fontWeight: '500',
        color: tmpl.category === 'Developer' ? '#34D399' : '#4B5563',
        zIndex: 3,
      });

      frontElements.push({
        id: 'el_inst',
        type: 'text',
        x: textStartX,
        y: 158,
        width: 480,
        height: 28,
        content: institution,
        fontSize: 14,
        fontFamily: 'Inter, sans-serif',
        fontWeight: '600',
        color: tmpl.accentColor,
        zIndex: 3,
      });

      frontElements.push({
        id: 'el_divider',
        type: 'divider',
        x: 80,
        y: 220,
        width: 620,
        height: 2,
        fillColor: tmpl.accentColor,
        zIndex: 2,
      });

      // Contacts left column
      let curY = 250;
      if (email) {
        frontElements.push({
          id: 'el_email',
          type: 'contact',
          fieldKey: 'email',
          label: 'Email',
          value: email,
          x: 80,
          y: curY,
          width: 320,
          height: 32,
          color: tmpl.primaryColor,
          zIndex: 3,
        });
        curY += 40;
      }
      if (phone) {
        frontElements.push({
          id: 'el_phone',
          type: 'contact',
          fieldKey: 'phone',
          label: 'Phone',
          value: phone,
          x: 80,
          y: curY,
          width: 320,
          height: 32,
          color: tmpl.primaryColor,
          zIndex: 3,
        });
        curY += 40;
      }
      if (location) {
        frontElements.push({
          id: 'el_location',
          type: 'contact',
          fieldKey: 'location',
          label: 'Location',
          value: location,
          x: 80,
          y: curY,
          width: 320,
          height: 32,
          color: tmpl.primaryColor,
          zIndex: 3,
        });
      }

      // QR Code right side
      frontElements.push({
        id: 'el_qr',
        type: 'qr',
        x: 810,
        y: 75,
        width: 160,
        height: 160,
        targetUrl,
        fgColor: '#000000',
        bgColor: '#FFFFFF',
        borderRadius: 12,
        zIndex: 4,
      });

      // Back Elements (Horizontal)
      backElements.push({
        id: 'el_back_border',
        type: 'shape',
        shapeType: 'rect',
        x: 30,
        y: 30,
        width: 990,
        height: 540,
        strokeColor: tmpl.accentColor,
        strokeWidth: 1.5,
        fillColor: 'transparent',
        borderRadius: 12,
        zIndex: 1,
        locked: true,
      });

      backElements.push({
        id: 'el_back_monogram',
        type: 'text',
        x: 275,
        y: 80,
        width: 500,
        height: 80,
        content: name
          .split(/\s+/)
          .map((n) => n[0])
          .join('')
          .toUpperCase()
          .slice(0, 3) || 'OV',
        fontSize: 64,
        fontFamily: tmpl.fontFamily,
        fontWeight: '700',
        color: tmpl.accentColor,
        align: 'center',
        zIndex: 3,
      });

      backElements.push({
        id: 'el_back_name',
        type: 'text',
        x: 275,
        y: 190,
        width: 500,
        height: 48,
        content: name,
        fontSize: 32,
        fontFamily: tmpl.fontFamily,
        fontWeight: '700',
        color: '#FFFFFF',
        align: 'center',
        zIndex: 3,
      });

      backElements.push({
        id: 'el_back_inst',
        type: 'text',
        x: 275,
        y: 250,
        width: 500,
        height: 32,
        content: institution,
        fontSize: 16,
        fontFamily: 'Inter, sans-serif',
        fontWeight: '600',
        color: tmpl.accentColor,
        align: 'center',
        zIndex: 3,
      });

      backElements.push({
        id: 'el_back_tagline',
        type: 'text',
        x: 275,
        y: 300,
        width: 500,
        height: 28,
        content: 'ONEVUE VERIFIED DIGITAL IDENTITY',
        fontSize: 12,
        fontFamily: 'Inter, sans-serif',
        fontWeight: '600',
        color: 'rgba(255, 255, 255, 0.6)',
        letterSpacing: 2,
        align: 'center',
        zIndex: 3,
      });

      backElements.push({
        id: 'el_back_qr',
        type: 'qr',
        x: 445,
        y: 350,
        width: 160,
        height: 160,
        targetUrl,
        fgColor: '#000000',
        bgColor: '#FFFFFF',
        borderRadius: 12,
        zIndex: 4,
      });

      backElements.push({
        id: 'el_back_url',
        type: 'text',
        x: 275,
        y: 525,
        width: 500,
        height: 28,
        content: `https://onevue.id/card/${username}`,
        fontSize: 13,
        fontFamily: 'monospace',
        color: tmpl.accentColor,
        align: 'center',
        zIndex: 3,
      });
    }

    const frontBg = {
      type: tmpl.defaultBackground.type,
      color: tmpl.defaultBackground.color,
      gradient: tmpl.defaultBackground.gradient,
      opacity: 1,
    };

    const backBg = {
      type: tmpl.backBackground.type,
      color: tmpl.backBackground.color,
      gradient: tmpl.backBackground.gradient,
      opacity: 1,
    };

    return {
      dimensions: {
        width,
        height,
        orientation: tmpl.orientation,
        unit: 'px',
      },
      background: frontBg,
      elements: frontElements,
      front: {
        background: frontBg,
        elements: frontElements,
      },
      back: {
        background: backBg,
        elements: backElements,
      },
    };
  }

  window.generateDefaultCardDesign = generateDefaultCardDesign;

  window.OV.services.visitingCard = {
    getCard,
    createCard,
    duplicateCard,
    deleteCard,
    saveCard,
    publishCard,
    unpublishCard,
    uploadAsset,
    getPublicCard,
    exportVCard,
    renderCardToCanvas,
    exportPng,
    exportPdf,
    generateDefaultCardDesign,
  };
})();
