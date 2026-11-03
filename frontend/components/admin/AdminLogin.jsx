/**
 * OneVue Organization Admin Login Gateway
 * Strict URL: #/admin/login
 * ZERO SIGNUP. Only authenticated administrators can log in.
 */
(function () {
  'use strict';
  const { useState, useEffect } = React;
  const { useNavigate, Link } = ReactRouterDOM;

  function AdminLogin() {
    const navigate = useNavigate();
    const toast = window.useToast ? window.useToast() : { push: () => {} };

    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [loading, setLoading] = useState(false);
    const [errorMsg, setErrorMsg] = useState(null);

    const handleLogin = async (e) => {
      e.preventDefault();
      if (!email.trim() || !password) {
        setErrorMsg('Please enter both administrative email and password.');
        return;
      }

      setLoading(true);
      setErrorMsg(null);

      try {
        const session = await window.OV.services.admin.login(email.trim(), password);
        toast.push({
          title: 'Access Granted',
          body: `Authenticated as ${session.user.role.toUpperCase()} (${session.user.name})`,
          tone: 'success',
        });
        navigate('/admin/overview');
      } catch (err) {
        setErrorMsg(err.message || 'Authentication failed. Please verify credentials.');
      } finally {
        setLoading(false);
      }
    };

    return (
      <main id="main" className="wrap" style={{ minHeight: '88vh', display: 'grid', placeItems: 'center', padding: '60px 16px' }}>
        <div style={{ width: '100%', maxWidth: 440 }}>
          {/* Top Security Branding */}
          <div style={{ textAlign: 'center', marginBottom: 28 }}>
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 14px',
              borderRadius: 20,
              background: 'rgba(239, 68, 68, 0.12)',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              color: '#f87171',
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
              marginBottom: 16,
            }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ef4444', boxShadow: '0 0 10px #ef4444' }} />
              Restricted Security Gateway
            </div>

            <h1 className="h-display" style={{ fontSize: 32, fontWeight: 600, margin: '0 0 8px', letterSpacing: '-0.02em' }}>
              OneVue Admin
            </h1>
            <p className="muted" style={{ fontSize: 14, margin: 0 }}>
              Organization domain management & governance console
            </p>
          </div>

          {/* Secure Login Glass Card */}
          <div className="glass-card" style={{
            padding: '36px 32px',
            borderRadius: 20,
            border: '1px solid rgba(255, 255, 255, 0.1)',
            boxShadow: '0 24px 48px rgba(0, 0, 0, 0.4), 0 0 80px rgba(99, 102, 241, 0.08)',
          }}>
            {errorMsg && (
              <div style={{
                padding: '12px 14px',
                borderRadius: 10,
                background: 'rgba(239, 68, 68, 0.15)',
                border: '1px solid rgba(239, 68, 68, 0.35)',
                color: '#fca5a5',
                fontSize: 13,
                marginBottom: 20,
                display: 'flex',
                alignItems: 'center',
                gap: 10,
              }}>
                <span style={{ fontSize: 16 }}>⚠️</span>
                <span>{errorMsg}</span>
              </div>
            )}

            <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              {/* Email Input */}
              <div>
                <label className="label" htmlFor="admin-email" style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 8, color: 'var(--text-2, #94a3b8)' }}>
                  Administrative Email
                </label>
                <div style={{ position: 'relative' }}>
                  <input
                    id="admin-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    placeholder="Enter administrative email"
                    autoComplete="username"
                    className="input"
                    style={{
                      width: '100%',
                      padding: '12px 14px',
                      borderRadius: 10,
                      background: 'rgba(255, 255, 255, 0.04)',
                      border: '1px solid rgba(255, 255, 255, 0.12)',
                      color: '#fff',
                      fontSize: 14,
                      outline: 'none',
                      transition: 'border-color 0.2s',
                    }}
                  />
                </div>
              </div>

              {/* Password Input */}
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                  <label className="label" htmlFor="admin-password" style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-2, #94a3b8)', margin: 0 }}>
                    Master Security Key / Password
                  </label>
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: 'var(--accent, #818cf8)',
                      fontSize: 12,
                      cursor: 'pointer',
                      padding: 0,
                    }}
                  >
                    {showPassword ? 'Hide' : 'Show'}
                  </button>
                </div>
                <div style={{ position: 'relative' }}>
                  <input
                    id="admin-password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    placeholder="••••••••••••"
                    autoComplete="current-password"
                    className="input"
                    style={{
                      width: '100%',
                      padding: '12px 14px',
                      borderRadius: 10,
                      background: 'rgba(255, 255, 255, 0.04)',
                      border: '1px solid rgba(255, 255, 255, 0.12)',
                      color: '#fff',
                      fontSize: 14,
                      outline: 'none',
                    }}
                  />
                </div>
              </div>

              {/* Sign In Button (Zero Signup anywhere) */}
              <button
                type="submit"
                disabled={loading}
                className="btn btn-primary"
                style={{
                  width: '100%',
                  padding: '13px',
                  borderRadius: 10,
                  fontSize: 15,
                  fontWeight: 600,
                  marginTop: 6,
                  display: 'flex',
                  justifyContent: 'center',
                  alignItems: 'center',
                  gap: 10,
                  cursor: loading ? 'not-allowed' : 'pointer',
                  opacity: loading ? 0.7 : 1,
                }}
              >
                {loading ? (
                  <>
                    <span className="spin" style={{ width: 18, height: 18, border: '2px solid rgba(255,255,255,0.3)', borderTopColor: '#fff', borderRadius: '50%', display: 'inline-block' }} />
                    <span>Verifying Access Rights...</span>
                  </>
                ) : (
                  <>
                    <span>Authenticate & Access Console</span>
                    <span style={{ fontSize: 16 }}>→</span>
                  </>
                )}
              </button>
            </form>

            {/* Strict Notice: ZERO SIGNUP */}
            <div style={{
              marginTop: 24,
              paddingTop: 18,
              borderTop: '1px solid rgba(255, 255, 255, 0.08)',
              textAlign: 'center',
            }}>
              <p style={{ fontSize: 12, color: 'var(--muted, #64748b)', margin: 0, lineHeight: 1.5 }}>
                Public registration is strictly disabled for this portal.<br />
                All administrative access attempts are monitored and logged.
              </p>
            </div>
          </div>

          {/* Back to Onevue home */}
          <div style={{ textAlign: 'center', marginTop: 24 }}>
            <Link to="/" style={{ fontSize: 13, color: 'var(--muted, #64748b)', textDecoration: 'none' }}>
              ← Return to OneVue Platform
            </Link>
          </div>
        </div>
      </main>
    );
  }

  window.AdminLogin = AdminLogin;
})();
