/* Hooks and Router bindings */
const { useState: sUseState, useEffect: sUseEffect, useMemo: sUseMemo, useRef: sUseRef, useCallback: sUseCallback } = React;
const { useLocation: sUseLocation, useNavigate: sUseNavigate, Link: sLink } = ReactRouterDOM;
const StudentIcons = window.StudentIcons || {};

function studentApiBase() {
  return (window.OV_ENV && window.OV_ENV.API_BASE) || 'http://localhost:3000/api';
}

function studentAuthToken(session) {
  return (session && session.token) || (window.OV && window.OV.core && window.OV.core.db && window.OV.core.db.get('session') && window.OV.core.db.get('session').token) || '';
}

function canonicalCredlyBadgeUrl(value) {
  const match = String(value || '').trim().match(/^https:\/\/www\.credly\.com\/badges\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/?$/i);
  if (!match) return '';
  return 'https://www.credly.com/badges/' + match[1].toLowerCase();
}

function credentialStatusLabel(status) {
  if (status === 'verified') return 'Verified';
  if (status === 'pending') return 'Pending verification';
  if (status === 'rejected') return 'Not verified';
  return 'Self-reported';
}

const RESUME_FIELD_LABELS = {
  headline: 'Headline',
  email: 'Email',
  phone: 'Phone',
  summary: 'Summary',
  name: 'Name',
  institution: 'Institution',
  degree: 'Degree',
  fieldOfStudy: 'Field of study',
  startDate: 'Start',
  endDate: 'End',
  grade: 'Grade',
  company: 'Company',
  title: 'Title',
  location: 'Location',
  isCurrent: 'Current',
  responsibilities: 'Responsibilities',
  description: 'Description',
  technologies: 'Technologies',
  links: 'Link',
  platform: 'Platform',
  url: 'URL',
};

const RESUME_SKILL_CATEGORIES = [
  'Programming Languages',
  'Frontend',
  'Backend',
  'Databases',
  'AI / ML',
  'Cloud / DevOps',
  'Tools',
  'Other Skills',
];

const RESUME_SKILL_LEVELS = ['Familiar', 'Beginner', 'Intermediate', 'Advanced', 'Expert'];

function resumeRowsByEntry(rows) {
  const groups = [];
  const index = new Map();
  (rows || []).forEach((row) => {
    const key = String(row.entryIndex);
    if (!index.has(key)) {
      const group = { entryIndex: row.entryIndex, rows: [] };
      index.set(key, group);
      groups.push(group);
    }
    index.get(key).rows.push(row);
  });
  return groups;
}

function resumeRowSelectable(row, entryRows) {
  if (!row || row.section === 'experience') return false;
  if (row.section === 'skills') return row.field === 'name' && Boolean(row.value);
  if (!row.applicable) return false;
  const fields = new Set((entryRows || []).filter((item) => item.applicable).map((item) => item.field));
  if (row.section === 'education') return fields.has('institution') && fields.has('degree');
  if (row.section === 'projects') return fields.has('name');
  if (row.section === 'socialLinks') return fields.has('platform') && fields.has('url');
  return true;
}

function resumeText(value) {
  return String(value == null ? '' : value).trim();
}

function resumeSame(left, right) {
  return resumeText(left).toLowerCase() === resumeText(right).toLowerCase();
}

function resumeEntryValue(entryRows, field) {
  const match = (entryRows || []).find((item) => item.field === field);
  return match ? resumeText(match.value) : '';
}

function studentOnboardingKey(session, name) {
  const user = session && session.user;
  const id = (user && (user.id || user._id || user.email)) || 'anonymous';
  return 'ov_student_onboarding_' + name + ':' + id;
}

function studentProfileHasContent(profile) {
  if (!profile) return false;
  if (resumeText(profile.headline) || resumeText(profile.bio)) return true;
  return ['education', 'projects', 'skills', 'credentials', 'achievements', 'links'].some(
    (key) => Array.isArray(profile[key]) && profile[key].length > 0
  );
}

function resumeRowCurrentValue(profile, row, entryRows) {
  if (!profile || !row) return '';
  if (row.section === 'profile') {
    if (row.field === 'summary') return resumeText(profile.bio);
    if (row.field === 'headline') return resumeText(profile.headline);
    if (row.field === 'email') return resumeText(profile.contacts && profile.contacts.email);
    if (row.field === 'phone') return resumeText(profile.contacts && profile.contacts.phone);
    return '';
  }
  if (row.section === 'socialLinks') {
    const platform = resumeEntryValue(entryRows, 'platform');
    const link = (profile.links || []).find((item) => resumeSame(item.platform, platform));
    if (!link) return '';
    return row.field === 'url' ? resumeText(link.url) : resumeText(link.platform);
  }
  if (row.section === 'education') {
    const match = (profile.education || []).find((item) => (
      resumeSame(item.institution, resumeEntryValue(entryRows, 'institution'))
      && resumeSame(item.degree, resumeEntryValue(entryRows, 'degree'))
    ));
    if (!match) return '';
    if (row.field === 'grade') return resumeText(match.gpa || match.percentage);
    return resumeText(match[row.field]);
  }
  if (row.section === 'projects') {
    const match = (profile.projects || []).find((item) => resumeSame(item.title, resumeEntryValue(entryRows, 'name')));
    if (!match) return '';
    if (row.field === 'name') return resumeText(match.title);
    if (row.field === 'description') return resumeText(match.shortDescription);
    if (row.field === 'technologies') return Array.isArray(match.technologies) ? match.technologies.join(', ') : '';
    if (row.field === 'links') return resumeText(match.repoUrl || match.liveUrl);
    return '';
  }
  if (row.section === 'skills') {
    const match = (profile.skills || []).find((item) => resumeSame(item.name, row.value));
    return match ? resumeText(match.name) : '';
  }
  if (row.section === 'credentials' || row.section === 'achievements') {
    const list = profile[row.section] || [];
    const title = resumeEntryValue(entryRows, 'title') || (row.field === 'title' ? resumeText(row.value) : '');
    const match = list.find((item) => resumeSame(item.title, title));
    if (!match) return '';
    return row.field === 'title' ? resumeText(match.title) : resumeText(match.description);
  }
  return '';
}

function resumeChangeKind(current, extracted) {
  const next = resumeText(extracted);
  const previous = resumeText(current);
  if (!next && previous) return 'missing';
  if (!previous && next) return 'new';
  if (resumeSame(previous, next)) return 'unchanged';
  return 'modified';
}

const RESUME_CHANGE_LABELS = {
  new: 'New',
  modified: 'Changed',
  unchanged: 'Unchanged',
  missing: 'Not in this resume',
};

function ResumeExtractionReview({
  review,
  profile,
  selection,
  onToggle,
  onSelectApplicable,
  skillExtras,
  onSkillExtra,
  issuerExtras,
  onIssuer,
  applying,
  onApply,
  onDiscard,
}) {
  const sections = (review && review.sections) || [];
  const existingProfile = studentProfileHasContent(profile);
  const selectedCount = Object.keys(selection || {}).filter((id) => selection[id]).length;
  return (
    <div className="glass" style={{ padding: 22, borderRadius: 18, display: 'grid', gap: 16, border: '1px solid var(--line)' }}>
      <div>
        <h3 style={{ fontSize: 18, margin: 0 }}>{existingProfile ? 'Review Profile Changes' : 'Review your profile'}</h3>
        <p className="muted" style={{ fontSize: 13.5, margin: '6px 0 0' }}>
          {existingProfile
            ? 'Only checked changes are written. A field missing from this resume keeps its saved value.'
            : 'Check the extracted fields, edit anything that looks wrong in the profile sections, then save to continue.'}
        </p>
      </div>
      {Array.isArray(review.warnings) && review.warnings.length > 0 && (
        <div style={{ display: 'grid', gap: 4 }}>
          {review.warnings.slice(0, 4).map((warning, index) => (
            <p key={warning.path || index} className="faint" style={{ fontSize: 12.5, margin: 0 }}>
              {warning.message}
            </p>
          ))}
        </div>
      )}
      {sections.length === 0 ? (
        <p className="muted" style={{ margin: 0 }}>No fields were found in this PDF.</p>
      ) : sections.map((section) => (
        <div key={section.id} style={{ display: 'grid', gap: 10 }}>
          <h4 style={{ fontSize: 15, margin: 0 }}>{section.label}</h4>
          {resumeRowsByEntry(section.rows).map((entry) => {
            const skillSelected = section.id === 'skills' && entry.rows.some((row) => selection[row.id]);
            const credentialSelected = section.id === 'credentials' && entry.rows.some((row) => selection[row.id]);
            const skillExtra = skillExtras[entry.entryIndex] || { category: 'Other Skills', proficiency: 'Intermediate' };
            return (
              <div key={section.id + '-' + entry.entryIndex} style={{ display: 'grid', gap: 8, padding: '4px 0 8px' }}>
                {entry.rows.map((row) => {
                  const selectable = resumeRowSelectable(row, entry.rows);
                  const current = resumeRowCurrentValue(profile, row, entry.rows);
                  const kind = resumeChangeKind(current, row.value);
                  return (
                    <label key={row.id} style={{ display: 'grid', gridTemplateColumns: '22px 1fr', gap: 10, alignItems: 'start', cursor: selectable ? 'pointer' : 'default' }}>
                      <input
                        type="checkbox"
                        checked={Boolean(selection[row.id])}
                        disabled={!selectable || kind === 'unchanged'}
                        onChange={(event) => onToggle(row, entry.rows, event.target.checked)}
                        style={{ marginTop: 3 }}
                      />
                      <span>
                        <span style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                          <strong style={{ fontSize: 13.5 }}>{RESUME_FIELD_LABELS[row.field] || row.field}</strong>
                          <span className="badge" style={{ fontSize: 10 }}>{RESUME_CHANGE_LABELS[kind]}</span>
                          {row.confidence && <span className="badge" style={{ fontSize: 10 }}>{row.confidence}</span>}
                          {!selectable && <span className="badge" style={{ fontSize: 10 }}>Shown only</span>}
                        </span>
                        {kind === 'modified' && (
                          <span className="faint" style={{ display: 'block', fontSize: 12.5, marginTop: 2, whiteSpace: 'pre-wrap' }}>Saved: {current}</span>
                        )}
                        <span style={{ display: 'block', fontSize: 13.5, marginTop: 2, whiteSpace: 'pre-wrap' }}>{kind === 'modified' ? 'From resume: ' + row.value : row.value}</span>
                        {row.note && <span className="faint" style={{ display: 'block', fontSize: 12, marginTop: 2 }}>{row.note}</span>}
                      </span>
                    </label>
                  );
                })}
                {skillSelected && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginLeft: 32 }}>
                    <Select
                      label="Category"
                      value={skillExtra.category}
                      onChange={(event) => onSkillExtra(entry.entryIndex, { ...skillExtra, category: event.target.value })}
                      options={RESUME_SKILL_CATEGORIES.map((category) => ({ value: category, label: category }))}
                    />
                    <Select
                      label="Proficiency"
                      value={skillExtra.proficiency}
                      onChange={(event) => onSkillExtra(entry.entryIndex, { ...skillExtra, proficiency: event.target.value })}
                      options={RESUME_SKILL_LEVELS.map((level) => ({ value: level, label: level }))}
                    />
                  </div>
                )}
                {credentialSelected && (
                  <div style={{ marginLeft: 32 }}>
                    <Input
                      label="Issuer *"
                      value={issuerExtras[entry.entryIndex] || ''}
                      onChange={(event) => onIssuer(entry.entryIndex, event.target.value)}
                      placeholder="Who issued this certificate?"
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        <Button variant="glass" disabled={applying} onClick={() => onSelectApplicable(true)}>Select applicable changes</Button>
        <Button variant="ghost" disabled={applying} onClick={() => onSelectApplicable(false)}>Clear</Button>
        <Button variant="primary" loading={applying} disabled={applying || selectedCount === 0} onClick={onApply}>
          {existingProfile ? 'Apply Selected Changes' : 'Save & Continue'}
        </Button>
        <Button variant="ghost" disabled={applying} onClick={onDiscard}>
          {existingProfile ? 'Cancel' : 'Discard extraction'}
        </Button>
      </div>
    </div>
  );
}

/* =========================================================================
   PAGE 2: Complete Student Identity Page (All 9 Modules)
   ========================================================================= */
function StudentIdentityPage({ session, studentProfile, onSaveToDb, onProfileReplaced, loadingProfile }) {
  const toast = useToast();
  const [activeSection, setActiveSection] = sUseState(() => {
    try {
      const savedTab = localStorage.getItem('ov_student_identity_tab');
      const validTabs = ['profile', 'education', 'projects', 'skills', 'credentials', 'achievements', 'resume', 'media', 'contacts'];
      return (savedTab && validTabs.includes(savedTab)) ? savedTab : 'profile';
    } catch {
      return 'profile';
    }
  });

  const handleSelectSection = (secId) => {
    setActiveSection(secId);
    try {
      localStorage.setItem('ov_student_identity_tab', secId);
    } catch (_) {}
  };

  const [isSubmitting, setIsSubmitting] = sUseState(false);

  // Module 1: Personal Profile
  const [preferredName, setPreferredName] = sUseState('');
  const [profilePhoto, setProfilePhoto] = sUseState('');
  const [headline, setHeadline] = sUseState('');
  const [bio, setBio] = sUseState('');
  const [nationality, setNationality] = sUseState('');
  const [country, setCountry] = sUseState('');
  const [stateRegion, setStateRegion] = sUseState('');
  const [city, setCity] = sUseState('');
  const [currentStatus, setCurrentStatus] = sUseState('student');
  const [careerInterests, setCareerInterests] = sUseState([]);
  const [areasOfInterest, setAreasOfInterest] = sUseState([]);
  const [languages, setLanguages] = sUseState([]);
  const [newCareerInput, setNewCareerInput] = sUseState('');
  const [newLang, setNewLang] = sUseState({ language: '', proficiency: 'conversational' });

  // Collections (Modules 2-9)
  const [educationList, setEducationList] = sUseState([]);
  const [customLayout, setCustomLayout] = sUseState({ schemaVersion: 1, revision: 0, sections: [], bindings: [], entries: [] });
  const [projectsList, setProjectsList] = sUseState([]);
  const [skillsList, setSkillsList] = sUseState([]);
  const [credentialsList, setCredentialsList] = sUseState([]);
  const [achievementsList, setAchievementsList] = sUseState([]);
  const [mediaList, setMediaList] = sUseState([]);
  const [linksList, setLinksList] = sUseState([]);
  const [contactsState, setContactsState] = sUseState({
    email: '',
    phone: '',
    countryCode: '',
    city: '',
    state: '',
    country: '',
    visibility: { email: 'private', phone: 'private' },
    github: '',
    linkedin: '',
    twitter: '',
    portfolio: '',
  });

  // Modals state
  const [eduModalOpen, setEduModalOpen] = sUseState(false);
  const [editingEduIdx, setEditingEduIdx] = sUseState(null);
  const [eduForm, setEduForm] = sUseState({
    institution: '',
    institutionType: 'university',
    degree: '',
    fieldOfStudy: '',
    specialization: '',
    department: '',
    startDate: '',
    endDate: '',
    expectedGradDate: '',
    currentStatus: 'studying',
    gpa: '',
    gpaScale: '4.0',
    percentage: '',
    gradeClass: '',
    rank: '',
    location: '',
    website: '',
    rollNumber: '',
    accreditation: '',
    coursework: '',
    honors: '',
  });

  const [projModalOpen, setProjModalOpen] = sUseState(false);
  const [editingProjIdx, setEditingProjIdx] = sUseState(null);
  const [projForm, setProjForm] = sUseState({
    title: '',
    projectType: 'academic',
    role: '',
    status: 'completed',
    isTeam: false,
    teamSize: 1,
    startDate: '',
    endDate: '',
    techStack: '',
    shortDescription: '',
    detailedDescription: '',
    problemSolved: '',
    keyFeatures: '',
    challengesSolutions: '',
    metricsResults: '',
    impact: '',
    repoUrl: '',
    liveUrl: '',
    docsUrl: '',
    videoUrl: '',
    isAiMl: false,
    dataset: '',
    algorithms: '',
    modelName: '',
    metrics: '',
  });

  const [skillModalOpen, setSkillModalOpen] = sUseState(false);
  const [editingSkillIdx, setEditingSkillIdx] = sUseState(null);
  const [skillForm, setSkillForm] = sUseState({
    name: '',
    category: 'Programming Languages',
    proficiency: 'Intermediate',
    yearsExperience: 0,
    lastUsed: '',
    evidence: '',
  });

  const [credModalOpen, setCredModalOpen] = sUseState(false);
  const [editingCredIdx, setEditingCredIdx] = sUseState(null);
  const [credForm, setCredForm] = sUseState({
    title: '',
    credentialType: 'course_certificate',
    issuer: '',
    credentialId: '',
    issueDate: '',
    expirationDate: '',
    neverExpires: false,
    credentialUrl: '',
    verificationUrl: '',
    description: '',
    relatedSkills: '',
  });

  const [achModalOpen, setAchModalOpen] = sUseState(false);
  const [editingAchIdx, setEditingAchIdx] = sUseState(null);
  const [achForm, setAchForm] = sUseState({
    title: '',
    category: 'hackathon',
    organization: '',
    date: '',
    positionRank: '',
    awardPrize: '',
    teamSize: 1,
    role: '',
    location: '',
    description: '',
    proofUrl: '',
  });

  const [mediaModalOpen, setMediaModalOpen] = sUseState(false);
  const [editingMediaIdx, setEditingMediaIdx] = sUseState(null);
  const [mediaForm, setMediaForm] = sUseState({
    title: '',
    mediaUrl: '',
    assetId: '',
    mediaType: 'image',
    category: 'project',
    description: '',
    altText: '',
    isFeatured: false,
  });

  const [linkModalOpen, setLinkModalOpen] = sUseState(false);
  const [editingLinkIdx, setEditingLinkIdx] = sUseState(null);
  const [linkForm, setLinkForm] = sUseState({
    platform: 'GitHub',
    url: '',
    category: 'coding',
    username: '',
    isPrimary: false,
    visibility: 'public',
  });

  // Resume state (Module 7: Single slot)
  const [resumeData, setResumeData] = sUseState(null);
  const [resumeUploading, setResumeUploading] = sUseState(false);
  const [resumeApplying, setResumeApplying] = sUseState(false);
  const [resumeRoleInput, setResumeRoleInput] = sUseState('');
  const [resumeReview, setResumeReview] = sUseState(null);
  const [resumeSelection, setResumeSelection] = sUseState({});
  const [resumeSkillExtras, setResumeSkillExtras] = sUseState({});
  const [resumeIssuers, setResumeIssuers] = sUseState({});
  const [resumeCandidate, setResumeCandidate] = sUseState(null);
  const [onboardingStep, setOnboardingStep] = sUseState(null);
  const [onboardingReady, setOnboardingReady] = sUseState(false);
  const onboardingApi = (window.OV && window.OV.studentOnboarding) || null;
  const [verifyingCredId, setVerifyingCredId] = sUseState('');
  const resumeFileRef = sUseRef(null);

  const studentHydrated = sUseRef(false);
  const studentWriteReady = sUseRef(false);
  const studentDraftBase = sUseRef("");
  const [studentDraftNotice, setStudentDraftNotice] = sUseState("");

  function applyStudentEditorSource(source) {
    if (!source) return;
    setPreferredName(source.preferredName || '');
    setProfilePhoto(source.profilePhoto || '');
    setHeadline(source.headline || '');
    setBio(source.bio || '');
    setNationality(source.nationality || '');
    setCountry(source.country || '');
    setStateRegion(source.state || '');
    setCity(source.city || '');
    setCurrentStatus(source.currentStatus || 'student');
    setCareerInterests(Array.isArray(source.careerInterests) ? source.careerInterests : []);
    setAreasOfInterest(Array.isArray(source.areasOfInterest) ? source.areasOfInterest : []);
    setLanguages(Array.isArray(source.languages) ? source.languages : []);
    if (Array.isArray(source.education)) setEducationList(source.education);
    setCustomLayout(source.customLayout && Array.isArray(source.customLayout.sections) ? source.customLayout : { schemaVersion: 1, revision: 0, sections: [], bindings: [], entries: [] });
    if (Array.isArray(source.projects)) setProjectsList(source.projects);
    if (Array.isArray(source.skills)) setSkillsList(source.skills);
    if (Array.isArray(source.credentials)) setCredentialsList(source.credentials);
    if (Array.isArray(source.achievements)) setAchievementsList(source.achievements);
    if (Array.isArray(source.media)) setMediaList(source.media);
    if (Array.isArray(source.links)) setLinksList(source.links);
    if (source.resume) {
      setResumeData(source.resume);
      setResumeRoleInput(source.resume.targetRole || '');
    } else if (source.resumeFileName) {
      setResumeData({
        fileName: source.resumeFileName,
        fileSize: 180000,
        uploadedAt: source.resumeLastUpdated,
        contentType: 'application/pdf',
      });
    }
    if (source.contacts) {
      setContactsState({
        email: source.contacts.email || '',
        phone: source.contacts.phone || '',
        countryCode: source.contacts.countryCode || '',
        city: source.contacts.city || '',
        state: source.contacts.state || '',
        country: source.contacts.country || '',
        visibility: source.contacts.visibility || { email: 'private', phone: 'private' },
        github: source.contacts.github || '',
        linkedin: source.contacts.linkedin || '',
        twitter: source.contacts.twitter || '',
        portfolio: source.contacts.portfolio || '',
      });
    }
  }

  sUseEffect(() => {
    if (!studentProfile) return;
    const stamp = String(studentProfile.updatedAt || studentProfile._id || "loaded");
    if (studentHydrated.current === stamp) return;
    const firstLoad = !studentHydrated.current;
    studentHydrated.current = stamp;
    const drafts = window.OV && window.OV.editorDraft;
    if (firstLoad && drafts) {
      const record = drafts.readDraft(sessionStorage, "student-profile", session);
      const decision = drafts.decideDraftRestore(record, studentProfile);
      studentDraftBase.current = decision.baseUpdatedAt || "";
      if (decision.action === "restore-local") {
        applyStudentEditorSource(decision.draft);
        setStudentDraftNotice("unsaved");
        return;
      }
      if (decision.stale) {
        drafts.clearDraft(sessionStorage, "student-profile", session);
        setStudentDraftNotice("stale");
      }
    } else if (drafts) {
      studentDraftBase.current = drafts.stampOf(studentProfile);
    }
    applyStudentEditorSource(studentProfile);
  }, [studentProfile]);

  sUseEffect(() => {
    if (!studentHydrated.current) return undefined;
    if (!studentWriteReady.current) {
      studentWriteReady.current = true;
      return undefined;
    }
    const drafts = window.OV && window.OV.editorDraft;
    if (!drafts) return undefined;
    const timer = setTimeout(() => {
      drafts.writeDraft(sessionStorage, "student-profile", session, {
        preferredName,
        profilePhoto,
        headline,
        bio,
        nationality,
        country,
        state: stateRegion,
        city,
        currentStatus,
        careerInterests,
        areasOfInterest,
        languages,
        education: educationList,
        projects: projectsList,
        skills: skillsList,
        credentials: credentialsList,
        achievements: achievementsList,
        media: mediaList,
        links: linksList,
        contacts: contactsState,
        resume: resumeData,
        customLayout,
      }, studentDraftBase.current);
    }, 250);
    return () => clearTimeout(timer);
  }, [preferredName, profilePhoto, headline, bio, nationality, country, stateRegion, city, currentStatus, careerInterests, areasOfInterest, languages, educationList, projectsList, skillsList, credentialsList, achievementsList, mediaList, linksList, contactsState, resumeData, customLayout]);

  sUseEffect(() => {
    if (loadingProfile || onboardingReady) return;
    const resolved = onboardingApi
      ? onboardingApi.resolveStep({
        profile: studentProfile,
        done: sessionStorage.getItem(studentOnboardingKey(session, 'done')) === '1',
        savedStep: sessionStorage.getItem(studentOnboardingKey(session, 'step')) || '',
      })
      : (studentProfileHasContent(studentProfile) ? null : 'choice');
    setOnboardingStep(resolved);
    setOnboardingReady(true);
  }, [loadingProfile, studentProfile, onboardingReady, onboardingApi]);

  sUseEffect(() => {
    if (!onboardingReady) return;
    const stepKey = studentOnboardingKey(session, 'step');
    if (onboardingStep) sessionStorage.setItem(stepKey, onboardingStep);
    else sessionStorage.removeItem(stepKey);
  }, [onboardingReady, onboardingStep]);

  const showModule = (id) => {
    if (!onboardingReady || onboardingStep === 'choice' || onboardingStep === 'extract') return false;
    if (onboardingStep === 'resume') return id === 'resume';
    if (onboardingStep === 'profile') return activeSection === id && id !== 'resume';
    return activeSection === id;
  };

  const rememberOnboardingStep = (step) => {
    setOnboardingStep(step);
    if (step) sessionStorage.setItem(studentOnboardingKey(session, 'step'), step);
  };

  const finishOnboarding = () => {
    sessionStorage.setItem(studentOnboardingKey(session, 'done'), '1');
    sessionStorage.removeItem(studentOnboardingKey(session, 'step'));
    setOnboardingStep(null);
    setActiveSection('profile');
  };

  const saveOnboardingProfile = async () => {
    setIsSubmitting(true);
    const payload = {
      preferredName,
      profilePhoto,
      headline,
      bio,
      nationality,
      country,
      state: stateRegion,
      city,
      currentStatus,
      careerInterests,
      areasOfInterest,
      languages,
      education: educationList,
      projects: projectsList,
      skills: skillsList,
      credentials: credentialsList,
      achievements: achievementsList,
      media: mediaList,
      links: linksList,
      contacts: contactsState,
    };
    if (resumeCandidate) {
      payload.resume = resumeCandidate;
      payload.resumeFileName = resumeCandidate.fileName;
    }
    const saved = await onSaveToDb(payload);
    setIsSubmitting(false);
    if (!saved) return false;
    if (resumeCandidate) setResumeData(resumeCandidate);
    rememberOnboardingStep('resume');
    setActiveSection('resume');
    return true;
  };

  const applyExtractionToForm = (rows) => {
    if (!onboardingApi) return;
    const draft = onboardingApi.applyExtraction({
      headline,
      bio,
      contacts: { email: contactsState.email, phone: contactsState.phone },
      education: educationList,
      projects: projectsList,
      skills: skillsList,
      credentials: credentialsList,
      achievements: achievementsList,
      links: linksList,
    }, rows);
    setHeadline(draft.headline || '');
    setBio(draft.bio || '');
    setContactsState((current) => ({ ...current, email: draft.contacts.email || '', phone: draft.contacts.phone || '' }));
    setEducationList(draft.education);
    setProjectsList(draft.projects);
    setSkillsList(draft.skills);
    setCredentialsList(draft.credentials);
    setAchievementsList(draft.achievements);
    setLinksList(draft.links);
  };

  const sectionsList = [
    { id: 'profile', label: '1. Personal Profile' },
    { id: 'education', label: '2. Education' },
    { id: 'projects', label: '3. Projects' },
    { id: 'skills', label: '4. Skills' },
    { id: 'credentials', label: '5. Credentials' },
    { id: 'achievements', label: '6. Achievements' },
    { id: 'resume', label: '7. Resume (Single Slot)' },
    { id: 'media', label: '8. Media' },
    { id: 'contacts', label: '9. Links & Contacts' },
  ];

  /* ---------------- Module 1 Handlers ---------------- */
  const handleSavePersonalProfile = async (e) => {
    if (e) e.preventDefault();
    setIsSubmitting(true);
    try {
      await onSaveToDb({
        preferredName,
        profilePhoto,
        headline,
        bio,
        nationality,
        country,
        state: stateRegion,
        city,
        currentStatus,
        careerInterests,
        areasOfInterest,
        languages,
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleAddCareerInterest = (interest) => {
    const val = (interest || newCareerInput).trim();
    if (!val || careerInterests.includes(val)) return;
    setCareerInterests([...careerInterests, val]);
    setNewCareerInput('');
  };

  const handleRemoveCareerInterest = (idx) => {
    setCareerInterests(careerInterests.filter((_, i) => i !== idx));
  };

  const handleAddLanguage = () => {
    if (!newLang.language.trim()) return;
    setLanguages([...languages, { ...newLang, language: newLang.language.trim() }]);
    setNewLang({ language: '', proficiency: 'conversational' });
  };

  const handleRemoveLanguage = (idx) => {
    setLanguages(languages.filter((_, i) => i !== idx));
  };

  /* ---------------- Module 2 Handlers (Education) ---------------- */
  const handleOpenAddEdu = () => {
    setEditingEduIdx(null);
    setEduForm({
      institution: '',
      institutionType: 'university',
      degree: '',
      fieldOfStudy: '',
      specialization: '',
      department: '',
      startDate: '',
      endDate: '',
      expectedGradDate: '',
      currentStatus: 'studying',
      gpa: '',
      gpaScale: '4.0',
      percentage: '',
      gradeClass: '',
      rank: '',
      location: '',
      website: '',
      rollNumber: '',
      accreditation: '',
      coursework: '',
      honors: '',
      customFields: [],
    });
    setEduModalOpen(true);
  };

  const handleOpenEditEdu = (idx) => {
    setEditingEduIdx(idx);
    const item = educationList[idx];
    setEduForm({
      institution: item.institution || '',
      institutionType: item.institutionType || 'university',
      degree: item.degree || '',
      fieldOfStudy: item.fieldOfStudy || '',
      specialization: item.specialization || '',
      department: item.department || '',
      startDate: item.startDate || item.startYear || '',
      endDate: item.endDate || item.gradYear || '',
      expectedGradDate: item.expectedGradDate || '',
      currentStatus: item.currentStatus || 'studying',
      gpa: item.gpa || '',
      gpaScale: item.gpaScale || '4.0',
      percentage: item.percentage || '',
      gradeClass: item.gradeClass || '',
      rank: item.rank || '',
      location: item.location || '',
      website: item.website || '',
      rollNumber: item.rollNumber || '',
      accreditation: item.accreditation || '',
      coursework: item.coursework || '',
      honors: item.honors || '',
      customFields: item.customFields || [],
    });
    setEduModalOpen(true);
  };

  const handleSaveEduModal = async () => {
    if (!eduForm.institution.trim() || !eduForm.degree.trim()) {
      toast.push({ title: 'Validation Error', body: 'Institution and Degree are required.', tone: 'error' });
      return;
    }
    setIsSubmitting(true);
    let updatedList;
    if (editingEduIdx !== null) {
      updatedList = educationList.map((item, idx) =>
        idx === editingEduIdx ? { ...item, ...eduForm } : item
      );
    } else {
      updatedList = [...educationList, { id: 'edu_' + Date.now(), ...eduForm, verificationStatus: 'self-reported' }];
    }
    const success = await onSaveToDb({ education: updatedList });
    setIsSubmitting(false);
    if (success) {
      setEducationList(updatedList);
      setEduModalOpen(false);
    }
  };

  const handleDeleteEdu = async (idx) => {
    const updatedList = educationList.filter((_, i) => i !== idx);
    const success = await onSaveToDb({ education: updatedList });
    if (success) {
      setEducationList(updatedList);
      toast.push({ title: 'Education Removed', tone: 'info' });
    }
  };

  /* ---------------- Module 3 Handlers (Projects) ---------------- */
  const handleOpenAddProject = () => {
    setEditingProjIdx(null);
    setProjForm({
      title: '',
      projectType: 'academic',
      role: '',
      status: 'completed',
      isTeam: false,
      teamSize: 1,
      startDate: '',
      endDate: '',
      techStack: '',
      shortDescription: '',
      detailedDescription: '',
      problemSolved: '',
      keyFeatures: '',
      challengesSolutions: '',
      metricsResults: '',
      impact: '',
      repoUrl: '',
      liveUrl: '',
      docsUrl: '',
      videoUrl: '',
      assetId: '',
      isAiMl: false,
      dataset: '',
      algorithms: '',
      modelName: '',
      metrics: '',
    });
    setProjModalOpen(true);
  };

  const handleOpenEditProject = (idx) => {
    setEditingProjIdx(idx);
    const item = projectsList[idx];
    setProjForm({
      title: item.title || '',
      projectType: item.projectType || 'academic',
      role: item.role || '',
      status: item.status || 'completed',
      isTeam: Boolean(item.isTeam),
      teamSize: item.teamSize || 1,
      startDate: item.startDate || '',
      endDate: item.endDate || '',
      techStack: item.techStack || (Array.isArray(item.technologies) ? item.technologies.join(', ') : ''),
      shortDescription: item.shortDescription || item.summary || '',
      detailedDescription: item.detailedDescription || '',
      problemSolved: item.problemSolved || '',
      keyFeatures: item.keyFeatures || '',
      challengesSolutions: item.challengesSolutions || '',
      metricsResults: item.metricsResults || '',
      impact: item.impact || '',
      repoUrl: item.repoUrl || '',
      liveUrl: item.liveUrl || item.link || '',
      docsUrl: item.docsUrl || '',
      videoUrl: item.videoUrl || '',
      assetId: item.assetId || '',
      isAiMl: Boolean(item.aiDetails && (item.aiDetails.modelName || item.aiDetails.dataset)),
      dataset: item.aiDetails?.dataset || '',
      algorithms: item.aiDetails?.algorithms || '',
      modelName: item.aiDetails?.modelName || '',
      metrics: item.aiDetails?.metrics || '',
    });
    setProjModalOpen(true);
  };

  const handleSaveProjectModal = async () => {
    if (!projForm.title.trim()) {
      toast.push({ title: 'Validation Error', body: 'Project title is required.', tone: 'error' });
      return;
    }

    // Helper to sanitize / validate project URLs
    const checkAndCleanUrl = (val, fieldName) => {
      if (!val || typeof val !== 'string') return { ok: true, val: '' };
      let trimmed = val.trim();
      if (!trimmed || /^(none|n\/a|na|no|nil|null|-|\/)$/i.test(trimmed)) {
        return { ok: true, val: '' };
      }
      // If user typed domain or github shorthand without protocol
      if (!/^https?:\/\//i.test(trimmed)) {
        if (trimmed.includes('.') || trimmed.startsWith('localhost')) {
          trimmed = 'https://' + trimmed;
        } else if (/^[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+$/.test(trimmed)) {
          trimmed = 'https://github.com/' + trimmed;
        } else {
          return {
            ok: false,
            err: `${fieldName} ("${val}") must be a full web link (e.g. https://github.com/username/project) or left blank. Please clear this field if you don't have a repository link.`,
          };
        }
      }
      try {
        const parsed = new URL(trimmed);
        if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
          return { ok: true, val: trimmed };
        }
      } catch (e) {
        // invalid URL
      }
      return {
        ok: false,
        err: `${fieldName} ("${val}") is not a valid web URL. Please provide a link starting with https:// or leave it empty.`,
      };
    };

    const repoRes = checkAndCleanUrl(projForm.repoUrl, 'Source Repository URL');
    if (!repoRes.ok) {
      toast.push({ title: 'Invalid Repository Link', body: repoRes.err, tone: 'error' });
      return;
    }

    const liveRes = checkAndCleanUrl(projForm.liveUrl, 'Live Demo URL');
    if (!liveRes.ok) {
      toast.push({ title: 'Invalid Live Demo Link', body: liveRes.err, tone: 'error' });
      return;
    }

    setIsSubmitting(true);
    const techArray = projForm.techStack.split(',').map((s) => s.trim()).filter(Boolean);
    const payload = {
      ...projForm,
      repoUrl: repoRes.val,
      liveUrl: liveRes.val,
      link: liveRes.val || repoRes.val || '',
      technologies: techArray,
      aiDetails: projForm.isAiMl ? {
        dataset: projForm.dataset,
        algorithms: projForm.algorithms,
        modelName: projForm.modelName,
        metrics: projForm.metrics,
      } : undefined,
    };
    let updatedList;
    if (editingProjIdx !== null) {
      updatedList = projectsList.map((item, idx) =>
        idx === editingProjIdx ? { ...item, ...payload } : item
      );
    } else {
      updatedList = [...projectsList, { id: 'proj_' + Date.now(), ...payload }];
    }
    const success = await onSaveToDb({ projects: updatedList });
    setIsSubmitting(false);
    if (success) {
      setProjectsList(updatedList);
      setProjModalOpen(false);
    }
  };

  const handleDeleteProject = async (idx) => {
    const updatedList = projectsList.filter((_, i) => i !== idx);
    const success = await onSaveToDb({ projects: updatedList });
    if (success) {
      setProjectsList(updatedList);
      toast.push({ title: 'Project Removed', tone: 'info' });
    }
  };

  /* ---------------- Module 4 Handlers (Skills) ---------------- */
  const handleOpenAddSkill = () => {
    setEditingSkillIdx(null);
    setSkillForm({
      name: '',
      category: 'Programming Languages',
      proficiency: 'Intermediate',
      yearsExperience: 0,
      lastUsed: '',
      evidence: '',
      customFields: [],
    });
    setSkillModalOpen(true);
  };

  const handleOpenEditSkill = (idx) => {
    setEditingSkillIdx(idx);
    const item = skillsList[idx];
    setSkillForm({
      name: item.name || '',
      category: item.category || 'Programming Languages',
      proficiency: item.proficiency || item.level || 'Intermediate',
      yearsExperience: item.yearsExperience || 0,
      lastUsed: item.lastUsed || '',
      evidence: item.evidence || '',
      customFields: item.customFields || [],
    });
    setSkillModalOpen(true);
  };

  const handleSaveSkillModal = async () => {
    if (!skillForm.name.trim()) {
      toast.push({ title: 'Validation Error', body: 'Skill name is required.', tone: 'error' });
      return;
    }
    setIsSubmitting(true);
    let updatedList;
    if (editingSkillIdx !== null) {
      updatedList = skillsList.map((item, idx) =>
        idx === editingSkillIdx ? { ...item, ...skillForm } : item
      );
    } else {
      updatedList = [...skillsList, { id: 'sk_' + Date.now(), ...skillForm }];
    }
    const success = await onSaveToDb({ skills: updatedList });
    setIsSubmitting(false);
    if (success) {
      setSkillsList(updatedList);
      setSkillModalOpen(false);
    }
  };

  const handleDeleteSkill = async (idx) => {
    const updatedList = skillsList.filter((_, i) => i !== idx);
    const success = await onSaveToDb({ skills: updatedList });
    if (success) {
      setSkillsList(updatedList);
      toast.push({ title: 'Skill Removed', tone: 'info' });
    }
  };

  /* ---------------- Module 5 Handlers (Credentials) ---------------- */
  const handleOpenAddCred = () => {
    setEditingCredIdx(null);
    setCredForm({
      title: '',
      credentialType: 'course_certificate',
      issuer: '',
      credentialId: '',
      issueDate: '',
      expirationDate: '',
      neverExpires: false,
      credentialUrl: '',
      verificationUrl: '',
      description: '',
      relatedSkills: '',
    });
    setCredModalOpen(true);
  };

  const handleOpenEditCred = (idx) => {
    setEditingCredIdx(idx);
    const item = credentialsList[idx];
    setCredForm({
      title: item.title || '',
      credentialType: item.credentialType || 'course_certificate',
      issuer: item.issuer || '',
      credentialId: item.credentialId || '',
      issueDate: item.issueDate || '',
      expirationDate: item.expirationDate || '',
      neverExpires: Boolean(item.neverExpires),
      credentialUrl: item.credentialUrl || '',
      verificationUrl: item.verificationUrl || '',
      description: item.description || '',
      relatedSkills: Array.isArray(item.relatedSkills) ? item.relatedSkills.join(', ') : '',
    });
    setCredModalOpen(true);
  };

  const handleSaveCredModal = async () => {
    if (!credForm.title.trim() || !credForm.issuer.trim()) {
      toast.push({ title: 'Validation Error', body: 'Title and Issuer are required.', tone: 'error' });
      return;
    }
    setIsSubmitting(true);
    const skillsArr = credForm.relatedSkills.split(',').map((s) => s.trim()).filter(Boolean);
    const credlyUrl = canonicalCredlyBadgeUrl(credForm.verificationUrl);
    const previous = editingCredIdx !== null ? credentialsList[editingCredIdx] : null;
    const sameCredly = Boolean(previous && credlyUrl && canonicalCredlyBadgeUrl(previous.verificationUrl) === credlyUrl);
    const payload = {
      ...credForm,
      verificationUrl: credlyUrl || credForm.verificationUrl.trim(),
      relatedSkills: skillsArr,
      verificationStatus: credlyUrl ? (sameCredly ? (previous.verificationStatus || 'pending') : 'pending') : 'self-reported',
      verificationMethod: credlyUrl ? 'certificate-service' : 'self-reported',
      certificateVerificationId: sameCredly ? (previous.certificateVerificationId || '') : '',
    };
    let updatedList;
    if (editingCredIdx !== null) {
      updatedList = credentialsList.map((item, idx) =>
        idx === editingCredIdx ? { ...item, ...payload } : item
      );
    } else {
      updatedList = [...credentialsList, { id: 'crd_' + Date.now(), ...payload }];
    }
    const success = await onSaveToDb({ credentials: updatedList });
    if (!success) {
      setIsSubmitting(false);
      return;
    }
    setCredentialsList(updatedList);
    setCredModalOpen(false);
    if (credlyUrl) {
      const result = await verifyCredlyCertificate(credlyUrl);
      toast.push({
        title: result.ok ? 'Certificate check' : 'Verification unavailable',
        body: result.message,
        tone: result.ok ? (result.status === 'VERIFIED' ? 'success' : 'info') : 'error',
      });
    } else if (credForm.verificationUrl.trim()) {
      toast.push({
        title: 'Saved as self-reported',
        body: 'Only a Credly badge link can be checked by the certificate service.',
        tone: 'info',
      });
    }
    setIsSubmitting(false);
  };

  const verifyCredlyCertificate = async (url) => {
    const token = studentAuthToken(session);
    // #region agent log
    fetch('http://127.0.0.1:7577/ingest/1354e522-854d-4243-9c84-d52a865eb030',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'20b1df'},body:JSON.stringify({sessionId:'20b1df',runId:'post-fix',hypothesisId:'E',location:'StudentIdentityPage.jsx:verify-start',message:'student started certificate check',data:{signedIn:Boolean(token),credlyUrl:/^https:\/\/www\.credly\.com\/badges\/[0-9a-f-]{36}\/?$/i.test(url)},timestamp:Date.now()})}).catch(()=>{});
    // #endregion
    if (!token) {
      return { ok: false, message: 'Please sign in to verify a certificate.' };
    }
    const headers = {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
    };
    const api = studentApiBase();
    try {
      const submitted = await fetch(api + '/student/certificates', {
        method: 'POST',
        headers,
        body: JSON.stringify({ url }),
      });
      const submittedBody = await submitted.json().catch(() => ({}));
      // #region agent log
      fetch('http://127.0.0.1:7577/ingest/1354e522-854d-4243-9c84-d52a865eb030',{method:'POST',headers:{'Content-Type':'application/json','X-Debug-Session-Id':'20b1df'},body:JSON.stringify({sessionId:'20b1df',runId:'pre-fix',hypothesisId:'E',location:'StudentIdentityPage.jsx:verify',message:'student certificate submit returned',data:{status:submitted.status,hasMessage:Boolean(submittedBody&&submittedBody.message),credlyUrl:/^https:\/\/www\.credly\.com\/badges\/[0-9a-f-]{36}\/?$/i.test(url)},timestamp:Date.now()})}).catch(()=>{});
      // #endregion
      if (!submitted.ok) {
        return { ok: false, message: submittedBody.message || 'Certificate verification could not start.' };
      }
      const certificateId = submittedBody.certificate && submittedBody.certificate.id;
      if (!certificateId) {
        return { ok: false, message: 'The certificate service did not return a record.' };
      }
      const earnerEmail = String((contactsState && contactsState.email) || (session && session.user && session.user.email) || '').trim();
      const verifyBody = /^[^@\s]+@[^@\s]+$/.test(earnerEmail) ? { earnerEmail } : {};
      const checked = await fetch(api + '/student/certificates/' + certificateId + '/verify', {
        method: 'POST',
        headers,
        body: JSON.stringify(verifyBody),
      });
      const checkedBody = await checked.json().catch(() => ({}));
      if (!checked.ok) {
        return { ok: false, message: checkedBody.message || 'The certificate could not be checked.' };
      }
      const refreshed = await fetch(api + '/student/profile', {
        headers: { Authorization: 'Bearer ' + token },
      });
      const profileBody = await refreshed.json().catch(() => ({}));
      if (refreshed.ok && profileBody.profile && onProfileReplaced) {
        onProfileReplaced(profileBody.profile);
      }
      const status = checkedBody.certificate && checkedBody.certificate.status;
      if (status === 'VERIFIED') {
        return { ok: true, status, message: 'The issuer confirmed this credential. It is linked to your student identity.' };
      }
      if (status === 'UNVERIFIED') {
        return { ok: true, status, message: 'The issuer did not confirm this credential.' };
      }
      return { ok: true, status, message: 'The check is still pending. You can run it again from this credential.' };
    } catch (err) {
      return { ok: false, message: 'Could not reach the certificate verification service.' };
    }
  };

  const handleVerifyCredential = async (idx) => {
    const item = credentialsList[idx];
    const url = canonicalCredlyBadgeUrl(item && (item.verificationUrl || item.credentialUrl));
    if (!url) {
      toast.push({ title: 'Credly link required', body: 'Add a https://www.credly.com/badges/... link before verifying.', tone: 'error' });
      return;
    }
    const credKey = String((item && (item.id || item._id)) || idx);
    setVerifyingCredId(credKey);
    if (String(item.verificationUrl || '').trim() !== url) {
      const updatedList = credentialsList.map((entry, entryIndex) => (
        entryIndex === idx ? { ...entry, verificationUrl: url } : entry
      ));
      const saved = await onSaveToDb({ credentials: updatedList });
      if (!saved) {
        setVerifyingCredId('');
        return;
      }
      setCredentialsList(updatedList);
    }
    const result = await verifyCredlyCertificate(url);
    setVerifyingCredId('');
    toast.push({
      title: result.ok ? 'Certificate check' : 'Verification unavailable',
      body: result.message,
      tone: result.ok ? (result.status === 'VERIFIED' ? 'success' : 'info') : 'error',
    });
  };

  const handleDeleteCred = async (idx) => {
    const updatedList = credentialsList.filter((_, i) => i !== idx);
    const success = await onSaveToDb({ credentials: updatedList });
    if (success) {
      setCredentialsList(updatedList);
      toast.push({ title: 'Credential Removed', tone: 'info' });
    }
  };

  /* ---------------- Module 6 Handlers (Achievements) ---------------- */
  const handleOpenAddAch = () => {
    setEditingAchIdx(null);
    setAchForm({
      title: '',
      category: 'hackathon',
      organization: '',
      date: '',
      positionRank: '',
      awardPrize: '',
      teamSize: 1,
      role: '',
      location: '',
      description: '',
      proofUrl: '',
      customFields: [],
    });
    setAchModalOpen(true);
  };

  const handleOpenEditAch = (idx) => {
    setEditingAchIdx(idx);
    const item = achievementsList[idx];
    setAchForm({
      title: item.title || '',
      category: item.category || 'hackathon',
      organization: item.organization || '',
      date: item.date || item.year || '',
      positionRank: item.positionRank || '',
      awardPrize: item.awardPrize || '',
      teamSize: item.teamSize || 1,
      role: item.role || '',
      location: item.location || '',
      description: item.description || '',
      proofUrl: item.proofUrl || '',
      customFields: item.customFields || [],
    });
    setAchModalOpen(true);
  };

  const handleSaveAchModal = async () => {
    if (!achForm.title.trim()) {
      toast.push({ title: 'Validation Error', body: 'Achievement title is required.', tone: 'error' });
      return;
    }
    setIsSubmitting(true);
    let updatedList;
    if (editingAchIdx !== null) {
      updatedList = achievementsList.map((item, idx) =>
        idx === editingAchIdx ? { ...item, ...achForm } : item
      );
    } else {
      updatedList = [...achievementsList, { id: 'ach_' + Date.now(), ...achForm, verificationStatus: 'self-reported' }];
    }
    const success = await onSaveToDb({ achievements: updatedList });
    setIsSubmitting(false);
    if (success) {
      setAchievementsList(updatedList);
      setAchModalOpen(false);
    }
  };

  const handleDeleteAch = async (idx) => {
    const updatedList = achievementsList.filter((_, i) => i !== idx);
    const success = await onSaveToDb({ achievements: updatedList });
    if (success) {
      setAchievementsList(updatedList);
      toast.push({ title: 'Achievement Removed', tone: 'info' });
    }
  };

  /* ---------------- Module 7 Handlers (Resume — Single Slot) ---------------- */
  const handleResumeFileSelect = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      toast.push({ title: 'Invalid File', body: 'Only PDF format is accepted for resumes.', tone: 'error' });
      if (resumeFileRef.current) resumeFileRef.current.value = '';
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.push({ title: 'File Too Large', body: 'Resume must not exceed 10 MB.', tone: 'error' });
      if (resumeFileRef.current) resumeFileRef.current.value = '';
      return;
    }

    const token = studentAuthToken(session);
    if (!token) {
      toast.push({ title: 'Authentication missing', body: 'Please sign in before extracting a resume.', tone: 'error' });
      if (resumeFileRef.current) resumeFileRef.current.value = '';
      return;
    }

    setResumeUploading(true);
    const form = new FormData();
    form.append('file', file, 'resume.pdf');
    try {
      const res = await fetch(studentApiBase() + '/student/resume/extract', {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + token },
        body: form,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.push({ title: 'Resume extraction failed', body: data.message || 'The resume extractor could not read this PDF.', tone: 'error' });
        return;
      }
      const metadata = {
        fileName: file.name,
        fileSize: file.size,
        contentType: 'application/pdf',
        storageKey: '',
        uploadedAt: new Date().toISOString(),
        resumeName: file.name.replace(/\.pdf$/i, ''),
        targetRole: resumeRoleInput || 'Software Engineer',
      };
      if (onboardingStep === 'extract') {
        applyExtractionToForm(data.rows || []);
        setResumeCandidate(metadata);
        setResumeReview(null);
        setResumeSelection({});
        rememberOnboardingStep('profile');
        setActiveSection('profile');
        toast.push({ title: 'Resume read', body: 'The profile form is filled from the resume. Edit anything, then save and continue.', tone: 'success' });
        return;
      }
      const existingProfile = studentProfileHasContent(studentProfile);
      const nextSelection = {};
      (data.rows || []).forEach((row) => {
        const entryRows = (data.rows || []).filter((item) => item.section === row.section && item.entryIndex === row.entryIndex);
        const current = resumeRowCurrentValue(studentProfile, row, entryRows);
        const kind = resumeChangeKind(current, row.value);
        const confident = row.confidence === 'high' || row.confidence === 'medium';
        if (resumeRowSelectable(row, entryRows) && kind === 'new' && (existingProfile ? confident : true)) {
          nextSelection[row.id] = true;
        }
      });
      setResumeCandidate(metadata);
      setResumeReview(data);
      setResumeSelection(nextSelection);
      setResumeSkillExtras({});
      setResumeIssuers({});
      toast.push({ title: 'Resume read', body: 'Review the extracted fields, then save the ones you want on your identity.', tone: 'success' });
    } catch (err) {
      toast.push({ title: 'Resume extraction failed', body: 'Could not reach the resume extractor.', tone: 'error' });
    } finally {
      setResumeUploading(false);
      if (resumeFileRef.current) resumeFileRef.current.value = '';
    }
  };

  const handleToggleResumeRow = (row, entryRows, checked) => {
    setResumeSelection((current) => {
      const next = { ...current, [row.id]: checked };
      if (!checked) return next;
      const required = row.section === 'education'
        ? ['institution', 'degree']
        : row.section === 'socialLinks'
          ? ['platform', 'url']
          : row.section === 'projects'
            ? ['name']
            : [];
      required.forEach((field) => {
        const match = entryRows.find((item) => item.field === field && resumeRowSelectable(item, entryRows));
        if (match) next[match.id] = true;
      });
      return next;
    });
  };

  const handleApplyResume = async () => {
    if (!resumeReview || !resumeReview.reviewId) return;
    const groups = new Map();
    (resumeReview.rows || []).forEach((row) => {
      if (!resumeSelection[row.id]) return;
      const entryRows = (resumeReview.rows || []).filter((item) => item.section === row.section && item.entryIndex === row.entryIndex);
      if (!resumeRowSelectable(row, entryRows)) return;
      const key = row.section + ':' + row.entryIndex;
      if (!groups.has(key)) {
        groups.set(key, { section: row.section, index: row.entryIndex, fields: [] });
      }
      const group = groups.get(key);
      if (!group.fields.includes(row.field)) group.fields.push(row.field);
    });
    const selections = [];
    for (const group of groups.values()) {
      const entryRows = (resumeReview.rows || []).filter((item) => item.section === group.section && item.entryIndex === group.index);
      const required = group.section === 'education'
        ? ['institution', 'degree']
        : group.section === 'socialLinks'
          ? ['platform', 'url']
          : group.section === 'projects'
            ? ['name']
            : [];
      required.forEach((field) => {
        const match = entryRows.find((item) => item.field === field && resumeRowSelectable(item, entryRows));
        if (match && !group.fields.includes(field)) group.fields.push(field);
      });
      if (group.section === 'skills') {
        const extra = resumeSkillExtras[group.index] || { category: 'Other Skills', proficiency: 'Intermediate' };
        group.category = extra.category;
        group.proficiency = extra.proficiency;
      }
      if (group.section === 'credentials') {
        const issuer = String(resumeIssuers[group.index] || '').trim();
        if (!issuer) {
          toast.push({ title: 'Issuer required', body: 'Add an issuer before saving a certificate found on the resume.', tone: 'error' });
          return;
        }
        group.issuer = issuer;
      }
      selections.push(group);
    }
    if (selections.length === 0) {
      toast.push({ title: 'Nothing selected', body: 'Choose at least one field the profile can store.', tone: 'error' });
      return;
    }
    const token = studentAuthToken(session);
    if (!token) {
      toast.push({ title: 'Authentication missing', body: 'Please sign in before saving extracted fields.', tone: 'error' });
      return;
    }
    setResumeApplying(true);
    try {
      const res = await fetch(studentApiBase() + '/student/resume/apply', {
        method: 'POST',
        headers: {
          Authorization: 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ reviewId: resumeReview.reviewId, selections }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast.push({ title: 'Could not save fields', body: data.message || 'The extracted fields were not saved.', tone: 'error' });
        return;
      }
      if (data.profile && onProfileReplaced) onProfileReplaced(data.profile);
      if (resumeCandidate) {
        const savedResume = await onSaveToDb({ resume: resumeCandidate, resumeFileName: resumeCandidate.fileName });
        if (savedResume) setResumeData(resumeCandidate);
        setResumeCandidate(null);
      }
      const skipped = Array.isArray(data.skipped) ? data.skipped.length : 0;
      toast.push({
        title: studentProfileHasContent(studentProfile) ? 'Selected changes applied' : 'Profile saved',
        body: skipped > 0
          ? 'Approved resume fields were saved. ' + skipped + ' already matched your profile.'
          : 'Approved resume fields were saved. Unchecked fields were left unchanged.',
        tone: 'success',
      });
      setResumeReview(null);
      setResumeSelection({});
    } catch (err) {
      toast.push({ title: 'Could not save fields', body: 'Could not reach the resume extractor.', tone: 'error' });
    } finally {
      setResumeApplying(false);
    }
  };

  const handleDiscardResumeReview = async () => {
    const reviewId = resumeReview && resumeReview.reviewId;
    const token = studentAuthToken(session);
    setResumeReview(null);
    setResumeSelection({});
    setResumeSkillExtras({});
    setResumeIssuers({});
    setResumeCandidate(null);
    if (!reviewId || !token) return;
    try {
      await fetch(studentApiBase() + '/student/resume/reviews/' + reviewId, {
        method: 'DELETE',
        headers: { Authorization: 'Bearer ' + token },
      });
    } catch (err) {
      // The local review is already closed. A failed discard only leaves it to expire on the server.
    }
  };

  const handleRemoveResume = async () => {
    setIsSubmitting(true);
    const success = await onSaveToDb({
      resume: { fileName: '', fileSize: 0, storageKey: '', uploadedAt: null, targetRole: '' },
      resumeFileName: '',
      resumeUrl: '',
    });
    setIsSubmitting(false);
    if (success) {
      setResumeData(null);
      toast.push({ title: 'Resume Removed', body: 'Single resume slot is now empty.', tone: 'info' });
    }
  };

  /* ---------------- Module 8 Handlers (Media) ---------------- */
  const handleOpenAddMedia = () => {
    setEditingMediaIdx(null);
    setMediaForm({
      title: '',
      mediaUrl: '',
      assetId: '',
      mediaType: 'image',
      category: 'project',
      description: '',
      altText: '',
      isFeatured: false,
      customFields: [],
    });
    setMediaModalOpen(true);
  };

  const handleOpenEditMedia = (idx) => {
    setEditingMediaIdx(idx);
    const item = mediaList[idx];
    setMediaForm({
      title: item.title || '',
      mediaUrl: item.mediaUrl || item.url || '',
      assetId: item.assetId || '',
      mediaType: item.mediaType || 'image',
      category: item.category || 'project',
      description: item.description || '',
      altText: item.altText || '',
      isFeatured: Boolean(item.isFeatured),
    });
    setMediaModalOpen(true);
  };

  const handleSaveMediaModal = async () => {
    if (!mediaForm.title.trim() || (!mediaForm.mediaUrl.trim() && !mediaForm.assetId)) {
      toast.push({ title: 'Validation Error', body: 'Add a title and either an https link or an uploaded file.', tone: 'error' });
      return;
    }
    if (mediaForm.mediaUrl.trim() && !/^https?:\/\//i.test(mediaForm.mediaUrl.trim())) {
      toast.push({ title: 'Invalid media link', body: 'Media links must start with http:// or https://.', tone: 'error' });
      return;
    }
    setIsSubmitting(true);
    let updatedList;
    if (editingMediaIdx !== null) {
      updatedList = mediaList.map((item, idx) =>
        idx === editingMediaIdx ? { ...item, ...mediaForm } : item
      );
    } else {
      updatedList = [...mediaList, { id: 'med_' + Date.now(), ...mediaForm, displayOrder: mediaList.length }];
    }
    const success = await onSaveToDb({ media: updatedList });
    setIsSubmitting(false);
    if (success) {
      setMediaList(updatedList);
      setMediaModalOpen(false);
    }
  };

  const handleDeleteMedia = async (idx) => {
    const updatedList = mediaList.filter((_, i) => i !== idx);
    const success = await onSaveToDb({ media: updatedList });
    if (success) {
      setMediaList(updatedList);
      toast.push({ title: 'Media Item Removed', tone: 'info' });
    }
  };

  /* ---------------- Module 9 Handlers (Links & Contacts) ---------------- */
  const handleOpenAddLink = () => {
    setEditingLinkIdx(null);
    setLinkForm({
      platform: 'GitHub',
      url: '',
      category: 'coding',
      username: '',
      isPrimary: false,
      visibility: 'public',
    });
    setLinkModalOpen(true);
  };

  const handleOpenEditLink = (idx) => {
    setEditingLinkIdx(idx);
    const item = linksList[idx];
    setLinkForm({
      platform: item.platform || '',
      url: item.url || '',
      category: item.category || 'professional',
      username: item.username || '',
      isPrimary: Boolean(item.isPrimary),
      visibility: item.visibility || 'public',
    });
    setLinkModalOpen(true);
  };

  const handleSaveLinkModal = async () => {
    if (!linkForm.platform.trim() || !linkForm.url.trim()) {
      toast.push({ title: 'Validation Error', body: 'Platform and URL are required.', tone: 'error' });
      return;
    }
    setIsSubmitting(true);
    let updatedList;
    if (editingLinkIdx !== null) {
      updatedList = linksList.map((item, idx) =>
        idx === editingLinkIdx ? { ...item, ...linkForm } : item
      );
    } else {
      updatedList = [...linksList, { id: 'lnk_' + Date.now(), ...linkForm, verificationStatus: 'unverified' }];
    }
    const success = await onSaveToDb({ links: updatedList });
    setIsSubmitting(false);
    if (success) {
      setLinksList(updatedList);
      setLinkModalOpen(false);
    }
  };

  const handleDeleteLink = async (idx) => {
    const updatedList = linksList.filter((_, i) => i !== idx);
    const success = await onSaveToDb({ links: updatedList });
    if (success) {
      setLinksList(updatedList);
      toast.push({ title: 'Link Removed', tone: 'info' });
    }
  };

  const handleSaveContacts = async (e) => {
    if (e) e.preventDefault();
    setIsSubmitting(true);
    try {
      await onSaveToDb({ contacts: contactsState });
    } finally {
      setIsSubmitting(false);
    }
  };

  const studentCustomRecords = (sectionId) => {
    const lists = {
      education: educationList.map((item) => ({ id: String(item.id || item._id || ""), title: item.institution || "Education" })),
      projects: projectsList.map((item) => ({ id: String(item.id || item._id || ""), title: item.title || "Project" })),
      skills: skillsList.map((item) => ({ id: String(item.id || item._id || ""), title: item.name || "Skill" })),
      credentials: credentialsList.map((item) => ({ id: String(item.id || item._id || ""), title: item.title || "Credential" })),
      achievements: achievementsList.map((item) => ({ id: String(item.id || item._id || ""), title: item.title || "Achievement" })),
      media: mediaList.map((item) => ({ id: String(item.id || item._id || ""), title: item.title || "Media" })),
      links: linksList.map((item) => ({ id: String(item.id || item._id || ""), title: item.platform || "Link" })),
    };
    return lists[sectionId] || [];
  };

  const renderRecordFields = (sectionId, record) => {
    if (!window.RecordLinkedFields) return null;
    const recordId = String((record && (record.id || record._id)) || "");
    if (!recordId) return null;
    return (
      <RecordLinkedFields
        identity="student"
        sectionId={sectionId}
        recordId={recordId}
        layout={customLayout}
        records={studentCustomRecords(sectionId)}
        disabled={isSubmitting}
        onChange={setCustomLayout}
      />
    );
  };

  const saveStudentCustomLayout = async (next, sectionId) => {
    setCustomLayout(next);
    const payload = { customLayout: next };
    if (sectionId === "education") payload.education = educationList;
    if (sectionId === "projects") payload.projects = projectsList;
    if (sectionId === "skills") payload.skills = skillsList;
    if (sectionId === "credentials") payload.credentials = credentialsList;
    if (sectionId === "achievements") payload.achievements = achievementsList;
    if (sectionId === "media") payload.media = mediaList;
    if (sectionId === "links") payload.links = linksList;
    if (sectionId === "contacts") payload.contacts = contactsState;
    if (sectionId === "resume") payload.resume = resumeData;
    return onSaveToDb(payload);
  };

  return (
    <div style={{ display: 'grid', gap: 24 }}>
      <input
        type="file"
        accept="application/pdf,.pdf"
        ref={resumeFileRef}
        style={{ display: 'none' }}
        onChange={handleResumeFileSelect}
      />
      {/* Page Header */}
      <div>
        <span className="eyebrow" style={{ color: 'var(--accent)', fontSize: 12 }}>
          {onboardingStep ? 'Student onboarding' : 'Domain Architecture'}
        </span>
        <h1 className="h-card" style={{ fontSize: 32, margin: '4px 0 6px' }}>Student Identity</h1>
        <p className="muted" style={{ fontSize: 15, margin: 0 }}>
          {onboardingStep === 'choice' && 'Choose how you want to start your student profile.'}
          {onboardingStep === 'extract' && 'Upload a PDF resume. You can edit every field before it is saved.'}
          {onboardingStep === 'profile' && 'Review the profile, edit any field, then save and continue.'}
          {onboardingStep === 'resume' && 'Your profile is saved. Keep this resume or replace it.'}
          {!onboardingStep && 'Manage all nine verified profile sections that shape your admissions, internship, and research views.'}
        </p>
      </div>

      {onboardingStep && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }} aria-label="Onboarding progress">
          {[
            ['choice', '1. Choose'],
            ['profile', '2. Profile'],
            ['resume', '3. Resume'],
          ].map(([id, label]) => {
            const current = onboardingStep === id || (id === 'profile' && onboardingStep === 'extract');
            return (
              <span key={id} className="badge" style={{ fontSize: 12, opacity: current ? 1 : 0.55 }}>{label}</span>
            );
          })}
        </div>
      )}

      {onboardingStep === 'choice' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 16 }}>
          <button
            type="button"
            className="glass"
            onClick={() => rememberOnboardingStep('extract')}
            style={{ textAlign: 'left', padding: 24, borderRadius: 20, border: '1px solid var(--line)', cursor: 'pointer', background: 'var(--glass)' }}
          >
            <h2 style={{ fontSize: 20, margin: '0 0 8px' }}>Upload Resume</h2>
            <p className="muted" style={{ margin: 0, fontSize: 14 }}>Read a PDF and fill the profile form. You can correct every field before saving.</p>
          </button>
          <button
            type="button"
            className="glass"
            onClick={() => { rememberOnboardingStep('profile'); setActiveSection('profile'); }}
            style={{ textAlign: 'left', padding: 24, borderRadius: 20, border: '1px solid var(--line)', cursor: 'pointer', background: 'var(--glass)' }}
          >
            <h2 style={{ fontSize: 20, margin: '0 0 8px' }}>Enter Manually</h2>
            <p className="muted" style={{ margin: 0, fontSize: 14 }}>Start with an empty profile. A resume is not required.</p>
          </button>
        </div>
      )}

      {onboardingStep === 'extract' && (
        <section className="glass" style={{ padding: 28, borderRadius: 20, display: 'grid', gap: 14 }}>
          <h2 style={{ fontSize: 20, margin: 0 }}>Upload Resume</h2>
          <p className="muted" style={{ margin: 0, fontSize: 14 }}>PDF only, up to 10 MB. Extraction fills the form and does not save until you continue.</p>
          {resumeUploading && <p className="muted" style={{ margin: 0 }}>Reading the PDF…</p>}
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Button variant="primary" loading={resumeUploading} onClick={() => resumeFileRef.current && resumeFileRef.current.click()}>Choose PDF Resume</Button>
            <Button variant="ghost" disabled={resumeUploading} onClick={() => rememberOnboardingStep('choice')}>Back</Button>
            <Button variant="ghost" disabled={resumeUploading} onClick={() => { rememberOnboardingStep('profile'); setActiveSection('profile'); }}>Enter Manually</Button>
          </div>
        </section>
      )}

      {studentDraftNotice === "unsaved" ? (
        <p role="status" style={{ margin: 0 }}>Unsaved edits for this account were restored. They are not published.</p>
      ) : null}
      {studentDraftNotice === "stale" ? (
        <p role="status" style={{ margin: 0 }}>The saved profile changed on the server. Older browser edits were not applied.</p>
      ) : null}

      {/* 9 Section Tabs */}
      {onboardingReady && onboardingStep !== 'choice' && onboardingStep !== 'extract' && onboardingStep !== 'resume' && (
      <div
        className="glass"
        style={{
          padding: '6px',
          borderRadius: 16,
          display: 'flex',
          gap: 6,
          overflowX: 'auto',
          scrollbarWidth: 'none',
        }}
      >
        {sectionsList.filter((sec) => onboardingStep !== 'profile' || sec.id !== 'resume').map((sec) => {
          const isCurrent = activeSection === sec.id;
          return (
            <button
              key={sec.id}
              onClick={() => handleSelectSection(sec.id)}
              className="tab"
              style={{
                borderRadius: 12,
                padding: '8px 14px',
                fontSize: 13,
                fontWeight: isCurrent ? 600 : 500,
                color: isCurrent ? 'var(--text-1)' : 'var(--text-2)',
                background: isCurrent ? 'color-mix(in oklab, var(--primary) 22%, var(--glass))' : 'transparent',
                border: isCurrent ? '1px solid color-mix(in oklab, var(--primary) 40%, transparent)' : 'none',
                cursor: 'pointer',
                whiteSpace: 'nowrap',
              }}
            >
              {sec.label}
            </button>
          );
        })}
      </div>
      )}

      {(onboardingStep === 'profile' || onboardingStep === 'resume') && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Button variant="ghost" onClick={() => rememberOnboardingStep(onboardingApi ? onboardingApi.goBack(onboardingStep) : 'choice')}>Back</Button>
          {onboardingStep === 'profile' && (
            <Button variant="primary" loading={isSubmitting} onClick={saveOnboardingProfile}>Save & Continue</Button>
          )}
          {onboardingStep === 'resume' && (
            <Button variant="primary" onClick={finishOnboarding}>Continue</Button>
          )}
        </div>
      )}

      {/* -------------------------------------------------------------
          MODULE 1: Personal Profile
          ------------------------------------------------------------- */}
      {showModule('profile') && (
        <section className="glass" style={{ padding: 28, borderRadius: 20, display: 'grid', gap: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <h2 className="h-sub" style={{ fontSize: 20, margin: 0 }}>Personal Profile</h2>
              <p className="muted" style={{ fontSize: 14, margin: '4px 0 0' }}>
                Basic student identity, bio, location, and career focus. Unsaved edits stay in this browser until you save. Languages, nationality, interests, and current status are kept even when this template does not show them publicly.
              </p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Badge tone="verified">Connected to Database</Badge>
              <Button
                type="button"
                variant="primary"
                size="sm"
                loading={isSubmitting}
                onClick={handleSavePersonalProfile}
              >
                Save Profile
              </Button>
            </div>
          </div>

          <form onSubmit={handleSavePersonalProfile} style={{ display: 'grid', gap: 18, maxWidth: 680 }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
              <Input
                label="Full Account Name"
                value={session?.user?.name || ''}
                disabled
                hint="Managed by account authentication."
              />
              <Input
                label="Preferred / Display Name"
                value={preferredName}
                onChange={(e) => setPreferredName(e.target.value)}
                placeholder="e.g. Alex"
              />
            </div>

            <Input
              label="Academic Headline"
              value={headline}
              onChange={(e) => setHeadline(e.target.value)}
              placeholder="e.g. Computer Science Student | Machine Learning Enthusiast"
            />

            <EditorRichText
              label="Academic Bio"
              value={bio}
              onChange={setBio}
              placeholder="Write a brief overview of your academic focus and research interests..."
            />

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 14 }}>
              <Select
                label="Current Status"
                value={currentStatus}
                onChange={(e) => setCurrentStatus(e.target.value)}
                options={[
                  { value: 'student', label: 'Full-time Student' },
                  { value: 'internship-seeking', label: 'Internship Seeking' },
                  { value: 'full-time-seeking', label: 'Full-time Job Seeking' },
                  { value: 'researcher', label: 'Academic Researcher' },
                  { value: 'freelancer', label: 'Student Freelancer' },
                  { value: 'employed', label: 'Employed' },
                  { value: 'open-to-opportunities', label: 'Open to Opportunities' },
                ]}
              />
              <Input
                label="City"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="e.g. Cambridge"
              />
              <Input
                label="State / Region"
                value={stateRegion}
                onChange={(e) => setStateRegion(e.target.value)}
                placeholder="e.g. MA"
              />
              <Input
                label="Country"
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                placeholder="e.g. USA"
              />
            </div>

            {/* Career Interests Tag Builder */}
            <div className="field">
              <label className="field-label">Career Interests</label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 10 }}>
                {careerInterests.map((interest, idx) => (
                  <span
                    key={idx}
                    className="badge"
                    style={{
                      padding: '4px 10px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    {interest}
                    <button
                      type="button"
                      onClick={() => handleRemoveCareerInterest(idx)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                      aria-label="Remove interest"
                    >
                      <Icon.x width="12" height="12" />
                    </button>
                  </span>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  className="input"
                  placeholder="Add custom career interest (e.g. Robotics, Fintech)..."
                  value={newCareerInput}
                  onChange={(e) => setNewCareerInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleAddCareerInterest();
                    }
                  }}
                />
                <Button type="button" variant="glass" size="sm" onClick={() => handleAddCareerInterest()}>
                  Add
                </Button>
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                {['Software Engineering', 'AI/ML', 'Data Science', 'Cybersecurity', 'Cloud Computing', 'Backend Development', 'DevOps'].map((sugg) => (
                  <button
                    key={sugg}
                    type="button"
                    onClick={() => handleAddCareerInterest(sugg)}
                    className="badge"
                    style={{ cursor: 'pointer', background: 'transparent', border: '1px solid var(--line)' }}
                  >
                    + {sugg}
                  </button>
                ))}
              </div>
            </div>

            {/* Languages Known */}
            <div className="field">
              <label className="field-label">Languages Known</label>
              <div style={{ display: 'grid', gap: 8, marginBottom: 10 }}>
                {languages.map((l, idx) => (
                  <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'color-mix(in oklab, var(--glass) 60%, transparent)', padding: '6px 12px', borderRadius: 10 }}>
                    <span style={{ fontSize: 13.5 }}><strong>{l.language}</strong> — <span className="muted">{l.proficiency}</span></span>
                    <button type="button" onClick={() => handleRemoveLanguage(idx)} className="icon-btn" style={{ width: 26, height: 26 }}>
                      <Icon.x width="12" height="12" />
                    </button>
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  className="input"
                  placeholder="Language (e.g. English, French, Spanish)..."
                  value={newLang.language}
                  onChange={(e) => setNewLang({ ...newLang, language: e.target.value })}
                  style={{ flex: 2 }}
                />
                <select
                  className="select"
                  value={newLang.proficiency}
                  onChange={(e) => setNewLang({ ...newLang, proficiency: e.target.value })}
                  style={{ flex: 1 }}
                >
                  <option value="basic">Basic</option>
                  <option value="conversational">Conversational</option>
                  <option value="fluent">Fluent</option>
                  <option value="native">Native</option>
                </select>
                <Button type="button" variant="glass" size="sm" onClick={handleAddLanguage}>
                  Add Language
                </Button>
              </div>
            </div>

            <Button type="submit" variant="primary" loading={isSubmitting} style={{ justifySelf: 'start', marginTop: 8 }}>
              Save Personal Profile
            </Button>
          </form>
        </section>
      )}

      {/* -------------------------------------------------------------
          MODULE 2: Education (Canonical Source of Truth)
          ------------------------------------------------------------- */}
      {showModule('education') && (
        <section className="glass" style={{ padding: 28, borderRadius: 20, display: 'grid', gap: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <h2 className="h-sub" style={{ fontSize: 20, margin: 0 }}>Education & Academic Qualifications</h2>
              <p className="muted" style={{ fontSize: 13.5, margin: '2px 0 0' }}>
                Canonical academic history. Add multiple degrees, colleges, and schools without losing data.
              </p>
            </div>
            <Button size="sm" variant="primary" icon={<Icon.plus />} onClick={handleOpenAddEdu}>
              + Add Degree / School
            </Button>
          </div>

          {educationList.length === 0 ? (
            <EmptyState
              title="No Education Records Found"
              body="Add your university, college, major, graduation timeline, and GPA."
              action={<Button size="sm" variant="primary" icon={<Icon.plus />} onClick={handleOpenAddEdu}>Add Education</Button>}
            />
          ) : (
            <div style={{ display: 'grid', gap: 14 }}>
              {educationList.map((edu, idx) => (
                <div
                  key={edu.id || edu._id || idx}
                  className="glass"
                  style={{ padding: 20, borderRadius: 16, border: '1px solid var(--line)', display: 'grid', gap: 10 }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10 }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <h4 style={{ fontSize: 18, margin: 0 }}>{edu.institution}</h4>
                        <span className="badge" style={{ textTransform: 'capitalize', fontSize: 11 }}>
                          {edu.institutionType ? edu.institutionType.replace('_', ' ') : 'University'}
                        </span>
                        <span className="badge badge-verified" style={{ fontSize: 11 }}>
                          {edu.verificationStatus || 'Self-reported'}
                        </span>
                      </div>
                      <p className="muted" style={{ fontSize: 14, margin: '4px 0 0' }}>
                        {edu.degree} {edu.fieldOfStudy ? `• ${edu.fieldOfStudy}` : ''}
                      </p>
                      <div style={{ display: 'flex', gap: 12, marginTop: 6, fontSize: 12.5, color: 'var(--text-3)' }}>
                        <span>
                          {edu.startDate || edu.startYear ? `${edu.startDate || edu.startYear} — ` : ''}
                          {edu.endDate || edu.gradYear || edu.expectedGradDate || 'Present'}
                        </span>
                        <span>• Status: <strong style={{ color: 'var(--text-2)', textTransform: 'capitalize' }}>{edu.currentStatus || 'studying'}</strong></span>
                        {edu.location && <span>• {edu.location}</span>}
                      </div>
                    </div>

                    <div style={{ display: 'flex', gap: 8 }}>
                      <Button size="sm" variant="ghost" onClick={() => handleOpenEditEdu(idx)}>
                        <StudentIcons.edit /> Edit
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => handleDeleteEdu(idx)} style={{ color: '#ef4444' }}>
                        <StudentIcons.trash /> Delete
                      </Button>
                    </div>
                  </div>

                  {/* Badges for GPA, coursework, honors */}
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginTop: 4 }}>
                    {edu.gpa && (
                      <span className="badge badge-verified" style={{ fontSize: 12 }}>
                        GPA: {edu.gpa} {edu.gpaScale ? `(${edu.gpaScale} scale)` : ''}
                      </span>
                    )}
                    {edu.percentage && (
                      <span className="badge" style={{ fontSize: 12 }}>{edu.percentage}%</span>
                    )}
                    {edu.rollNumber && (
                      <span className="badge" style={{ fontSize: 11, color: 'var(--text-3)' }}>
                        <Icon.lock width="11" height="11" /> Roll ID: {edu.rollNumber} (Private)
                      </span>
                    )}
                  </div>

                  {edu.coursework && (
                    <p style={{ fontSize: 12.5, margin: '4px 0 0', color: 'var(--text-2)' }}>
                      <strong>Coursework:</strong> {edu.coursework}
                    </p>
                  )}
                  {edu.honors && (
                    <p style={{ fontSize: 12.5, margin: 0, color: 'var(--accent)' }}>
                      <strong>Honors:</strong> {edu.honors}
                    </p>
                  )}
                  {renderRecordFields('education', edu)}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* -------------------------------------------------------------
          MODULE 3: Projects
          ------------------------------------------------------------- */}
      {showModule('projects') && (
        <section className="glass" style={{ padding: 28, borderRadius: 20, display: 'grid', gap: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <h2 className="h-sub" style={{ fontSize: 20, margin: 0 }}>Academic Projects & Capstones</h2>
              <p className="muted" style={{ fontSize: 13.5, margin: '2px 0 0' }}>
                Showcase team software, publications, research experiments, and hackathon deliverables.
              </p>
            </div>
            <Button size="sm" variant="primary" icon={<Icon.plus />} onClick={handleOpenAddProject}>
              + Add Project
            </Button>
          </div>

          {projectsList.length === 0 ? (
            <EmptyState
              title="No Academic Projects Added Yet"
              body="Add capstones, research repositories, hackathon winners, or course deliverables."
              action={<Button size="sm" variant="primary" icon={<Icon.plus />} onClick={handleOpenAddProject}>Add Project</Button>}
            />
          ) : (
            <div style={{ display: 'grid', gap: 14 }}>
              {projectsList.map((p, idx) => (
                <div key={p.id || p._id || idx} className="glass" style={{ padding: 20, borderRadius: 16, border: '1px solid var(--line)', display: 'grid', gap: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10 }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <h4 style={{ fontSize: 18, margin: 0 }}>{p.title}</h4>
                        <span className="badge" style={{ textTransform: 'capitalize', fontSize: 11 }}>{p.projectType || 'Academic'}</span>
                        <span className="badge" style={{ textTransform: 'capitalize', fontSize: 11 }}>{p.status || 'Completed'}</span>
                        {p.isTeam && <span className="badge" style={{ fontSize: 11 }}>Team ({p.teamSize || 2})</span>}
                      </div>
                      {p.role && <p className="muted" style={{ fontSize: 13, margin: '2px 0 0' }}>Role: {p.role}</p>}
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <Button size="sm" variant="ghost" onClick={() => handleOpenEditProject(idx)}>
                        <StudentIcons.edit /> Edit
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => handleDeleteProject(idx)} style={{ color: '#ef4444' }}>
                        <StudentIcons.trash /> Delete
                      </Button>
                    </div>
                  </div>

                  <p style={{ fontSize: 14, margin: 0, color: 'var(--text-1)' }}>
                    {p.shortDescription || p.summary || p.detailedDescription}
                  </p>

                  {p.problemSolved && (
                    <p style={{ fontSize: 13, margin: 0, color: 'var(--text-2)' }}>
                      <strong>Problem Solved:</strong> {p.problemSolved}
                    </p>
                  )}
                  {p.metricsResults && (
                    <p style={{ fontSize: 13, margin: 0, color: 'var(--accent)' }}>
                      <strong>Metrics & Impact:</strong> {p.metricsResults}
                    </p>
                  )}

                  {/* Technologies tags */}
                  {((Array.isArray(p.technologies) && p.technologies.length > 0) || p.techStack) && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {(Array.isArray(p.technologies) && p.technologies.length > 0
                        ? p.technologies
                        : (p.techStack || '').split(',')
                      ).map((t, tidx) => (
                        <span key={tidx} className="badge" style={{ fontSize: 11.5 }}>
                          {String(t).trim()}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Links */}
                  <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 4 }}>
                    {(p.repoUrl || (p.link && p.link.includes('github'))) && (
                      <a href={p.repoUrl || p.link} target="_blank" rel="noreferrer" style={{ fontSize: 12.5, color: 'var(--accent)', textDecoration: 'none' }}>
                        Source Code ↗
                      </a>
                    )}
                    {p.liveUrl && (
                      <a href={p.liveUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12.5, color: 'var(--accent)', textDecoration: 'none' }}>
                        Live Demo ↗
                      </a>
                    )}
                    {p.docsUrl && (
                      <a href={p.docsUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12.5, color: 'var(--accent)', textDecoration: 'none' }}>
                        Documentation ↗
                      </a>
                    )}
                  </div>
                  {renderRecordFields('projects', p)}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* -------------------------------------------------------------
          MODULE 4: Skills
          ------------------------------------------------------------- */}
      {showModule('skills') && (
        <section className="glass" style={{ padding: 28, borderRadius: 20, display: 'grid', gap: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <h2 className="h-sub" style={{ fontSize: 20, margin: 0 }}>Academic & Technical Skills</h2>
              <p className="muted" style={{ fontSize: 13.5, margin: '2px 0 0' }}>
                Categorized skill inventory with proficiency levels and project evidence.
              </p>
            </div>
            <Button size="sm" variant="primary" icon={<Icon.plus />} onClick={handleOpenAddSkill}>
              + Add Skill
            </Button>
          </div>

          {skillsList.length === 0 ? (
            <EmptyState
              title="No Skills Added Yet"
              body="List programming languages, cloud systems, frameworks, and academic competencies."
              action={<Button size="sm" variant="primary" icon={<Icon.plus />} onClick={handleOpenAddSkill}>Add Skill</Button>}
            />
          ) : (
            <div style={{ display: 'grid', gap: 16 }}>
              {/* Group skills by category */}
              {Array.from(new Set(skillsList.map((s) => s.category || 'Other Skills'))).map((categoryName) => {
                const categorySkills = skillsList
                  .map((s, idx) => ({ ...s, originalIdx: idx }))
                  .filter((s) => (s.category || 'Other Skills') === categoryName);
                return (
                  <div key={categoryName} style={{ display: 'grid', gap: 10 }}>
                    <h4 style={{ fontSize: 15, margin: 0, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '.06em' }}>
                      {categoryName}
                    </h4>
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                      {categorySkills.map((sk) => (
                        <div
                          key={sk.id || sk.originalIdx}
                          className="glass"
                          style={{
                            padding: '8px 14px',
                            borderRadius: 14,
                            display: 'grid',
                            gap: 8,
                            border: '1px solid var(--line)',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <div>
                            <strong style={{ fontSize: 13.5, display: 'block' }}>{sk.name}</strong>
                            <span className="faint" style={{ fontSize: 11.5 }}>
                              {sk.proficiency || sk.level || 'Intermediate'} {sk.yearsExperience ? `• ${sk.yearsExperience}y` : ''}
                            </span>
                          </div>
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button
                              onClick={() => handleOpenEditSkill(sk.originalIdx)}
                              className="icon-btn"
                              style={{ width: 24, height: 24 }}
                              title="Edit skill"
                            >
                              <StudentIcons.edit width="12" height="12" />
                            </button>
                            <button
                              onClick={() => handleDeleteSkill(sk.originalIdx)}
                              className="icon-btn"
                              style={{ width: 24, height: 24, color: '#ef4444' }}
                              title="Delete skill"
                            >
                              <StudentIcons.trash width="12" height="12" />
                            </button>
                          </div>
                          </div>
                          {renderRecordFields('skills', sk)}
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* -------------------------------------------------------------
          MODULE 5: Credentials
          ------------------------------------------------------------- */}
      {showModule('credentials') && (
        <section className="glass" style={{ padding: 28, borderRadius: 20, display: 'grid', gap: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <h2 className="h-sub" style={{ fontSize: 20, margin: 0 }}>Academic Credentials & Certifications</h2>
              <p className="muted" style={{ fontSize: 13.5, margin: '2px 0 0' }}>
                Course completion certificates, professional licenses, and verified accreditations. A Credly badge link is checked by the certificate service.
              </p>
            </div>
            <Button size="sm" variant="primary" icon={<Icon.plus />} onClick={handleOpenAddCred}>
              + Add Credential
            </Button>
          </div>

          {credentialsList.length === 0 ? (
            <EmptyState
              title="No Credentials Logged Yet"
              body="Add Coursera, AWS, university registrar certificates, or formal licenses. Credly badge links can be verified."
              action={<Button size="sm" variant="primary" icon={<Icon.plus />} onClick={handleOpenAddCred}>Add Credential</Button>}
            />
          ) : (
            <div style={{ display: 'grid', gap: 14 }}>
              {credentialsList.map((crd, idx) => (
                <div key={crd.id || crd._id || idx} className="glass" style={{ padding: 20, borderRadius: 16, border: '1px solid var(--line)', display: 'grid', gap: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10 }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <h4 style={{ fontSize: 18, margin: 0 }}>{crd.title}</h4>
                        <span className="badge" style={{ textTransform: 'capitalize', fontSize: 11 }}>
                          {(crd.credentialType || 'certificate').replace('_', ' ')}
                        </span>
                        <span className={crd.verificationStatus === 'verified' ? 'badge badge-verified' : 'badge'} style={{ fontSize: 11 }}>
                          {credentialStatusLabel(crd.verificationStatus)}
                        </span>
                      </div>
                      <p className="muted" style={{ fontSize: 14, margin: '4px 0 0' }}>
                        Issued by <strong>{crd.issuer}</strong> {crd.issueDate ? `• ${crd.issueDate}` : ''}
                      </p>
                      {crd.credentialId && (
                        <span className="faint" style={{ fontSize: 12, display: 'block', marginTop: 4 }}>
                          ID: {crd.credentialId}
                        </span>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {canonicalCredlyBadgeUrl(crd.verificationUrl || crd.credentialUrl) && crd.verificationStatus !== 'verified' && (
                        <Button
                          size="sm"
                          variant="glass"
                          loading={verifyingCredId === String(crd.id || crd._id || idx)}
                          onClick={() => handleVerifyCredential(idx)}
                        >
                          Verify certificate
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => handleOpenEditCred(idx)}>
                        <StudentIcons.edit /> Edit
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => handleDeleteCred(idx)} style={{ color: '#ef4444' }}>
                        <StudentIcons.trash /> Delete
                      </Button>
                    </div>
                  </div>

                  {crd.description && <p style={{ fontSize: 13.5, margin: 0 }}>{crd.description}</p>}
                  {renderRecordFields('credentials', crd)}

                  <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 4 }}>
                    {crd.credentialUrl && (
                      <a href={crd.credentialUrl} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: 'var(--accent)', textDecoration: 'none' }}>
                        View Certificate ↗
                      </a>
                    )}
                    {crd.verificationUrl && (
                      <a href={crd.verificationUrl} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: 'var(--accent)', textDecoration: 'none' }}>
                        Verify with Issuer ↗
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* -------------------------------------------------------------
          MODULE 6: Achievements
          ------------------------------------------------------------- */}
      {showModule('achievements') && (
        <section className="glass" style={{ padding: 28, borderRadius: 20, display: 'grid', gap: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <h2 className="h-sub" style={{ fontSize: 20, margin: 0 }}>Honors, Hackathons & Competitions</h2>
              <p className="muted" style={{ fontSize: 13.5, margin: '2px 0 0' }}>
                Dean's List honors, hackathon placements, scholarships, and academic awards.
              </p>
            </div>
            <Button size="sm" variant="primary" icon={<Icon.plus />} onClick={handleOpenAddAch}>
              + Add Achievement
            </Button>
          </div>

          {achievementsList.length === 0 ? (
            <EmptyState
              title="No Achievements Logged Yet"
              body="Document hackathon prizes, Dean's List honors, Olympiad results, and scholarships."
              action={<Button size="sm" variant="primary" icon={<Icon.plus />} onClick={handleOpenAddAch}>Add Achievement</Button>}
            />
          ) : (
            <div style={{ display: 'grid', gap: 14 }}>
              {achievementsList.map((ach, idx) => (
                <div key={ach.id || ach._id || idx} className="glass" style={{ padding: 20, borderRadius: 16, border: '1px solid var(--line)', display: 'grid', gap: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10 }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <h4 style={{ fontSize: 18, margin: 0 }}>{ach.title}</h4>
                        <span className="badge" style={{ textTransform: 'capitalize', fontSize: 11 }}>{ach.category}</span>
                        {ach.positionRank && <span className="badge badge-verified" style={{ fontSize: 11 }}>{ach.positionRank}</span>}
                      </div>
                      <p className="muted" style={{ fontSize: 14, margin: '4px 0 0' }}>
                        {ach.organization ? `${ach.organization} • ` : ''}{ach.date || ach.year || ''}
                      </p>
                      {ach.awardPrize && (
                        <p style={{ fontSize: 13, margin: '4px 0 0', color: 'var(--accent)' }}>
                          <strong>Award:</strong> {ach.awardPrize}
                        </p>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <Button size="sm" variant="ghost" onClick={() => handleOpenEditAch(idx)}>
                        <StudentIcons.edit /> Edit
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => handleDeleteAch(idx)} style={{ color: '#ef4444' }}>
                        <StudentIcons.trash /> Delete
                      </Button>
                    </div>
                  </div>

                  {ach.description && <p style={{ fontSize: 13.5, margin: 0 }}>{ach.description}</p>}

                  {ach.proofUrl && (
                    <div>
                      <a href={ach.proofUrl} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: 'var(--accent)', textDecoration: 'none' }}>
                        Official Announcement / Proof ↗
                      </a>
                    </div>
                  )}
                  {renderRecordFields('achievements', ach)}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* -------------------------------------------------------------
          MODULE 7: Resume (ONE FILE ONLY)
          ------------------------------------------------------------- */}
      {showModule('resume') && (
        <section className="glass" style={{ padding: 28, borderRadius: 20, display: 'grid', gap: 20 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <h2 className="h-sub" style={{ fontSize: 20, margin: 0 }}>Academic Resume / CV</h2>
              <span className="badge badge-verified" style={{ fontSize: 11 }}>Exactly 1 Resume Slot</span>
            </div>
            <p className="muted" style={{ fontSize: 13.5, margin: '4px 0 0' }}>
              One resume slot. Choosing a PDF sends it to the resume extractor. Fields stay off your identity until you save the ones you want.
            </p>
          </div>

          {resumeData && resumeData.fileName ? (
            <div
              className="glass"
              style={{
                padding: 24,
                borderRadius: 18,
                border: '1.5px solid var(--accent)',
                display: 'grid',
                gap: 16,
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <div
                    style={{
                      width: 48,
                      height: 48,
                      borderRadius: 12,
                      background: 'color-mix(in oklab, var(--accent) 15%, transparent)',
                      color: 'var(--accent)',
                      display: 'grid',
                      placeItems: 'center',
                    }}
                  >
                    <StudentIcons.file width="24" height="24" />
                  </div>
                  <div>
                    <h3 style={{ fontSize: 17, margin: 0 }}>{resumeData.fileName}</h3>
                    <p className="muted" style={{ fontSize: 13, margin: '3px 0 0' }}>
                      Size: {Math.round((resumeData.fileSize || 0) / 1024)} KB • Target: {resumeData.targetRole || 'Software Engineer'}
                    </p>
                    <span className="faint" style={{ fontSize: 12 }}>
                      Uploaded: {resumeData.uploadedAt ? new Date(resumeData.uploadedAt).toLocaleDateString() : 'Active'}
                    </span>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 10 }}>
                  <Button
                    size="sm"
                    variant="glass"
                    loading={resumeUploading}
                    onClick={() => {
                      if (resumeFileRef.current) resumeFileRef.current.click();
                    }}
                  >
                    Replace Resume
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={handleRemoveResume}
                    style={{ color: '#ef4444' }}
                  >
                    Remove
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <div
              style={{
                border: '2px dashed var(--line)',
                borderRadius: 18,
                padding: 36,
                textAlign: 'center',
                display: 'grid',
                gap: 12,
                placeItems: 'center',
              }}
            >
              <div
                style={{
                  width: 56,
                  height: 56,
                  borderRadius: 16,
                  background: 'color-mix(in oklab, var(--accent) 12%, transparent)',
                  color: 'var(--accent)',
                  display: 'grid',
                  placeItems: 'center',
                }}
              >
                <StudentIcons.file width="28" height="28" />
              </div>
              <h3 style={{ fontSize: 18, margin: 0 }}>Upload Your Student Resume</h3>
              <p className="muted" style={{ fontSize: 13.5, margin: 0, maxWidth: 460 }}>
                Attach your PDF resume (max 10MB). The extractor reads it, then you choose which identity fields to keep.
              </p>
              <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
                <Button
                  variant="primary"
                  loading={resumeUploading}
                  onClick={() => {
                    if (resumeFileRef.current) resumeFileRef.current.click();
                  }}
                >
                  Choose PDF Resume
                </Button>
              </div>
            </div>
          )}

          {resumeUploading && (
            <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>Reading the PDF with the resume extractor…</p>
          )}

          {resumeCandidate && !resumeUploading && (
            <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>
              {resumeCandidate.fileName} is a candidate. The saved resume stays in place until you apply the changes.
            </p>
          )}

          {resumeReview && (
            <ResumeExtractionReview
              review={resumeReview}
              profile={studentProfile}
              selection={resumeSelection}
              onToggle={handleToggleResumeRow}
              onSelectApplicable={(checked) => {
                const next = {};
                if (checked) {
                  (resumeReview.rows || []).forEach((row) => {
                    const entryRows = (resumeReview.rows || []).filter((item) => item.section === row.section && item.entryIndex === row.entryIndex);
                    const kind = resumeChangeKind(resumeRowCurrentValue(studentProfile, row, entryRows), row.value);
                    if (resumeRowSelectable(row, entryRows) && kind !== 'unchanged') next[row.id] = true;
                  });
                }
                setResumeSelection(next);
              }}
              skillExtras={resumeSkillExtras}
              onSkillExtra={(entryIndex, extra) => setResumeSkillExtras((current) => ({ ...current, [entryIndex]: extra }))}
              issuerExtras={resumeIssuers}
              onIssuer={(entryIndex, issuer) => setResumeIssuers((current) => ({ ...current, [entryIndex]: issuer }))}
              applying={resumeApplying}
              onApply={handleApplyResume}
              onDiscard={handleDiscardResumeReview}
            />
          )}
        </section>
      )}

      {/* -------------------------------------------------------------
          MODULE 8: Media Gallery
          ------------------------------------------------------------- */}
      {showModule('media') && (
        <section className="glass" style={{ padding: 28, borderRadius: 20, display: 'grid', gap: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <h2 className="h-sub" style={{ fontSize: 20, margin: 0 }}>Visual Media & Presentations</h2>
              <p className="muted" style={{ fontSize: 13.5, margin: '2px 0 0' }}>
                Conference slides, paper preprints, lab images, and demo recordings.
              </p>
            </div>
            <Button size="sm" variant="primary" icon={<Icon.plus />} onClick={handleOpenAddMedia}>
              + Add Media Item
            </Button>
          </div>

          {mediaList.length === 0 ? (
            <EmptyState
              title="No Media Items Added Yet"
              body="Add diagrams, research poster links, slides, and recorded project demos."
              action={<Button size="sm" variant="primary" icon={<Icon.plus />} onClick={handleOpenAddMedia}>Add Media</Button>}
            />
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
              {mediaList.map((m, idx) => (
                <div key={m.id || m._id || idx} className="glass" style={{ padding: 18, borderRadius: 16, border: '1px solid var(--line)', display: 'grid', gap: 10 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div>
                      <h4 style={{ fontSize: 16, margin: 0 }}>{m.title}</h4>
                      <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                        <span className="badge" style={{ fontSize: 11, textTransform: 'capitalize' }}>{m.mediaType || 'Image'}</span>
                        <span className="badge" style={{ fontSize: 11, textTransform: 'capitalize' }}>{m.category || 'Project'}</span>
                        {m.isFeatured && <span className="badge badge-verified" style={{ fontSize: 10 }}>Featured</span>}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button onClick={() => handleOpenEditMedia(idx)} className="icon-btn" style={{ width: 26, height: 26 }}>
                        <StudentIcons.edit width="12" height="12" />
                      </button>
                      <button onClick={() => handleDeleteMedia(idx)} className="icon-btn" style={{ width: 26, height: 26, color: '#ef4444' }}>
                        <StudentIcons.trash width="12" height="12" />
                      </button>
                    </div>
                  </div>

                  {m.description && <p className="muted" style={{ fontSize: 13, margin: 0 }}>{m.description}</p>}

                  {m.mediaUrl && (
                    <a href={m.mediaUrl} target="_blank" rel="noreferrer" style={{ fontSize: 12.5, color: 'var(--accent)', textDecoration: 'none' }}>
                      Open Asset ↗
                    </a>
                  )}
                  {renderRecordFields('media', m)}
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* -------------------------------------------------------------
          MODULE 9: Links & Contacts
          ------------------------------------------------------------- */}
      {showModule('contacts') && (
        <section className="glass" style={{ padding: 28, borderRadius: 20, display: 'grid', gap: 24 }}>
          {/* Section 9A: Structured Platform Links */}
          <div style={{ display: 'grid', gap: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
              <div>
                <h2 className="h-sub" style={{ fontSize: 20, margin: 0 }}>Professional Platform Links</h2>
                <p className="muted" style={{ fontSize: 13.5, margin: '2px 0 0' }}>
                  Repeatable links to GitHub, LinkedIn, LeetCode, Google Scholar, and portfolios.
                </p>
              </div>
              <Button size="sm" variant="primary" icon={<Icon.plus />} onClick={handleOpenAddLink}>
                + Add Platform Link
              </Button>
            </div>

            {linksList.length === 0 ? (
              <EmptyState
                title="No Platform Links Added"
                body="Add your coding handles, research profiles, and portfolio websites."
                action={<Button size="sm" variant="primary" icon={<Icon.plus />} onClick={handleOpenAddLink}>Add Link</Button>}
              />
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 12 }}>
                {linksList.map((lnk, idx) => (
                  <div key={lnk.id || lnk._id || idx} className="glass" style={{ padding: 14, borderRadius: 14, border: '1px solid var(--line)', display: 'grid', gap: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <strong style={{ fontSize: 14 }}>{lnk.platform}</strong>
                        {lnk.isPrimary && <span className="badge badge-verified" style={{ fontSize: 10 }}>Primary</span>}
                      </div>
                      <a href={lnk.url} target="_blank" rel="noreferrer" style={{ fontSize: 12.5, color: 'var(--accent)', textDecoration: 'none', display: 'block', marginTop: 2, wordBreak: 'break-all' }}>
                        {lnk.url.replace(/^https?:\/\//, '')}
                      </a>
                    </div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button onClick={() => handleOpenEditLink(idx)} className="icon-btn" style={{ width: 28, height: 28 }}>
                        <StudentIcons.edit width="13" height="13" />
                      </button>
                      <button onClick={() => handleDeleteLink(idx)} className="icon-btn" style={{ width: 28, height: 28, color: '#ef4444' }}>
                        <StudentIcons.trash width="13" height="13" />
                      </button>
                    </div>
                    </div>
                    {renderRecordFields('links', lnk)}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div style={{ borderTop: '1px solid var(--line)', margin: '8px 0' }} />

          {/* Section 9B: Privacy-Protected Contact Information */}
          <div style={{ display: 'grid', gap: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
              <div>
                <h2 className="h-sub" style={{ fontSize: 20, margin: 0 }}>Academic Contact & Privacy Defaults</h2>
                <p className="muted" style={{ fontSize: 13.5, margin: '2px 0 0' }}>
                  Professional contact email and optional phone number. Private by default; separated from account authentication.
                </p>
              </div>
              <Button
                type="button"
                variant="primary"
                size="sm"
                loading={isSubmitting}
                onClick={handleSaveContacts}
              >
                Save Contacts
              </Button>
            </div>

            <form onSubmit={handleSaveContacts} style={{ display: 'grid', gap: 16, maxWidth: 640 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
                <Input
                  label="Professional Contact Email"
                  value={contactsState.email}
                  onChange={(e) => setContactsState({ ...contactsState, email: e.target.value })}
                  placeholder="name@university.edu"
                  hint="Independent from login credentials."
                />
                <Select
                  label="Email Visibility"
                  value={contactsState.visibility?.email || 'private'}
                  onChange={(e) =>
                    setContactsState({
                      ...contactsState,
                      visibility: { ...contactsState.visibility, email: e.target.value },
                    })
                  }
                  options={[
                    { value: 'private', label: 'Private (Hidden)' },
                    { value: 'recruiters', label: 'Recruiters Only' },
                    { value: 'public', label: 'Public on Profile' },
                  ]}
                />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '80px 2fr 1fr', gap: 12 }}>
                <Input
                  label="Code"
                  value={contactsState.countryCode}
                  onChange={(e) => setContactsState({ ...contactsState, countryCode: e.target.value })}
                  placeholder="+1"
                />
                <Input
                  label="Phone Number"
                  value={contactsState.phone}
                  onChange={(e) => setContactsState({ ...contactsState, phone: e.target.value })}
                  placeholder="(555) 000-0000"
                  hint="Kept private by default."
                />
                <Select
                  label="Phone Visibility"
                  value={contactsState.visibility?.phone || 'private'}
                  onChange={(e) =>
                    setContactsState({
                      ...contactsState,
                      visibility: { ...contactsState.visibility, phone: e.target.value },
                    })
                  }
                  options={[
                    { value: 'private', label: 'Private (Default)' },
                    { value: 'recruiters', label: 'Recruiters Only' },
                    { value: 'public', label: 'Public' },
                  ]}
                />
              </div>

              <Button type="submit" variant="primary" loading={isSubmitting} style={{ justifySelf: 'start', marginTop: 4 }}>
                Save Contacts & Privacy
              </Button>
            </form>
          </div>
        </section>
      )}

      {onboardingReady && onboardingStep !== "choice" && onboardingStep !== "extract" ? (
        <>

          <CustomSectionManager
            layout={customLayout}
            disabled={isSubmitting}
            templateId="magicui-portfolio"
            onChange={setCustomLayout}
            onSave={(next) => saveStudentCustomLayout(next, activeSection)}
          />
        </>
      ) : null}

      {/* =============================================================
          MODALS FOR EDITING INDIVIDUAL ITEMS
          ============================================================= */}

      {/* Education Modal */}
      <Modal open={eduModalOpen} onClose={() => setEduModalOpen(false)} title={editingEduIdx !== null ? "Edit Education" : "Add Education"}>
        <div style={{ display: 'grid', gap: 14 }}>
          <h3 className="h-card" style={{ fontSize: 22, margin: 0 }}>
            {editingEduIdx !== null ? "Edit Education Record" : "Add Education Record"}
          </h3>
          <Input label="School / University *" value={eduForm.institution} onChange={(e) => setEduForm({ ...eduForm, institution: e.target.value })} placeholder="e.g. Stanford University" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Input label="Degree / Qualification *" value={eduForm.degree} onChange={(e) => setEduForm({ ...eduForm, degree: e.target.value })} placeholder="e.g. B.S. Computer Science" />
            <Select
              label="Institution Type"
              value={eduForm.institutionType}
              onChange={(e) => setEduForm({ ...eduForm, institutionType: e.target.value })}
              options={[
                { value: 'university', label: 'University' },
                { value: 'school', label: 'School' },
                { value: 'junior_college', label: 'Junior / Prep College' },
                { value: 'diploma_college', label: 'Diploma College' },
                { value: 'training_institution', label: 'Training Institution' },
                { value: 'other', label: 'Other' },
              ]}
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Input label="Field of Study" value={eduForm.fieldOfStudy} onChange={(e) => setEduForm({ ...eduForm, fieldOfStudy: e.target.value })} placeholder="e.g. Artificial Intelligence" />
            <Select
              label="Current Status"
              value={eduForm.currentStatus}
              onChange={(e) => setEduForm({ ...eduForm, currentStatus: e.target.value })}
              options={[
                { value: 'studying', label: 'Currently Studying' },
                { value: 'completed', label: 'Completed' },
                { value: 'paused', label: 'Paused' },
                { value: 'withdrawn', label: 'Withdrawn' },
              ]}
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Input label="Start Date / Year" value={eduForm.startDate} onChange={(e) => setEduForm({ ...eduForm, startDate: e.target.value })} placeholder="e.g. 2022" />
            <Input label="End Date / Grad Year" value={eduForm.endDate} onChange={(e) => setEduForm({ ...eduForm, endDate: e.target.value })} placeholder="e.g. 2026" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Input label="GPA / CGPA" value={eduForm.gpa} onChange={(e) => setEduForm({ ...eduForm, gpa: e.target.value })} placeholder="e.g. 3.92" />
            <Input label="GPA Scale" value={eduForm.gpaScale} onChange={(e) => setEduForm({ ...eduForm, gpaScale: e.target.value })} placeholder="e.g. 4.0 or 10.0" />
          </div>
          <Input label="Institution Location" value={eduForm.location} onChange={(e) => setEduForm({ ...eduForm, location: e.target.value })} placeholder="City, Country" />
          <Input label="Roll Number (Private)" value={eduForm.rollNumber} onChange={(e) => setEduForm({ ...eduForm, rollNumber: e.target.value })} placeholder="Student ID / Roll Number" hint="Visible only to authorized recruiters and administrators." />
          <div className="field">
            <label className="field-label">Coursework</label>
            <input className="input" value={eduForm.coursework} onChange={(e) => setEduForm({ ...eduForm, coursework: e.target.value })} placeholder="Distributed Systems, Compilers, Machine Learning..." />
          </div>
          {window.RecordCustomFieldsEditor && (
            <RecordCustomFieldsEditor
              fields={eduForm.customFields || []}
              disabled={isSubmitting}
              onChange={(next) => setEduForm({ ...eduForm, customFields: next })}
            />
          )}
          <Button block variant="primary" loading={isSubmitting} onClick={handleSaveEduModal}>
            Save Education Record
          </Button>
        </div>
      </Modal>

      {/* Project Modal */}
      <Modal open={projModalOpen} onClose={() => setProjModalOpen(false)} title={editingProjIdx !== null ? "Edit Project" : "Add Project"}>
        <div style={{ display: 'grid', gap: 14 }}>
          <h3 className="h-card" style={{ fontSize: 22, margin: 0 }}>
            {editingProjIdx !== null ? "Edit Academic Project" : "Add Academic Project"}
          </h3>
          <Input label="Project Title *" value={projForm.title} onChange={(e) => setProjForm({ ...projForm, title: e.target.value })} placeholder="e.g. Distributed Consensus Engine" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Select
              label="Project Type"
              value={projForm.projectType}
              onChange={(e) => setProjForm({ ...projForm, projectType: e.target.value })}
              options={[
                { value: 'academic', label: 'Academic / Coursework' },
                { value: 'research', label: 'Research Publication' },
                { value: 'hackathon', label: 'Hackathon Project' },
                { value: 'open_source', label: 'Open Source' },
                { value: 'personal', label: 'Personal Project' },
                { value: 'internship', label: 'Internship Project' },
              ]}
            />
            <Input label="Your Role" value={projForm.role} onChange={(e) => setProjForm({ ...projForm, role: e.target.value })} placeholder="e.g. Lead Developer, Researcher" />
          </div>
          <Input label="Tech Stack (comma-separated)" value={projForm.techStack} onChange={(e) => setProjForm({ ...projForm, techStack: e.target.value })} placeholder="e.g. Python, PyTorch, Docker, React" />
          <div className="field">
            <label className="field-label">Short Summary</label>
            <EditorRichText label="Short description" value={projForm.shortDescription} onChange={(next) => setProjForm({ ...projForm, shortDescription: next })} placeholder="One or two sentences describing what you built..." />
          </div>
          <Input label="Metrics / Measurable Results" value={projForm.metricsResults} onChange={(e) => setProjForm({ ...projForm, metricsResults: e.target.value })} placeholder="e.g. 98.4% accuracy, sub-10ms latency" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <Input
                label="Source Repository URL (Optional)"
                value={projForm.repoUrl}
                onChange={(e) => setProjForm({ ...projForm, repoUrl: e.target.value })}
                placeholder="https://github.com/username/project"
              />
              <span className="field-hint" style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginTop: 3 }}>
                Leave empty if project has no public repo.
              </span>
            </div>
            <div>
              <Input
                label="Live Demo URL (Optional)"
                value={projForm.liveUrl}
                onChange={(e) => setProjForm({ ...projForm, liveUrl: e.target.value })}
                placeholder="https://yourdemo.com"
              />
              <span className="field-hint" style={{ fontSize: 11, color: 'var(--text-3)', display: 'block', marginTop: 3 }}>
                Leave empty if no live site.
              </span>
            </div>
          </div>
          {window.EditorAssetField ? (
            <EditorAssetField
              label="Project image"
              purpose="portfolio-image"
              value={projForm.assetId || ''}
              disabled={isSubmitting}
              onChange={(assetId) => setProjForm({ ...projForm, assetId })}
              hint="One image. This template does not show a gallery or an uploaded video. An https video link can stay in the video field."
            />
          ) : null}
          {window.RecordCustomFieldsEditor && (
            <RecordCustomFieldsEditor
              fields={projForm.customFields || []}
              disabled={isSubmitting}
              onChange={(next) => setProjForm({ ...projForm, customFields: next })}
            />
          )}
          <Button block variant="primary" loading={isSubmitting} onClick={handleSaveProjectModal}>
            Save Project Record
          </Button>
        </div>
      </Modal>

      {/* Skill Modal */}
      <Modal open={skillModalOpen} onClose={() => setSkillModalOpen(false)} title={editingSkillIdx !== null ? "Edit Skill" : "Add Skill"}>
        <div style={{ display: 'grid', gap: 14 }}>
          <h3 className="h-card" style={{ fontSize: 22, margin: 0 }}>
            {editingSkillIdx !== null ? "Edit Competency" : "Add Competency"}
          </h3>
          <Input label="Skill Name *" value={skillForm.name} onChange={(e) => setSkillForm({ ...skillForm, name: e.target.value })} placeholder="e.g. TypeScript, PyTorch, MongoDB" />
          <Select
            label="Category"
            value={skillForm.category}
            onChange={(e) => setSkillForm({ ...skillForm, category: e.target.value })}
            options={[
              { value: 'Programming Languages', label: 'Programming Languages' },
              { value: 'Frontend', label: 'Frontend' },
              { value: 'Backend', label: 'Backend' },
              { value: 'Databases', label: 'Databases' },
              { value: 'AI / ML', label: 'AI / ML' },
              { value: 'Cloud / DevOps', label: 'Cloud / DevOps' },
              { value: 'Tools', label: 'Tools' },
              { value: 'Other Skills', label: 'Other Skills' },
            ]}
          />
          <Select
            label="Proficiency Level"
            value={skillForm.proficiency}
            onChange={(e) => setSkillForm({ ...skillForm, proficiency: e.target.value })}
            options={[
              { value: 'Familiar', label: 'Familiar' },
              { value: 'Beginner', label: 'Beginner' },
              { value: 'Intermediate', label: 'Intermediate' },
              { value: 'Advanced', label: 'Advanced' },
              { value: 'Expert', label: 'Expert' },
            ]}
          />
          <Input label="Supporting Evidence" value={skillForm.evidence} onChange={(e) => setSkillForm({ ...skillForm, evidence: e.target.value })} placeholder="e.g. Built 3 production services; CS 224N course" />
          {window.RecordCustomFieldsEditor && (
            <RecordCustomFieldsEditor
              fields={skillForm.customFields || []}
              disabled={isSubmitting}
              onChange={(next) => setSkillForm({ ...skillForm, customFields: next })}
            />
          )}
          <Button block variant="primary" loading={isSubmitting} onClick={handleSaveSkillModal}>
            Save Skill Record
          </Button>
        </div>
      </Modal>

      {/* Credential Modal */}
      <Modal open={credModalOpen} onClose={() => setCredModalOpen(false)} title={editingCredIdx !== null ? "Edit Credential" : "Add Credential"}>
        <div style={{ display: 'grid', gap: 14 }}>
          <h3 className="h-card" style={{ fontSize: 22, margin: 0 }}>
            {editingCredIdx !== null ? "Edit Credential" : "Add Credential"}
          </h3>
          <Input label="Credential Title *" value={credForm.title} onChange={(e) => setCredForm({ ...credForm, title: e.target.value })} placeholder="e.g. Deep Learning Specialization" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Input label="Issuing Organization *" value={credForm.issuer} onChange={(e) => setCredForm({ ...credForm, issuer: e.target.value })} placeholder="e.g. Coursera / Stanford Online" />
            <Select
              label="Credential Type"
              value={credForm.credentialType}
              onChange={(e) => setCredForm({ ...credForm, credentialType: e.target.value })}
              options={[
                { value: 'course_certificate', label: 'Course Certificate' },
                { value: 'certification', label: 'Professional Certification' },
                { value: 'academic_certificate', label: 'Academic Certificate' },
                { value: 'license', label: 'Formal License' },
                { value: 'workshop', label: 'Workshop / Training' },
                { value: 'badge', label: 'Cryptographic Badge' },
              ]}
            />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Input label="Issue Date" value={credForm.issueDate} onChange={(e) => setCredForm({ ...credForm, issueDate: e.target.value })} placeholder="e.g. May 2025" />
            <Input label="Credential ID" value={credForm.credentialId} onChange={(e) => setCredForm({ ...credForm, credentialId: e.target.value })} placeholder="e.g. ABC-123456" />
          </div>
          <Input label="Verification URL" hint="A Credly badge link (https://www.credly.com/badges/...) is checked by the certificate service. Other links stay self-reported." value={credForm.verificationUrl} onChange={(e) => setCredForm({ ...credForm, verificationUrl: e.target.value })} placeholder="https://www.credly.com/badges/..." />
          {window.RecordCustomFieldsEditor && (
            <RecordCustomFieldsEditor
              fields={credForm.customFields || []}
              disabled={isSubmitting}
              onChange={(next) => setCredForm({ ...credForm, customFields: next })}
            />
          )}
          <Button block variant="primary" loading={isSubmitting} onClick={handleSaveCredModal}>
            Save Credential Record
          </Button>
        </div>
      </Modal>

      {/* Achievement Modal */}
      <Modal open={achModalOpen} onClose={() => setAchModalOpen(false)} title={editingAchIdx !== null ? "Edit Achievement" : "Add Achievement"}>
        <div style={{ display: 'grid', gap: 14 }}>
          <h3 className="h-card" style={{ fontSize: 22, margin: 0 }}>
            {editingAchIdx !== null ? "Edit Achievement" : "Add Achievement"}
          </h3>
          <Input label="Achievement Title *" value={achForm.title} onChange={(e) => setAchForm({ ...achForm, title: e.target.value })} placeholder="e.g. 1st Place Winner - HackMIT 2025" />
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Select
              label="Category"
              value={achForm.category}
              onChange={(e) => setAchForm({ ...achForm, category: e.target.value })}
              options={[
                { value: 'hackathon', label: 'Hackathon' },
                { value: 'competition', label: 'Competition' },
                { value: 'academic', label: 'Academic Honor / Dean’s List' },
                { value: 'research', label: 'Research Award' },
                { value: 'coding', label: 'Competitive Programming' },
                { value: 'leadership', label: 'Leadership / Service' },
                { value: 'award', label: 'Other Award' },
              ]}
            />
            <Input label="Organization / Event" value={achForm.organization} onChange={(e) => setAchForm({ ...achForm, organization: e.target.value })} placeholder="e.g. MIT / IEEE" />
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Input label="Position / Rank" value={achForm.positionRank} onChange={(e) => setAchForm({ ...achForm, positionRank: e.target.value })} placeholder="e.g. 1st Place, Dean's List" />
            <Input label="Date / Year" value={achForm.date} onChange={(e) => setAchForm({ ...achForm, date: e.target.value })} placeholder="e.g. October 2025" />
          </div>
          <Input label="Award / Prize Details" value={achForm.awardPrize} onChange={(e) => setAchForm({ ...achForm, awardPrize: e.target.value })} placeholder="e.g. $10,000 Grand Prize" />
          <Input label="Proof / Announcement URL" value={achForm.proofUrl} onChange={(e) => setAchForm({ ...achForm, proofUrl: e.target.value })} placeholder="https://..." />
          {window.RecordCustomFieldsEditor && (
            <RecordCustomFieldsEditor
              fields={achForm.customFields || []}
              disabled={isSubmitting}
              onChange={(next) => setAchForm({ ...achForm, customFields: next })}
            />
          )}
          <Button block variant="primary" loading={isSubmitting} onClick={handleSaveAchModal}>
            Save Achievement Record
          </Button>
        </div>
      </Modal>

      {/* Media Modal */}
      <Modal open={mediaModalOpen} onClose={() => setMediaModalOpen(false)} title={editingMediaIdx !== null ? "Edit Media" : "Add Media"}>
        <div style={{ display: 'grid', gap: 14 }}>
          <h3 className="h-card" style={{ fontSize: 22, margin: 0 }}>
            {editingMediaIdx !== null ? "Edit Media Asset" : "Add Media Asset"}
          </h3>
          <Input label="Asset Title *" value={mediaForm.title} onChange={(e) => setMediaForm({ ...mediaForm, title: e.target.value })} placeholder="e.g. Research Poster / Architecture Diagram" />
          <Input label="Media URL" value={mediaForm.mediaUrl} onChange={(e) => setMediaForm({ ...mediaForm, mediaUrl: e.target.value })} placeholder="https://..." hint="Optional when you upload a file. Use http or https." />
          {window.EditorAssetField ? (
            <EditorAssetField
              label="Uploaded file"
              purpose="portfolio-media"
              value={mediaForm.assetId || ''}
              disabled={isSubmitting}
              onChange={(assetId) => setMediaForm({ ...mediaForm, assetId })}
              hint="Images and PDFs are accepted. Galleries and video files are not shown by this template."
            />
          ) : null}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Select
              label="Media Type"
              value={mediaForm.mediaType}
              onChange={(e) => setMediaForm({ ...mediaForm, mediaType: e.target.value })}
              options={[
                { value: 'image', label: 'Image / Diagram' },
                { value: 'video', label: 'Video Demo' },
                { value: 'presentation', label: 'Slide Deck' },
                { value: 'pdf', label: 'PDF Document' },
              ]}
            />
            <Select
              label="Category"
              value={mediaForm.category}
              onChange={(e) => setMediaForm({ ...mediaForm, category: e.target.value })}
              options={[
                { value: 'project', label: 'Project Artifact' },
                { value: 'research', label: 'Research Paper / Poster' },
                { value: 'achievement', label: 'Award Photo' },
                { value: 'profile', label: 'Profile Media' },
              ]}
            />
          </div>
          <Input label="Description / Caption" value={mediaForm.description} onChange={(e) => setMediaForm({ ...mediaForm, description: e.target.value })} placeholder="Brief caption..." />
          {window.RecordCustomFieldsEditor && (
            <RecordCustomFieldsEditor
              fields={mediaForm.customFields || []}
              disabled={isSubmitting}
              onChange={(next) => setMediaForm({ ...mediaForm, customFields: next })}
            />
          )}
          <Button block variant="primary" loading={isSubmitting} onClick={handleSaveMediaModal}>
            Save Media Asset
          </Button>
        </div>
      </Modal>

      {/* Platform Link Modal */}
      <Modal open={linkModalOpen} onClose={() => setLinkModalOpen(false)} title={editingLinkIdx !== null ? "Edit Platform Link" : "Add Platform Link"}>
        <div style={{ display: 'grid', gap: 14 }}>
          <h3 className="h-card" style={{ fontSize: 22, margin: 0 }}>
            {editingLinkIdx !== null ? "Edit Platform Link" : "Add Platform Link"}
          </h3>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <Select
              label="Platform"
              value={linkForm.platform}
              onChange={(e) => setLinkForm({ ...linkForm, platform: e.target.value })}
              options={[
                { value: 'GitHub', label: 'GitHub' },
                { value: 'LinkedIn', label: 'LinkedIn' },
                { value: 'Twitter / X', label: 'Twitter / X' },
                { value: 'LeetCode', label: 'LeetCode' },
                { value: 'HackerRank', label: 'HackerRank' },
                { value: 'Codeforces', label: 'Codeforces' },
                { value: 'Kaggle', label: 'Kaggle' },
                { value: 'Google Scholar', label: 'Google Scholar' },
                { value: 'ORCID', label: 'ORCID' },
                { value: 'Portfolio', label: 'Portfolio Website' },
                { value: 'Medium / Blog', label: 'Medium / Blog' },
                { value: 'Other', label: 'Other' },
              ]}
            />
            <Select
              label="Category"
              value={linkForm.category}
              onChange={(e) => setLinkForm({ ...linkForm, category: e.target.value })}
              options={[
                { value: 'coding', label: 'Coding Platform' },
                { value: 'professional', label: 'Professional Profile' },
                { value: 'research', label: 'Academic / Research' },
                { value: 'social', label: 'Social & Publishing' },
              ]}
            />
          </div>
          <Input label="URL *" value={linkForm.url} onChange={(e) => setLinkForm({ ...linkForm, url: e.target.value })} placeholder="https://..." />
          <Input label="Username / Handle" value={linkForm.username} onChange={(e) => setLinkForm({ ...linkForm, username: e.target.value })} placeholder="e.g. jdoe_cs" />
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
            <input
              type="checkbox"
              id="isPrimaryLink"
              checked={linkForm.isPrimary}
              onChange={(e) => setLinkForm({ ...linkForm, isPrimary: e.target.checked })}
            />
            <label htmlFor="isPrimaryLink" style={{ fontSize: 13.5, cursor: 'pointer' }}>
              Highlight as primary link on visiting card and portfolio
            </label>
          </div>
          {window.RecordCustomFieldsEditor && (
            <RecordCustomFieldsEditor
              fields={linkForm.customFields || []}
              disabled={isSubmitting}
              onChange={(next) => setLinkForm({ ...linkForm, customFields: next })}
            />
          )}
          <Button block variant="primary" loading={isSubmitting} onClick={handleSaveLinkModal}>
            Save Platform Link
          </Button>
        </div>
      </Modal>
    </div>
  );
}

window.StudentIdentityPage = StudentIdentityPage;
