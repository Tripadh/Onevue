/* Hero gem — three.js onevueed gem (desktop) with an SVG/CSS fallback (mobile, low-power,
   reduced motion, no WebGL). All colors read live from theme CSS variables. */
const { useEffect: gmUseEffect, useRef: gmUseRef, useState: gmUseState, useMemo: gmUseMemo } = React;

const GEM_ONEVUES = ['Recruiter', 'Client', 'College', 'Contact', 'Business'];

function canUseWebGL() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl') || c.getContext('experimental-webgl')));
  } catch (e) { return false; }
}
function isLowPower() {
  const n = navigator;
  return (n.connection && n.connection.saveData) || (n.hardwareConcurrency && n.hardwareConcurrency <= 2) || (n.deviceMemory && n.deviceMemory <= 2);
}
let threePromise = null;
function loadThree() {
  if (window.THREE) return Promise.resolve(window.THREE);
  if (!threePromise) threePromise = new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
    s.onload = () => res(window.THREE); s.onerror = rej; document.head.appendChild(s);
  });
  return threePromise;
}

/* ---------------- WebGL gem ---------------- */
function GemCanvas({ onPick, onFail }) {
  const host = gmUseRef(null);
  const labelsRef = gmUseRef([]);
  const [hover, setHover] = gmUseState(-1);
  const hoverRef = gmUseRef(-1);

  gmUseEffect(() => {
    let disposed = false, raf = 0, cleanup = () => {};
    loadThree().then((THREE) => {
      if (disposed || !host.current) return;
      const el = host.current;
      let renderer;
      try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' }); }
      catch (e) { onFail(); return; }
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.outputEncoding = THREE.sRGBEncoding;
      renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.15;
      el.appendChild(renderer.domElement);
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(32, 1, .1, 50);
      camera.position.set(0, .55, 6.2); camera.lookAt(0, -.05, 0);

      // ---- geometry: 10-sided brilliant split into 5 audience wedges ----
      const N = 10, R = 1.25, TABLE_R = .7, TABLE_Y = .52, MID_R = .62, MID_Y = -.62, CULET_Y = -1.42;
      const ring = (r, y, off) => Array.from({ length: N }, (_, i) => { const a = (i + off) / N * Math.PI * 2; return new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r); });
      const G = ring(R, 0, 0), T = ring(TABLE_R, TABLE_Y, .5), M = ring(MID_R, MID_Y, .5);
      const TC = new THREE.Vector3(0, TABLE_Y, 0), C = new THREE.Vector3(0, CULET_Y, 0);
      const tris = [];
      for (let i = 0; i < N; i++) {
        const j = (i + 1) % N, k = (i - 1 + N) % N;
        tris.push([TC, T[i], T[k]]);           // table
        tris.push([G[i], T[k], T[i]]);         // crown kite a
        tris.push([G[i], T[i], G[j]]);         // crown star
        tris.push([G[j], T[i], M[i]].reverse()); // pavilion upper
        tris.push([G[i], G[j], M[i]].reverse().reverse());
        tris.push([M[i], M[k], C].reverse());  // pavilion lower
        tris.push([G[i], M[k], M[i]]);
      }
      const sectorOf = (cx, cz) => { let a = Math.atan2(cz, cx); if (a < 0) a += Math.PI * 2; return Math.floor(a / (Math.PI * 2 / 5)) % 5; };
      const buckets = [[], [], [], [], []];
      tris.forEach(t => {
        const c = new THREE.Vector3().add(t[0]).add(t[1]).add(t[2]).divideScalar(3);
        // ensure outward winding
        const n = new THREE.Vector3().subVectors(t[1], t[0]).cross(new THREE.Vector3().subVectors(t[2], t[0]));
        const out = c.clone(); if (Math.abs(out.x) + Math.abs(out.z) < .01) out.set(0, c.y > 0 ? 1 : -1, 0);
        const tri = n.dot(out) < 0 ? [t[0], t[2], t[1]] : t;
        buckets[sectorOf(c.x, c.z)].push(tri);
      });

      const gem = new THREE.Group(); scene.add(gem);
      const mats = [], edgeMats = [], meshes = [];
      buckets.forEach((list, s) => {
        const pos = new Float32Array(list.length * 9);
        list.forEach((t, i) => t.forEach((v, j) => { pos[i * 9 + j * 3] = v.x; pos[i * 9 + j * 3 + 1] = v.y; pos[i * 9 + j * 3 + 2] = v.z; }));
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.computeVertexNormals();
        const m = new THREE.MeshPhysicalMaterial({ flatShading: true, metalness: .25, roughness: .12, clearcoat: 1, clearcoatRoughness: .08, reflectivity: .9, transparent: true, opacity: .94 });
        const mesh = new THREE.Mesh(g, m); mesh.userData.sector = s; gem.add(mesh); mats.push(m); meshes.push(mesh);
        const e = new THREE.LineSegments(new THREE.EdgesGeometry(g, 1), new THREE.LineBasicMaterial({ transparent: true, opacity: .55 }));
        gem.add(e); edgeMats.push(e.material);
      });
      // girdle band in platinum
      const girdle = new THREE.Mesh(new THREE.CylinderGeometry(R * 1.002, R * 1.002, .045, N, 1, true), new THREE.MeshStandardMaterial({ metalness: 1, roughness: .25, side: THREE.DoubleSide }));
      girdle.rotation.y = 0; gem.add(girdle);

      // anchors for labels (crown midpoints of each wedge)
      const anchors = GEM_ONEVUES.map((_, s) => { const a = (s + .5) * (Math.PI * 2 / 5); return new THREE.Vector3(Math.cos(a) * 1.02, .22, Math.sin(a) * 1.02); });

      // lights
      const amb = new THREE.AmbientLight(0xffffff, .35); scene.add(amb);
      const key = new THREE.DirectionalLight(0xffffff, 1.6); key.position.set(3, 5, 4); scene.add(key);
      const rim = new THREE.PointLight(0xffffff, 2.2, 20); rim.position.set(-4, 1.5, -2); scene.add(rim);
      const warm = new THREE.PointLight(0xffffff, 1.4, 20); warm.position.set(2.5, -2.5, 3); scene.add(warm);
      const top = new THREE.PointLight(0xffffff, 1.2, 12); top.position.set(0, 4, 1); scene.add(top);

      // theme colors
      const col = (s) => { const c = new THREE.Color(); try { c.setStyle(s); } catch (e) {} return c; };
      let isLight = false;
      function applyTheme() {
        const t = window.OV.theme.readTokens(['primary', 'soft', 'metal', 'accent', 'bg-2']);
        isLight = document.documentElement.getAttribute('data-theme') === 'ivory';
        const base = col(t.primary);
        mats.forEach((m, i) => {
          m.color.copy(base);
          m.emissive.copy(col(t.primary)).multiplyScalar(i === hoverRef.current ? .55 : .08);
        });
        edgeMats.forEach(m => { m.color.copy(col(t.metal)); m.opacity = isLight ? .75 : .5; });
        girdle.material.color.copy(col(t.metal));
        rim.color.copy(col(t.soft)); warm.color.copy(col(t.accent)); top.color.copy(col(t.metal));
        amb.intensity = isLight ? .6 : .32;
      }
      applyTheme();
      let fadeUntil = 0;
      const unsub = window.OV.theme.subscribe(() => { fadeUntil = performance.now() + 900; });

      // sizing
      const resize = () => { const w = el.clientWidth, h = el.clientHeight; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); };
      resize(); const ro = new ResizeObserver(resize); ro.observe(el);

      // input
      const ray = new THREE.Raycaster(), ptr = new THREE.Vector2(9, 9);
      let tx = 0, ty = 0, px = 0, py = 0, inside = false;
      const onMove = (e) => {
        const r = el.getBoundingClientRect();
        ptr.x = ((e.clientX - r.left) / r.width) * 2 - 1; ptr.y = -((e.clientY - r.top) / r.height) * 2 + 1;
        tx = (e.clientX / window.innerWidth - .5); ty = (e.clientY / window.innerHeight - .5);
        inside = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
      };
      const onClick = () => { if (hoverRef.current >= 0) onPick(GEM_ONEVUES[hoverRef.current]); };
      window.addEventListener('pointermove', onMove, { passive: true });
      el.addEventListener('click', onClick);

      // visibility pause
      let visible = true;
      const io = new IntersectionObserver(([en]) => { visible = en.isIntersecting; }, { threshold: 0 }); io.observe(el);

      let rot = 0, last = performance.now();
      const v = new THREE.Vector3(), camDir = new THREE.Vector3();
      const loop = (now) => {
        raf = requestAnimationFrame(loop);
        if (!visible || document.hidden) { last = now; return; }
        const dt = Math.min(.05, (now - last) / 1000); last = now;
        rot += dt * (hoverRef.current >= 0 ? .04 : .16);
        px += (tx - px) * .05; py += (ty - py) * .05;
        gem.rotation.set(.18 + py * .35, rot + px * .6, px * -.08);
        gem.position.y = Math.sin(now / 1600) * .05;
        if (now < fadeUntil) applyTheme();

        // hover pick
        let h = -1;
        if (inside) { ray.setFromCamera(ptr, camera); const hit = ray.intersectObjects(meshes, false)[0]; if (hit) h = hit.object.userData.sector; }
        if (h !== hoverRef.current) { hoverRef.current = h; setHover(h); el.style.cursor = h >= 0 ? 'pointer' : ''; applyTheme(); }

        // labels
        camera.getWorldDirection(camDir);
        anchors.forEach((a, i) => {
          const lab = labelsRef.current[i]; if (!lab) return;
          v.copy(a).applyMatrix4(gem.matrixWorld);
          const normal = v.clone().sub(gem.position).setY(0).normalize();
          const facing = -normal.dot(camDir.clone().setY(0).normalize());
          const out = v.clone().add(normal.multiplyScalar(.55));
          out.project(camera);
          const x = (out.x * .5 + .5) * el.clientWidth, y = (-out.y * .5 + .5) * el.clientHeight;
          const o = Math.max(0, Math.min(1, (facing + .05) * 2.2));
          lab.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%)`;
          lab.style.opacity = (i === hoverRef.current ? 1 : o).toFixed(3);
          lab.style.pointerEvents = o > .4 ? 'auto' : 'none';
          lab.style.zIndex = Math.round(o * 10);
        });
        renderer.render(scene, camera);
      };
      raf = requestAnimationFrame(loop);

      cleanup = () => {
        cancelAnimationFrame(raf); ro.disconnect(); io.disconnect(); unsub();
        window.removeEventListener('pointermove', onMove); el.removeEventListener('click', onClick);
        scene.traverse(o => { o.geometry && o.geometry.dispose(); o.material && o.material.dispose(); });
        renderer.dispose(); renderer.domElement.remove();
      };
    }).catch(() => onFail());
    return () => { disposed = true; cleanup(); };
  }, []);

  return (
    <div className="gem-stage" ref={host}>
      {GEM_ONEVUES.map((f, i) => (
        <button key={f} ref={el => labelsRef.current[i] = el} className={'gem-label' + (hover === i ? ' is-hot' : '')}
          onPointerEnter={() => { hoverRef.current = i; setHover(i); }} onClick={() => onPick(f)} aria-label={'See the ' + f + ' view'}>
          <span className="gem-label-dot" />{f}
        </button>
      ))}
    </div>
  );
}

/* ---------------- CSS / SVG fallback gem ---------------- */
function GemFallback({ onPick }) {
  const [hot, setHot] = gmUseState(-1);
  // Side-profile brilliant: crown onevues grouped into 5 audience sectors.
  const W = 300, gy = 118, top = 40, cul = 268;
  const xs = [20, 70, 120, 180, 230, 280];       // girdle/crown breakpoints
  const tx = [78, 112, 150, 188, 222];           // table points
  const sectors = [0, 1, 2, 3, 4].map(i => ({
    crown: `${xs[i]},${gy} ${tx[i] - (i === 0 ? 0 : 0)},${top} ${tx[i + 1] || 222},${top} ${xs[i + 1]},${gy}`,
    pav: `${xs[i]},${gy} ${xs[i + 1]},${gy} ${150},${cul}`,
  }));
  return (
    <div className="gem-fallback" role="group" aria-label="Five audience onevues">
      <svg viewBox={`0 0 ${W} 290`} className="gem-svg" aria-hidden="true">
        <defs>
          <linearGradient id="gf-c" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="var(--soft)" stopOpacity=".95" /><stop offset="1" stopColor="var(--primary)" /></linearGradient>
          <linearGradient id="gf-p" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--primary)" /><stop offset="1" stopColor="var(--bg-0)" /></linearGradient>
        </defs>
        {sectors.map((s, i) => (
          <g key={i} className={'gf-sector' + (hot === i ? ' is-hot' : '')} style={{ '--i': i }}>
            <polygon points={s.crown} fill="url(#gf-c)" style={{ opacity: .55 + (i % 2) * .25 }} />
            <polygon points={s.pav} fill="url(#gf-p)" style={{ opacity: .7 + ((i + 1) % 2) * .25 }} />
          </g>
        ))}
        <polygon points={`${tx[0]},${top} ${tx[4]},${top} ${tx[4] + 6},${top + 4} ${tx[0] - 6},${top + 4}`} fill="var(--metal)" opacity=".5" />
        <line x1="18" y1={gy} x2="282" y2={gy} stroke="var(--metal)" strokeWidth="2.2" opacity=".85" />
        <g stroke="var(--metal)" strokeWidth=".9" fill="none" opacity=".6">
          {sectors.map((s, i) => <polygon key={i} points={s.crown} />)}
          {sectors.map((s, i) => <polygon key={'p' + i} points={s.pav} />)}
        </g>
        <polygon className="gf-sheen" points={`${tx[1]},${top} ${tx[2] + 6},${top} 96,${gy} 60,${gy}`} fill="var(--metal)" />
      </svg>
      <div className="gf-labels">
        {GEM_ONEVUES.map((f, i) => (
          <button key={f} className={'gem-label static' + (hot === i ? ' is-hot' : '')} onPointerEnter={() => setHot(i)} onPointerLeave={() => setHot(-1)}
            onFocus={() => setHot(i)} onBlur={() => setHot(-1)} onClick={() => onPick(f)} aria-label={'See the ' + f + ' view'}>
            <span className="gem-label-dot" />{f}
          </button>
        ))}
      </div>
    </div>
  );
}

function HeroGem({ onPick }) {
  const reduced = usePrefersReducedMotion();
  const small = useMediaQuery('(max-width: 899px)');
  const [failed, setFailed] = gmUseState(false);
  const use3D = gmUseMemo(() => !failed && !small && !reduced && !isLowPower() && canUseWebGL(), [failed, small, reduced]);
  return (
    <div className="hero-gem">
      <div className="gem-halo" aria-hidden="true" />
      {use3D ? <GemCanvas onPick={onPick} onFail={() => setFailed(true)} /> : <GemFallback onPick={onPick} />}
    </div>
  );
}

Object.assign(window, { HeroGem, GEM_ONEVUES });

