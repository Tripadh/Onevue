/* =========================================================================
   OneVue — Production-Quality Student Profile & Photo Management Page
   ========================================================================= */

(function () {
  const { useState, useEffect, useRef, useMemo } = React;

  function StudentProfilePage({ session, onSessionUpdate }) {
    const toast = useToast();
    const user = session?.user || {};

    // Form state
    const [name, setName] = useState(user.name || '');
    const [username, setUsername] = useState(user.username || '');
    const [bio, setBio] = useState(user.bio || '');
    const [location, setLocation] = useState(user.location || '');
    const [fieldErrors, setFieldErrors] = useState({});
    const [savingProfile, setSavingProfile] = useState(false);

    // Photo state
    const [photoUrl, setPhotoUrl] = useState(user.profilePhotoUrl || null);
    const [uploadingPhoto, setUploadingPhoto] = useState(false);
    const [removingPhoto, setRemovingPhoto] = useState(false);
    const [showRemoveConfirm, setShowRemoveConfirm] = useState(false);

    // Interactive Crop / Preview Modal State
    const [pendingImageSrc, setPendingImageSrc] = useState(null);
    const [pendingFile, setPendingFile] = useState(null);
    const [cropZoom, setCropZoom] = useState(1.0);
    const [cropOffset, setCropOffset] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const dragStartRef = useRef({ x: 0, y: 0 });
    const fileInputRef = useRef(null);
    const previewCanvasRef = useRef(null);

    // Password Modal State
    const [showPasswordModal, setShowPasswordModal] = useState(false);
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [passwordError, setPasswordError] = useState(null);
    const [savingPassword, setSavingPassword] = useState(false);

    // Synchronize local states when session updates
    useEffect(() => {
      if (session?.user) {
        setName(session.user.name || '');
        setUsername(session.user.username || '');
        setBio(session.user.bio || '');
        setLocation(session.user.location || '');
        setPhotoUrl(session.user.profilePhotoUrl || null);
      }
    }, [session?.user]);

    // Compute user initials for fallback avatar
    const initials = useMemo(() => {
      const source = name || user.name || 'User';
      return source
        .split(/\s+/)
        .map((w) => w[0])
        .join('')
        .slice(0, 2)
        .toUpperCase();
    }, [name, user.name]);

    // Handle file selection from local device
    const handleFileSelect = (e) => {
      const file = e.target.files?.[0];
      if (!file) return;

      // 1. Client-side size validation (2 MB)
      const maxBytes = 2 * 1024 * 1024;
      if (file.size > maxBytes) {
        toast.push({
          title: 'File Too Large',
          body: `Selected file is ${(file.size / (1024 * 1024)).toFixed(2)} MB. Maximum allowed size is 2 MB.`,
          tone: 'error',
        });
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
      }

      // 2. Client-side MIME check
      const validTypes = ['image/jpeg', 'image/png', 'image/webp'];
      if (!validTypes.includes(file.type)) {
        toast.push({
          title: 'Unsupported Format',
          body: 'Please choose a JPEG, PNG, or WebP image.',
          tone: 'error',
        });
        if (fileInputRef.current) fileInputRef.current.value = '';
        return;
      }

      // Read as Data URL to preview in the crop/zoom editor
      const reader = new FileReader();
      reader.onload = (loadEvent) => {
        setPendingImageSrc(loadEvent.target.result);
        setPendingFile(file);
        setCropZoom(1.0);
        setCropOffset({ x: 0, y: 0 });
      };
      reader.readAsDataURL(file);

      // Reset file input so selecting the same file again works
      if (fileInputRef.current) fileInputRef.current.value = '';
    };

    // Pan / Drag handlers for Crop preview
    const handleMouseDown = (e) => {
      setIsDragging(true);
      dragStartRef.current = { x: e.clientX - cropOffset.x, y: e.clientY - cropOffset.y };
    };
    const handleMouseMove = (e) => {
      if (!isDragging) return;
      setCropOffset({
        x: e.clientX - dragStartRef.current.x,
        y: e.clientY - dragStartRef.current.y,
      });
    };
    const handleMouseUp = () => setIsDragging(false);

    // Generate squared cropped blob and upload
    const handleConfirmCropAndUpload = async () => {
      if (!pendingImageSrc) return;
      setUploadingPhoto(true);

      try {
        // Render to square 400x400 canvas
        const canvas = document.createElement('canvas');
        canvas.width = 400;
        canvas.height = 400;
        const ctx = canvas.getContext('2d');

        const img = new Image();
        img.crossOrigin = 'anonymous';
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = reject;
          img.src = pendingImageSrc;
        });

        // Compute aspect fill centering with user crop/zoom
        const baseScale = Math.max(400 / img.width, 400 / img.height);
        const finalScale = baseScale * cropZoom;
        const drawWidth = img.width * finalScale;
        const drawHeight = img.height * finalScale;
        const drawX = (400 - drawWidth) / 2 + cropOffset.x;
        const drawY = (400 - drawHeight) / 2 + cropOffset.y;

        ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight);

        // Convert canvas to blob
        const blob = await new Promise((resolve) =>
          canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.92)
        );

        if (!blob) throw new Error('Failed to render cropped image');

        // Wrap as File object
        const uploadFile = new File([blob], `avatar_${Date.now()}.jpg`, { type: 'image/jpeg' });

        // Dispatch to auth service
        const res = await window.OV.services.auth.uploadProfilePhoto(uploadFile);

        setPhotoUrl(res.profilePhotoUrl);
        setPendingImageSrc(null);
        setPendingFile(null);

        toast.push({
          title: 'Photo Updated',
          body: 'Your profile photo has been updated successfully.',
          tone: 'success',
        });

        if (typeof onSessionUpdate === 'function') {
          onSessionUpdate();
        }
      } catch (err) {
        toast.push({
          title: 'Upload Failed',
          body: err.message || 'Could not upload photo. Please try again.',
          tone: 'error',
        });
      } finally {
        setUploadingPhoto(false);
      }
    };

    // Remove current photo
    const handleRemovePhoto = async () => {
      setRemovingPhoto(true);
      try {
        await window.OV.services.auth.removeProfilePhoto();
        setPhotoUrl(null);
        setShowRemoveConfirm(false);

        toast.push({
          title: 'Photo Removed',
          body: 'Your profile photo has been removed.',
          tone: 'info',
        });

        if (typeof onSessionUpdate === 'function') {
          onSessionUpdate();
        }
      } catch (err) {
        toast.push({
          title: 'Removal Failed',
          body: err.message || 'Could not remove profile photo.',
          tone: 'error',
        });
      } finally {
        setRemovingPhoto(false);
      }
    };

    // Save Personal Information
    const handleSavePersonalInfo = async (e) => {
      e?.preventDefault();
      const errors = {};

      if (!name.trim()) {
        errors.name = 'Display name cannot be empty.';
      } else if (name.trim().length > 100) {
        errors.name = 'Display name cannot exceed 100 characters.';
      }

      if (username) {
        const u = username.trim().toLowerCase();
        if (u.length < 3 || u.length > 30) {
          errors.username = 'Username must be between 3 and 30 characters.';
        } else if (!/^[a-z0-9]/.test(u)) {
          errors.username = 'Username must start with a letter or number.';
        } else if (!/[a-z0-9]$/.test(u)) {
          errors.username = 'Username cannot end with a symbol.';
        } else if (!/^[a-z0-9._-]+$/.test(u)) {
          errors.username = 'Username can only contain letters, numbers, dots, hyphens, and underscores.';
        }
      }

      if (bio && bio.length > 500) {
        errors.bio = 'Bio cannot exceed 500 characters.';
      }

      if (location && location.length > 100) {
        errors.location = 'Location cannot exceed 100 characters.';
      }

      setFieldErrors(errors);
      if (Object.keys(errors).length > 0) return;

      setSavingProfile(true);
      try {
        await window.OV.services.auth.updateProfile({
          name: name.trim(),
          username: username.trim().toLowerCase() || null,
          bio: bio.trim() || null,
          location: location.trim() || null,
        });

        toast.push({
          title: 'Profile Saved',
          body: 'Your personal information has been updated.',
          tone: 'success',
        });

        if (typeof onSessionUpdate === 'function') {
          onSessionUpdate();
        }
      } catch (err) {
        if (err.message && err.message.includes('already claimed')) {
          setFieldErrors({ username: 'This username is already taken. Please choose another.' });
        }
        toast.push({
          title: 'Save Failed',
          body: err.message || 'Could not save profile changes.',
          tone: 'error',
        });
      } finally {
        setSavingProfile(false);
      }
    };

    // Handle Password Change
    const handleChangePassword = async (e) => {
      e?.preventDefault();
      setPasswordError(null);

      if (!currentPassword) {
        setPasswordError('Please enter your current password.');
        return;
      }
      if (!newPassword || newPassword.length < 6) {
        setPasswordError('New password must be at least 6 characters long.');
        return;
      }
      if (newPassword !== confirmPassword) {
        setPasswordError('New password and confirmation do not match.');
        return;
      }
      if (currentPassword === newPassword) {
        setPasswordError('New password cannot be the same as your current password.');
        return;
      }

      setSavingPassword(true);
      try {
        await window.OV.services.auth.changePassword({
          currentPassword,
          newPassword,
          confirmPassword,
        });

        toast.push({
          title: 'Password Updated',
          body: 'Your account password has been changed successfully.',
          tone: 'success',
        });

        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        setShowPasswordModal(false);
      } catch (err) {
        setPasswordError(err.message || 'Failed to update password.');
      } finally {
        setSavingPassword(false);
      }
    };

    // Format account creation date
    const formattedCreationDate = useMemo(() => {
      if (!user.createdAt) return 'Recently';
      try {
        return new Date(user.createdAt).toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric',
        });
      } catch {
        return 'Recently';
      }
    }, [user.createdAt]);

    return (
      <div className="profile-page-container" style={{ display: 'grid', gap: 32, paddingBottom: 60 }}>
        {/* Hidden File Input */}
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleFileSelect}
          accept="image/jpeg,image/png,image/webp"
          style={{ display: 'none' }}
          aria-hidden="true"
        />

        {/* Page Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
              <h1 className="h-display" style={{ fontSize: 28, margin: 0 }}>
                My Profile
              </h1>
              <span className="badge" style={{ background: 'color-mix(in oklab, var(--accent) 15%, transparent)', color: 'var(--accent)', fontSize: 11.5, height: 22, padding: '0 8px' }}>
                Account Settings
              </span>
            </div>
            <p className="muted" style={{ margin: 0, fontSize: 14.5 }}>
              Manage your personal identity, account photo, and security settings.
            </p>
          </div>
        </div>

        {/* Section A: Profile Photo Card */}
        <GlassCard style={{ padding: '28px 32px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
            <div>
              <h2 className="h-card" style={{ fontSize: 18, margin: '0 0 4px 0' }}>Profile Photo</h2>
              <p className="faint" style={{ margin: 0, fontSize: 13 }}>
                This photo appears on your account dropdown and throughout your workspace.
              </p>
            </div>
            <span className="mono faint" style={{ fontSize: 11.5 }}>
              JPG, PNG, WebP · Up to 2 MB
            </span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 28, flexWrap: 'wrap' }}>
            {/* Avatar Preview */}
            <div style={{ position: 'relative' }}>
              <Avatar
                initials={initials}
                src={photoUrl}
                size={96}
                ring
                style={{ fontSize: 32, fontWeight: 600, boxShadow: '0 8px 24px -6px var(--shade)' }}
              />
              {uploadingPhoto && (
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    borderRadius: '50%',
                    background: 'rgba(0,0,0,0.5)',
                    display: 'grid',
                    placeItems: 'center',
                  }}
                >
                  <div className="spin" style={{ width: 24, height: 24, borderColor: '#fff' }} />
                </div>
              )}
            </div>

            {/* Photo Action Buttons */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => fileInputRef.current && fileInputRef.current.click()}
                  disabled={uploadingPhoto || removingPhoto}
                >
                  {photoUrl ? 'Replace Photo' : 'Upload Photo'}
                </Button>

                {photoUrl && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowRemoveConfirm(true)}
                    disabled={uploadingPhoto || removingPhoto}
                    style={{ color: '#ef4444' }}
                  >
                    Remove Photo
                  </Button>
                )}
              </div>
              <span className="faint" style={{ fontSize: 12 }}>
                Square ratio recommended. We’ll help you crop and adjust before saving.
              </span>
            </div>
          </div>
        </GlassCard>

        {/* Section B: Personal Information Form */}
        <GlassCard style={{ padding: '28px 32px' }}>
          <form onSubmit={handleSavePersonalInfo}>
            <div style={{ marginBottom: 24 }}>
              <h2 className="h-card" style={{ fontSize: 18, margin: '0 0 4px 0' }}>Personal Information</h2>
              <p className="faint" style={{ margin: 0, fontSize: 13 }}>
                Update your public name, unique handle, and brief biographical summary.
              </p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20, marginBottom: 20 }}>
              {/* Display Name */}
              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>
                  Display Name <span style={{ color: 'var(--accent)' }}>*</span>
                </label>
                <input
                  type="text"
                  className="input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Maya Lin"
                  maxLength={100}
                  required
                  style={{ width: '100%', height: 40 }}
                />
                {fieldErrors.name && (
                  <span style={{ display: 'block', color: '#ef4444', fontSize: 12, marginTop: 4 }}>
                    {fieldErrors.name}
                  </span>
                )}
              </div>

              {/* Username */}
              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>
                  Username / URL Handle
                </label>
                <div style={{ position: 'relative' }}>
                  <span
                    style={{
                      position: 'absolute',
                      left: 12,
                      top: '50%',
                      transform: 'translateY(-50%)',
                      color: 'var(--text-3)',
                      fontSize: 13,
                      pointerEvents: 'none',
                    }}
                  >
                    @
                  </span>
                  <input
                    type="text"
                    className="input"
                    value={username}
                    onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9._-]/g, ''))}
                    placeholder="yourhandle"
                    maxLength={30}
                    style={{ width: '100%', height: 40, paddingLeft: 28 }}
                  />
                </div>
                {fieldErrors.username ? (
                  <span style={{ display: 'block', color: '#ef4444', fontSize: 12, marginTop: 4 }}>
                    {fieldErrors.username}
                  </span>
                ) : (
                  <span className="faint" style={{ display: 'block', fontSize: 11.5, marginTop: 4 }}>
                    Public portfolio address: onevue.id/{username || 'username'}
                  </span>
                )}
              </div>

              {/* Location */}
              <div>
                <label style={{ display: 'block', fontSize: 13, fontWeight: 500, marginBottom: 6 }}>
                  Location
                </label>
                <input
                  type="text"
                  className="input"
                  value={location}
                  onChange={(e) => setLocation(e.target.value)}
                  placeholder="e.g. San Francisco, CA"
                  maxLength={100}
                  style={{ width: '100%', height: 40 }}
                />
                {fieldErrors.location && (
                  <span style={{ display: 'block', color: '#ef4444', fontSize: 12, marginTop: 4 }}>
                    {fieldErrors.location}
                  </span>
                )}
              </div>
            </div>

            {/* Bio */}
            <div style={{ marginBottom: 24 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                <label style={{ fontSize: 13, fontWeight: 500 }}>
                  Bio & Introduction
                </label>
                <span className="mono faint" style={{ fontSize: 11.5 }}>
                  {bio.length} / 500
                </span>
              </div>
              <textarea
                className="input"
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="Share a short bio summarizing your academic pursuits, focus areas, or goals..."
                rows={3}
                maxLength={500}
                style={{ width: '100%', padding: '10px 14px', resize: 'vertical' }}
              />
              {fieldErrors.bio && (
                <span style={{ display: 'block', color: '#ef4444', fontSize: 12, marginTop: 4 }}>
                  {fieldErrors.bio}
                </span>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button type="submit" variant="primary" loading={savingProfile}>
                Save Changes
              </Button>
            </div>
          </form>
        </GlassCard>

        {/* Section C: Account Metadata & Security Card */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 24 }}>
          {/* Account Details */}
          <GlassCard style={{ padding: '24px 28px' }}>
            <h2 className="h-card" style={{ fontSize: 17, marginBottom: 16 }}>Account Information</h2>
            
            <div style={{ display: 'grid', gap: 14 }}>
              <div>
                <span className="faint" style={{ display: 'block', fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '.05em' }}>Email Address</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 4 }}>
                  <span style={{ fontSize: 14, fontWeight: 500 }}>{user.email}</span>
                  <Verified>Verified</Verified>
                </div>
              </div>

              <div>
                <span className="faint" style={{ display: 'block', fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '.05em' }}>Current Identity</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                  <span className="badge" style={{ fontSize: 12, padding: '2px 8px' }}>
                    {user.identity ? user.identity.charAt(0).toUpperCase() + user.identity.slice(1) : 'Student'}
                  </span>
                </div>
              </div>

              <div>
                <span className="faint" style={{ display: 'block', fontSize: 11.5, textTransform: 'uppercase', letterSpacing: '.05em' }}>Member Since</span>
                <span style={{ display: 'block', fontSize: 13.5, color: 'var(--text-1)', marginTop: 4 }}>
                  {formattedCreationDate}
                </span>
              </div>
            </div>
          </GlassCard>

          {/* Security & Password Action */}
          <GlassCard style={{ padding: '24px 28px', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
            <div>
              <h2 className="h-card" style={{ fontSize: 17, marginBottom: 8 }}>Security & Authentication</h2>
              <p className="faint" style={{ fontSize: 13, lineHeight: 1.5, margin: '0 0 16px 0' }}>
                Protect your OneVue account with a strong password. Active session is authenticated and protected.
              </p>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 20 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#10b981' }} />
                <span style={{ fontSize: 12.5, color: 'var(--text-2)' }}>Active session authenticated</span>
              </div>
            </div>

            <div>
              <Button
                variant="glass"
                size="sm"
                onClick={() => {
                  setPasswordError(null);
                  setCurrentPassword('');
                  setNewPassword('');
                  setConfirmPassword('');
                  setShowPasswordModal(true);
                }}
              >
                Change Password
              </Button>
            </div>
          </GlassCard>
        </div>

        {/* ---------------- Crop & Zoom Modal ---------------- */}
        {pendingImageSrc && (
          <div className="scrim" style={{ zIndex: 9999, display: 'grid', placeItems: 'center', padding: 20 }}>
            <GlassCard
              style={{
                width: '100%',
                maxWidth: 460,
                padding: '24px',
                borderRadius: 20,
                boxShadow: '0 24px 48px -12px var(--shade)',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="h-card" style={{ fontSize: 18, margin: '0 0 6px 0' }}>Adjust Profile Photo</h3>
              <p className="faint" style={{ fontSize: 13, margin: '0 0 18px 0' }}>
                Drag image to reposition, or use the zoom slider to crop your portrait.
              </p>

              {/* Square Crop Viewport */}
              <div
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseUp={handleMouseUp}
                onMouseLeave={handleMouseUp}
                style={{
                  width: 260,
                  height: 260,
                  margin: '0 auto 18px',
                  borderRadius: '50%',
                  overflow: 'hidden',
                  position: 'relative',
                  border: '2px dashed var(--accent)',
                  cursor: isDragging ? 'grabbing' : 'grab',
                  background: 'color-mix(in oklab, var(--bg-0) 80%, black)',
                  boxShadow: '0 0 0 9999px rgba(0,0,0,0.45)',
                  userSelect: 'none',
                }}
              >
                <img
                  src={pendingImageSrc}
                  alt="Crop preview"
                  draggable={false}
                  style={{
                    position: 'absolute',
                    left: '50%',
                    top: '50%',
                    transform: `translate(calc(-50% + ${cropOffset.x}px), calc(-50% + ${cropOffset.y}px)) scale(${cropZoom})`,
                    transformOrigin: 'center center',
                    maxWidth: 'none',
                    maxHeight: 'none',
                    minWidth: '100%',
                    minHeight: '100%',
                    objectFit: 'cover',
                    pointerEvents: 'none',
                  }}
                />
              </div>

              {/* Zoom Slider */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, padding: '0 12px' }}>
                <span className="faint" style={{ fontSize: 12 }}>Zoom</span>
                <input
                  type="range"
                  min="1"
                  max="3"
                  step="0.05"
                  value={cropZoom}
                  onChange={(e) => setCropZoom(parseFloat(e.target.value))}
                  style={{ flex: 1, accentColor: 'var(--accent)' }}
                />
                <span className="mono faint" style={{ fontSize: 12, width: 36, textAlign: 'right' }}>
                  {cropZoom.toFixed(1)}x
                </span>
              </div>

              {/* Action Buttons */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setPendingImageSrc(null);
                    setPendingFile(null);
                  }}
                  disabled={uploadingPhoto}
                >
                  Cancel
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleConfirmCropAndUpload}
                  loading={uploadingPhoto}
                >
                  Save Photo
                </Button>
              </div>
            </GlassCard>
          </div>
        )}

        {/* ---------------- Remove Confirmation Modal ---------------- */}
        {showRemoveConfirm && (
          <div className="scrim" style={{ zIndex: 9999, display: 'grid', placeItems: 'center', padding: 20 }}>
            <GlassCard
              style={{
                width: '100%',
                maxWidth: 400,
                padding: '24px',
                borderRadius: 20,
                boxShadow: '0 24px 48px -12px var(--shade)',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="h-card" style={{ fontSize: 18, margin: '0 0 8px 0', color: '#ef4444' }}>
                Remove Profile Photo?
              </h3>
              <p className="muted" style={{ fontSize: 13.5, margin: '0 0 20px 0', lineHeight: 1.5 }}>
                Your avatar will revert to your initials. You can upload a new photo at any time.
              </p>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowRemoveConfirm(false)}
                  disabled={removingPhoto}
                >
                  Keep Photo
                </Button>
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleRemovePhoto}
                  loading={removingPhoto}
                  style={{ background: '#ef4444', borderColor: '#ef4444', color: '#fff' }}
                >
                  Yes, Remove
                </Button>
              </div>
            </GlassCard>
          </div>
        )}

        {/* ---------------- Change Password Modal ---------------- */}
        {showPasswordModal && (
          <div className="scrim" style={{ zIndex: 9999, display: 'grid', placeItems: 'center', padding: 20 }}>
            <GlassCard
              style={{
                width: '100%',
                maxWidth: 420,
                padding: '28px',
                borderRadius: 20,
                boxShadow: '0 24px 48px -12px var(--shade)',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <h3 className="h-card" style={{ fontSize: 18, margin: 0 }}>Change Password</h3>
                <button
                  className="icon-btn"
                  onClick={() => setShowPasswordModal(false)}
                  style={{ width: 30, height: 30 }}
                  aria-label="Close modal"
                >
                  <Icon.x />
                </button>
              </div>

              <form onSubmit={handleChangePassword} style={{ display: 'grid', gap: 14 }}>
                {passwordError && (
                  <div
                    style={{
                      padding: '8px 12px',
                      borderRadius: 8,
                      background: 'rgba(239, 68, 68, 0.1)',
                      border: '1px solid rgba(239, 68, 68, 0.25)',
                      color: '#ef4444',
                      fontSize: 12.5,
                    }}
                  >
                    {passwordError}
                  </div>
                )}

                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 500, marginBottom: 4 }}>
                    Current Password
                  </label>
                  <input
                    type="password"
                    className="input"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    required
                    style={{ width: '100%', height: 38 }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 500, marginBottom: 4 }}>
                    New Password (min. 6 characters)
                  </label>
                  <input
                    type="password"
                    className="input"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                    minLength={6}
                    style={{ width: '100%', height: 38 }}
                  />
                </div>

                <div>
                  <label style={{ display: 'block', fontSize: 12.5, fontWeight: 500, marginBottom: 4 }}>
                    Confirm New Password
                  </label>
                  <input
                    type="password"
                    className="input"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    minLength={6}
                    style={{ width: '100%', height: 38 }}
                  />
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: 8 }}>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowPasswordModal(false)}
                    disabled={savingPassword}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    variant="primary"
                    size="sm"
                    loading={savingPassword}
                  >
                    Update Password
                  </Button>
                </div>
              </form>
            </GlassCard>
          </div>
        )}
      </div>
    );
  }

  window.StudentProfilePage = StudentProfilePage;
})();
