/* Hooks and Router bindings */
const { useState: sUseState, useEffect: sUseEffect, useMemo: sUseMemo, useRef: sUseRef, useCallback: sUseCallback } = React;
const { useLocation: sUseLocation, useNavigate: sUseNavigate, Link: sLink } = ReactRouterDOM;
const StudentIcons = window.StudentIcons || {};

/* =========================================================================
   PAGE 2: Complete Student Identity Page (All 9 Modules)
   ========================================================================= */
function StudentIdentityPage({ session, studentProfile, profileError, onRetryProfile, onRefreshProfile, onSaveToDb, loadingProfile }) {
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
  const [projectsList, setProjectsList] = sUseState([]);
  const [skillsList, setSkillsList] = sUseState([]);
  const [credentialsList, setCredentialsList] = sUseState([]);
  const [certificateDecisions, setCertificateDecisions] = sUseState({});
  const [earnerEmails, setEarnerEmails] = sUseState({});
  const [certificateLoadingId, setCertificateLoadingId] = sUseState('');
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
  const [resumeRoleInput, setResumeRoleInput] = sUseState('');
  const [resumeReview, setResumeReview] = sUseState(null);
  const [resumeReviewEdits, setResumeReviewEdits] = sUseState({});
  const [resumeExtractError, setResumeExtractError] = sUseState('');
  const [resumeApplyError, setResumeApplyError] = sUseState('');
  const [resumeApplying, setResumeApplying] = sUseState(false);
  const resumeSkillCategories = ['Programming Languages', 'Frontend', 'Backend', 'Databases', 'AI / ML', 'Cloud / DevOps', 'Tools', 'Other Skills'];
  const resumeSkillProficiencies = ['Familiar', 'Beginner', 'Intermediate', 'Advanced', 'Expert'];
  const resumeFileRef = sUseRef(null);
  const resumeBusyRef = sUseRef(false);

  // Sync state when studentProfile is loaded
  sUseEffect(() => {
    if (studentProfile) {
      setPreferredName(studentProfile.preferredName || '');
      setProfilePhoto(studentProfile.profilePhoto || '');
      setHeadline(studentProfile.headline || '');
      setBio(studentProfile.bio || '');
      setNationality(studentProfile.nationality || '');
      setCountry(studentProfile.country || '');
      setStateRegion(studentProfile.state || '');
      setCity(studentProfile.city || '');
      setCurrentStatus(studentProfile.currentStatus || 'student');
      setCareerInterests(Array.isArray(studentProfile.careerInterests) ? studentProfile.careerInterests : []);
      setAreasOfInterest(Array.isArray(studentProfile.areasOfInterest) ? studentProfile.areasOfInterest : []);
      setLanguages(Array.isArray(studentProfile.languages) ? studentProfile.languages : []);

      if (Array.isArray(studentProfile.education)) {
        setEducationList(studentProfile.education);
      }
      if (Array.isArray(studentProfile.projects)) {
        setProjectsList(studentProfile.projects);
      }
      if (Array.isArray(studentProfile.skills)) {
        setSkillsList(studentProfile.skills);
      }
      if (Array.isArray(studentProfile.credentials)) {
        setCredentialsList(studentProfile.credentials);
      }
      if (Array.isArray(studentProfile.achievements)) {
        setAchievementsList(studentProfile.achievements);
      }
      if (Array.isArray(studentProfile.media)) {
        setMediaList(studentProfile.media);
      }
      if (Array.isArray(studentProfile.links)) {
        setLinksList(studentProfile.links);
      }

      if (studentProfile.resume) {
        setResumeData(studentProfile.resume);
        setResumeRoleInput(studentProfile.resume.targetRole || '');
      } else if (studentProfile.resumeFileName) {
        setResumeData({
          fileName: studentProfile.resumeFileName,
          fileSize: 180000,
          uploadedAt: studentProfile.resumeLastUpdated,
          contentType: 'application/pdf',
        });
      }

      if (studentProfile.contacts) {
        setContactsState({
          email: studentProfile.contacts.email || '',
          phone: studentProfile.contacts.phone || '',
          countryCode: studentProfile.contacts.countryCode || '',
          city: studentProfile.contacts.city || '',
          state: studentProfile.contacts.state || '',
          country: studentProfile.contacts.country || '',
          visibility: studentProfile.contacts.visibility || { email: 'private', phone: 'private' },
          github: studentProfile.contacts.github || '',
          linkedin: studentProfile.contacts.linkedin || '',
          twitter: studentProfile.contacts.twitter || '',
          portfolio: studentProfile.contacts.portfolio || '',
        });
      }
    }
  }, [studentProfile]);

  const certificateIds = credentialsList
    .map((item) => item.certificateVerificationId)
    .filter(Boolean)
    .join(',');

  sUseEffect(() => {
    if (!certificateIds) return undefined;
    let cancelled = false;
    const ids = certificateIds.split(',');
    setCertificateLoadingId(ids[0] || '');
    (async () => {
      const next = {};
      for (const id of ids) {
        try {
          const body = await window.OV.services.credentials.getCertificate(id);
          next[id] = body.certificate;
        } catch (error) {
          next[id] = { error: error.message || 'Could not load verification status.' };
        }
      }
      if (!cancelled) {
        setCertificateDecisions((current) => ({ ...current, ...next }));
        setCertificateLoadingId('');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [certificateIds]);

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
    const payload = { ...credForm, relatedSkills: skillsArr, verificationStatus: 'self-reported' };
    let updatedList;
    if (editingCredIdx !== null) {
      updatedList = credentialsList.map((item, idx) =>
        idx === editingCredIdx ? { ...item, ...payload } : item
      );
    } else {
      updatedList = [...credentialsList, { id: 'crd_' + Date.now(), ...payload }];
    }
    const saved = await onSaveToDb({ credentials: updatedList });
    if (!saved) {
      setIsSubmitting(false);
      return;
    }
    let nextList = window.OV.services.credentials.credentialsFromSave(updatedList, saved);
    const verificationUrl = credForm.verificationUrl.trim();
    toast.push({
      title: 'Credential saved',
      body: verificationUrl
        ? 'Verification URL saved. Open Edit to see it again after a reload.'
        : 'Credential record saved.',
      tone: 'success',
    });
    const preparedUrl = verificationUrl
      ? window.OV.services.credentials.classifyCertificateUrl(verificationUrl)
      : null;
    if (preparedUrl && !preparedUrl.ok) {
      toast.push({
        title: 'Automatic verification not submitted',
        body: preparedUrl.message,
        tone: 'info',
      });
    } else if (preparedUrl && preparedUrl.ok) {
      try {
        const result = await window.OV.services.credentials.submitCertificate(preparedUrl.url);
        const certificate = result && result.certificate;
        if (!certificate || !certificate.id || !certificate.status) {
          throw new Error('Certificate verification returned an unexpected response.');
        }
        nextList = nextList.map((item) => (
          String(item.verificationUrl || '').trim() === verificationUrl
            ? { ...item, certificateVerificationId: certificate.id }
            : item
        ));
        setCertificateDecisions((current) => ({ ...current, [certificate.id]: certificate }));
        toast.push({
          title: result.created ? 'Certificate submitted' : 'Certificate already submitted',
          body: 'Verification status: ' + certificate.status,
          tone: 'success',
        });
      } catch (error) {
        toast.push({
          title: 'Certificate not submitted',
          body: error.message || 'Certificate verification is unavailable.',
          tone: 'error',
        });
      }
    }
    setCredentialsList(nextList);
    setIsSubmitting(false);
    setCredModalOpen(false);
  };

  const handleVerifyCertificate = async (credential, idx) => {
    if (certificateLoadingId) return;
    const prepared = window.OV.services.credentials.prepareCertificateSubmission(credential);
    if (!prepared.ok) {
      toast.push({
        title: prepared.title,
        body: prepared.message,
        tone: 'error',
      });
      return;
    }
    const url = prepared.url;
    const cardKey = String(credential.certificateVerificationId || credential.id || credential._id || idx);
    setCertificateLoadingId(cardKey);
    try {
      let id = String(credential.certificateVerificationId || '').trim();
      if (!id) {
        if (prepared.source === 'credentialUrl') {
          const withUrl = credentialsList.map((item, itemIdx) => (
            itemIdx === idx ? { ...item, verificationUrl: url } : item
          ));
          const saved = await onSaveToDb({ credentials: withUrl });
          if (!saved) return;
          setCredentialsList(withUrl);
        }
        const submitted = await window.OV.services.credentials.submitCertificate(url);
        const created = submitted && submitted.certificate;
        if (!created || !created.id) {
          throw new Error('Certificate verification returned an unexpected response.');
        }
        id = created.id;
      }
      setCredentialsList((current) => current.map((item, itemIdx) => (
        itemIdx === idx
          ? { ...item, certificateVerificationId: id, verificationUrl: item.verificationUrl || url }
          : item
      )));
      const earnerEmail = String(earnerEmails[cardKey] || '').trim();
      const result = await window.OV.services.credentials.verifyCertificate(id, earnerEmail);
      const certificate = result && result.certificate;
      if (!certificate || !certificate.status) {
        throw new Error('Certificate verification returned an unexpected response.');
      }
      const display = window.OV.services.credentials.displayCertificateStatus(certificate);
      setCertificateDecisions((current) => ({ ...current, [id]: certificate }));
      if (typeof onRefreshProfile === 'function') {
        await onRefreshProfile();
      }
      toast.push({
        title: display.verified ? 'Credential verified' : 'Credential not verified',
        body: display.label + '. ' + display.detail,
        tone: display.verified ? 'success' : 'info',
      });
    } catch (error) {
      const failedId = String(credential.certificateVerificationId || '');
      if (failedId) {
        setCertificateDecisions((current) => ({
          ...current,
          [failedId]: { ...(current[failedId] || {}), error: error.message || 'Certificate verification is unavailable.' },
        }));
      }
      toast.push({
        title: 'Verification unavailable',
        body: error.message || 'Certificate verification is unavailable.',
        tone: 'error',
      });
    } finally {
      setCertificateLoadingId('');
    }
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
    e.target.value = '';
    if (!file || resumeBusyRef.current) return;

    if (file.size === 0) {
      setResumeExtractError('The uploaded PDF file is empty.');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setResumeExtractError('The PDF exceeds the 10 MB limit.');
      return;
    }

    resumeBusyRef.current = true;
    setResumeUploading(true);
    setResumeExtractError('');
    try {
      const review = await window.OV.services.credentials.extractResume(file);
      setResumeReview(review);
      setResumeReviewEdits({});
      setResumeApplyError('');
      toast.push({
        title: 'Resume ready for review',
        body: 'Nothing has been written to your profile.',
        tone: 'info',
      });
    } catch (error) {
      const detail = error && error.message ? error.message : 'Resume extraction failed.';
      const retryNote = /not retried automatically|Choose the PDF again/i.test(detail)
        ? ''
        : ' Choose the PDF again if you want to retry. It was not retried automatically.';
      setResumeExtractError(detail + retryNote);
    } finally {
      resumeBusyRef.current = false;
      setResumeUploading(false);
    }
  };

  const handleApplyResumeReview = async () => {
    if (resumeBusyRef.current) return;
    if (!resumeReview || !Array.isArray(resumeReview.sections)) return;
    const rows = resumeReview.sections.flatMap((section) => section.rows);
    const selected = rows.filter((row) => {
      const state = reviewRowState(row);
      return state.selected && (row.applicable || row.section === 'skills');
    });
    if (selected.length === 0) {
      setResumeApplyError('Select at least one field the profile can store.');
      return;
    }
    const groups = new Map();
    selected.forEach((row) => {
      const key = row.section + ':' + row.entryIndex;
      if (!groups.has(key)) {
        groups.set(key, { section: row.section, index: row.entryIndex, fields: [] });
      }
      const group = groups.get(key);
      group.fields.push(row.field);
      const edit = resumeReviewEdits[row.id] || {};
      if (row.section === 'skills') {
        group.category = edit.category;
        group.proficiency = edit.proficiency;
      }
      if (row.section === 'credentials') {
        group.issuer = (resumeReviewEdits['issuer:' + row.entryIndex] || {}).issuer;
      }
    });
    for (const group of groups.values()) {
      if (group.section === 'skills' && (!group.category || !group.proficiency)) {
        setResumeApplyError('Choose a category and proficiency for each selected skill.');
        return;
      }
      if (group.section === 'credentials' && (!group.issuer || !String(group.issuer).trim())) {
        setResumeApplyError('Enter an issuer for each selected credential. It stays self-reported.');
        return;
      }
      if (group.section === 'education' && (!group.fields.includes('institution') || !group.fields.includes('degree'))) {
        setResumeApplyError('Select both the institution and the degree for an education entry.');
        return;
      }
      if (group.section === 'socialLinks' && (!group.fields.includes('platform') || !group.fields.includes('url'))) {
        setResumeApplyError('Select both the platform and the URL for a social link.');
        return;
      }
    }
    resumeBusyRef.current = true;
    setResumeApplying(true);
    setResumeApplyError('');
    let applied = false;
    try {
      await window.OV.services.credentials.applyResumeReview({
        reviewId: resumeReview.reviewId,
        selections: [...groups.values()].map((group) => {
          const item = { section: group.section, index: group.index, fields: group.fields };
          if (group.category) item.category = group.category;
          if (group.proficiency) item.proficiency = group.proficiency;
          if (group.issuer) item.issuer = String(group.issuer).trim();
          return item;
        }),
      });
      applied = true;
      setResumeReview(null);
      setResumeReviewEdits({});
    } catch (error) {
      const code = error && typeof error.code === 'string' ? error.code : '';
      if (code === 'http_404') {
        setResumeReview(null);
        setResumeReviewEdits({});
        setResumeApplyError(error.message || 'This review expired or is no longer available. Choose the PDF again to start a new extraction.');
      } else if (!code) {
        setResumeApplyError('The apply request did not finish, so it was not submitted again. Your selections are still here.');
      } else if (code === 'http_409') {
        setResumeApplyError(error.message || 'The profile changed after this review. Your selections are still here.');
      } else {
        setResumeApplyError((error && error.message) || 'The resume review could not be applied. Your selections are still here.');
      }
    } finally {
      resumeBusyRef.current = false;
      setResumeApplying(false);
    }
    if (!applied) return;
    try {
      if (onRefreshProfile) await onRefreshProfile();
      toast.push({
        title: 'Profile updated',
        body: 'Selected resume fields were added. Credentials remain self-reported.',
        tone: 'success',
      });
    } catch {
      toast.push({
        title: 'Profile updated',
        body: 'The selected fields were saved. Refresh the page if the profile does not show them yet.',
        tone: 'info',
      });
    }
  };

  const handleDiscardResumeReview = async () => {
    if (resumeBusyRef.current) return;
    const reviewId = resumeReview && resumeReview.reviewId;
    if (!reviewId) {
      setResumeReview(null);
      setResumeReviewEdits({});
      return;
    }
    try {
      await window.OV.services.credentials.discardResumeReview(reviewId);
      setResumeReview(null);
      setResumeReviewEdits({});
      setResumeExtractError('');
      setResumeApplyError('');
    } catch (error) {
      setResumeApplyError((error && error.message) || 'The review could not be closed. Your selections are still here.');
    }
  };

  const reviewRowState = (row) => {
    const edit = resumeReviewEdits[row.id] || {};
    return {
      selected: edit.selected !== undefined ? edit.selected : Boolean(row.applicable),
      value: row.value,
    };
  };

  const updateReviewRow = (row, patch) => {
    setResumeReviewEdits((current) => {
      const edit = current[row.id] || {};
      return { ...current, [row.id]: { ...edit, ...patch } };
    });
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
      mediaType: 'image',
      category: 'project',
      description: '',
      altText: '',
      isFeatured: false,
    });
    setMediaModalOpen(true);
  };

  const handleOpenEditMedia = (idx) => {
    setEditingMediaIdx(idx);
    const item = mediaList[idx];
    setMediaForm({
      title: item.title || '',
      mediaUrl: item.mediaUrl || item.url || '',
      mediaType: item.mediaType || 'image',
      category: item.category || 'project',
      description: item.description || '',
      altText: item.altText || '',
      isFeatured: Boolean(item.isFeatured),
    });
    setMediaModalOpen(true);
  };

  const handleSaveMediaModal = async () => {
    if (!mediaForm.title.trim() || !mediaForm.mediaUrl.trim()) {
      toast.push({ title: 'Validation Error', body: 'Title and Media URL are required.', tone: 'error' });
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

  return (
    <div style={{ display: 'grid', gap: 24 }}>
      {profileError && (
        <EmptyState
          title="Student profile unavailable"
          body={profileError}
          action={<Button size="sm" variant="primary" onClick={() => onRetryProfile && onRetryProfile()}>Load profile</Button>}
        />
      )}
      {loadingProfile && !studentProfile && !profileError && (
        <p className="muted" style={{ margin: 0 }}>Loading your student profile…</p>
      )}

      {/* Page Header */}
      <div>
        <span className="eyebrow" style={{ color: 'var(--accent)', fontSize: 12 }}>Domain Architecture</span>
        <h1 className="h-card" style={{ fontSize: 32, margin: '4px 0 6px' }}>Student Identity</h1>
        <p className="muted" style={{ fontSize: 15, margin: 0 }}>
          Manage all nine verified profile sections that shape your admissions, internship, and research views.
        </p>
      </div>

      {/* 9 Section Tabs */}
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
        {sectionsList.map((sec) => {
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

      {/* -------------------------------------------------------------
          MODULE 1: Personal Profile
          ------------------------------------------------------------- */}
      {activeSection === 'profile' && (
        <section className="glass" style={{ padding: 28, borderRadius: 20, display: 'grid', gap: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <h2 className="h-sub" style={{ fontSize: 20, margin: 0 }}>Personal Profile</h2>
              <p className="muted" style={{ fontSize: 14, margin: '4px 0 0' }}>
                Basic student identity, bio, location, and career focus.
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

            <div className="field">
              <label className="field-label">Academic Bio</label>
              <textarea
                className="input"
                rows={4}
                style={{ height: 'auto', padding: 14 }}
                value={bio}
                onChange={(e) => setBio(e.target.value)}
                placeholder="Write a brief overview of your academic focus and research interests..."
              />
            </div>

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
      {activeSection === 'education' && (
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
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* -------------------------------------------------------------
          MODULE 3: Projects
          ------------------------------------------------------------- */}
      {activeSection === 'projects' && (
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
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* -------------------------------------------------------------
          MODULE 4: Skills
          ------------------------------------------------------------- */}
      {activeSection === 'skills' && (
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
                            display: 'flex',
                            alignItems: 'center',
                            gap: 10,
                            border: '1px solid var(--line)',
                          }}
                        >
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
      {activeSection === 'credentials' && (
        <section className="glass" style={{ padding: 28, borderRadius: 20, display: 'grid', gap: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
            <div>
              <h2 className="h-sub" style={{ fontSize: 20, margin: 0 }}>Academic Credentials & Certifications</h2>
              <p className="muted" style={{ fontSize: 13.5, margin: '2px 0 0' }}>
                Course completion certificates, professional licenses, and verified accreditations.
              </p>
            </div>
            <Button size="sm" variant="primary" icon={<Icon.plus />} onClick={handleOpenAddCred}>
              + Add Credential
            </Button>
          </div>

          {credentialsList.length === 0 ? (
            <EmptyState
              title="No Credentials Logged Yet"
              body="Add Coursera, AWS, university registrar certificates, or formal licenses."
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
                        {(() => {
                          const decision = certificateDecisions[crd.certificateVerificationId];
                          const display = decision && decision.status && window.OV.services.credentials.displayCertificateStatus
                            ? window.OV.services.credentials.displayCertificateStatus(decision)
                            : null;
                          const verified = display ? display.verified : crd.verificationStatus === 'verified';
                          const label = display ? display.label : (crd.verificationStatus || 'Self-reported');
                          return (
                            <span className={verified ? 'badge badge-verified' : 'badge'} style={{ fontSize: 11 }}>
                              {label}
                            </span>
                          );
                        })()}
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
                      <input
                        type="email"
                        autoComplete="off"
                        aria-label="Earner email"
                        placeholder="Earner email (optional)"
                        value={earnerEmails[String(crd.certificateVerificationId || crd.id || crd._id || idx)] || ''}
                        onChange={(event) => {
                          const key = String(crd.certificateVerificationId || crd.id || crd._id || idx);
                          const value = event.target.value;
                          setEarnerEmails((current) => ({ ...current, [key]: value }));
                        }}
                        style={{ fontSize: 13, padding: '6px 8px', borderRadius: 8, border: '1px solid var(--line)', minWidth: 180 }}
                      />
                      <Button
                        size="sm"
                        variant="primary"
                        loading={certificateLoadingId === String(crd.certificateVerificationId || crd.id || crd._id || idx)}
                        disabled={Boolean(certificateLoadingId)}
                        onClick={() => handleVerifyCertificate(crd, idx)}
                      >
                        Verify Certificate
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => handleOpenEditCred(idx)}>
                        <StudentIcons.edit /> Edit
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => handleDeleteCred(idx)} style={{ color: '#ef4444' }}>
                        <StudentIcons.trash /> Delete
                      </Button>
                    </div>
                  </div>

                  {crd.description && <p style={{ fontSize: 13.5, margin: 0 }}>{crd.description}</p>}
                  {certificateDecisions[crd.certificateVerificationId] && certificateDecisions[crd.certificateVerificationId].error && (
                    <p style={{ fontSize: 13, margin: 0, color: '#ef4444' }}>
                      {certificateDecisions[crd.certificateVerificationId].error}
                    </p>
                  )}
                  {certificateDecisions[crd.certificateVerificationId] && certificateDecisions[crd.certificateVerificationId].status && (
                    <p className="muted" style={{ fontSize: 13, margin: 0 }}>
                      {window.OV.services.credentials.displayCertificateStatus(certificateDecisions[crd.certificateVerificationId]).detail}
                    </p>
                  )}

                  <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginTop: 4 }}>
                    {crd.credentialUrl && (
                      <a href={crd.credentialUrl} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: 'var(--accent)', textDecoration: 'none' }}>
                        View Certificate ↗
                      </a>
                    )}
                    {crd.verificationUrl && (
                      <div style={{ display: 'grid', gap: 2, minWidth: 0 }}>
                        <a href={crd.verificationUrl} target="_blank" rel="noreferrer" style={{ fontSize: 13, color: 'var(--accent)', textDecoration: 'none' }}>
                          Verify with Issuer ↗
                        </a>
                        <span className="faint" style={{ fontSize: 12, wordBreak: 'break-all' }}>{crd.verificationUrl}</span>
                      </div>
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
      {activeSection === 'achievements' && (
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
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* -------------------------------------------------------------
          MODULE 7: Resume (ONE FILE ONLY)
          ------------------------------------------------------------- */}
      {activeSection === 'resume' && (
        <section className="glass" style={{ padding: 28, borderRadius: 20, display: 'grid', gap: 20 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <h2 className="h-sub" style={{ fontSize: 20, margin: 0 }}>Academic Resume / CV</h2>
              <span className="badge badge-verified" style={{ fontSize: 11 }}>Exactly 1 Resume Slot</span>
            </div>
            <p className="muted" style={{ fontSize: 13.5, margin: '4px 0 0' }}>
              Choose a text-based PDF to extract fields for review. The file is not stored, and nothing is written to the profile.
            </p>
          </div>

          <input
            type="file"
            accept="application/pdf"
            ref={resumeFileRef}
            style={{ display: 'none' }}
            disabled={resumeUploading || resumeApplying}
            onChange={handleResumeFileSelect}
          />

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
                    disabled={resumeUploading || resumeApplying}
                    onClick={() => {
                      if (resumeUploading || resumeApplying || !resumeFileRef.current) return;
                      resumeFileRef.current.click();
                    }}
                  >
                    {resumeUploading ? 'Extracting resume…' : 'Replace PDF'}
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
                Choose a text-based PDF (max 10 MB). OneVue extracts it for review and does not save the file or change your profile.
              </p>
              <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
                <Button
                  variant="primary"
                  loading={resumeUploading}
                  disabled={resumeApplying}
                  onClick={() => {
                    if (resumeUploading || resumeApplying || !resumeFileRef.current) return;
                    resumeFileRef.current.click();
                  }}
                >
                  {resumeUploading ? 'Extracting resume…' : 'Choose PDF Resume'}
                </Button>
              </div>
            </div>
          )}

          {resumeExtractError || resumeApplyError ? (
            <div style={{ display: 'grid', gap: 8 }}>
              {resumeExtractError ? (
                <p style={{ color: '#ef4444', fontSize: 13.5, margin: 0 }}>{resumeExtractError}</p>
              ) : null}
              {resumeApplyError ? (
                <p style={{ color: '#ef4444', fontSize: 13.5, margin: 0 }}>{resumeApplyError}</p>
              ) : null}
              {!resumeReview ? (
                <div>
                  <Button
                    size="sm"
                    variant="glass"
                    loading={resumeUploading}
                    disabled={resumeApplying}
                    onClick={() => {
                      if (resumeUploading || resumeApplying || !resumeFileRef.current) return;
                      resumeFileRef.current.click();
                    }}
                  >
                    Choose the PDF again
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}

          {resumeReview && Array.isArray(resumeReview.sections) ? (
            <div className="glass" style={{ padding: 20, borderRadius: 16, display: 'grid', gap: 16, border: '1px solid var(--line)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <h3 style={{ fontSize: 16, margin: 0 }}>Review extracted fields</h3>
                  <p className="muted" style={{ fontSize: 13, margin: '4px 0 0' }}>{resumeReview.warning}</p>
                  <p className="faint" style={{ fontSize: 12, margin: '4px 0 0' }}>
                    Extracted values are read-only. Choose the fields to add. You can still set a skill category, a proficiency, and a credential issuer. Resume credentials stay self-reported.
                  </p>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Button size="sm" variant="primary" loading={resumeApplying} disabled={resumeUploading} onClick={handleApplyResumeReview}>Add selected to profile</Button>
                  <Button size="sm" variant="ghost" disabled={resumeApplying || resumeUploading} onClick={handleDiscardResumeReview}>Discard review</Button>
                </div>
              </div>
              {resumeReview.sections.map((section) => (
                <div key={section.id} style={{ display: 'grid', gap: 10 }}>
                  <h4 style={{ fontSize: 14, margin: 0 }}>{section.label}</h4>
                  {section.rows.map((row) => {
                    const state = reviewRowState(row);
                    return (
                      <div key={row.id} style={{ display: 'grid', gap: 6, padding: 12, borderRadius: 12, border: '1px solid var(--line)' }}>
                        <span style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                          <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                            <input
                              type="checkbox"
                              checked={state.selected && (row.applicable || row.section === 'skills')}
                              disabled={!row.applicable && row.section !== 'skills'}
                              onChange={(event) => updateReviewRow(row, { selected: event.target.checked })}
                            />
                            <strong style={{ fontSize: 13 }}>{row.field}</strong>
                          </label>
                          <span className="faint" style={{ fontSize: 12 }}>
                            {row.applicable ? `Can map to ${row.profileField}` : 'Review only'}
                            {row.confidence ? ` · ${row.confidence} confidence` : ''}
                            {row.groundingStatus ? ` · ${row.groundingStatus}` : ''}
                          </span>
                        </span>
                        <input
                          value={state.value}
                          readOnly
                          aria-readonly="true"
                          aria-label={`${row.field} extracted value, read-only`}
                          style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--line)', background: 'color-mix(in oklab, var(--line) 35%, transparent)', color: 'inherit' }}
                        />
                        <span className="faint" style={{ fontSize: 12 }}>Read-only extracted value</span>
                        {row.section === 'skills' ? (
                          <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            <select
                              value={(resumeReviewEdits[row.id] || {}).category || ''}
                              onChange={(event) => updateReviewRow(row, { category: event.target.value })}
                              style={{ padding: '6px 8px', borderRadius: 8, border: '1px solid var(--line)', background: 'transparent', color: 'inherit' }}
                            >
                              <option value="">Category</option>
                              {resumeSkillCategories.map((category) => <option key={category} value={category}>{category}</option>)}
                            </select>
                            <select
                              value={(resumeReviewEdits[row.id] || {}).proficiency || ''}
                              onChange={(event) => updateReviewRow(row, { proficiency: event.target.value })}
                              style={{ padding: '6px 8px', borderRadius: 8, border: '1px solid var(--line)', background: 'transparent', color: 'inherit' }}
                            >
                              <option value="">Proficiency</option>
                              {resumeSkillProficiencies.map((level) => <option key={level} value={level}>{level}</option>)}
                            </select>
                          </span>
                        ) : null}
                        {row.section === 'credentials' && row.field === 'title' ? (
                          <input
                            value={(resumeReviewEdits['issuer:' + row.entryIndex] || {}).issuer || ''}
                            placeholder="Issuer (required, stays self-reported)"
                            onChange={(event) => setResumeReviewEdits((current) => ({
                              ...current,
                              ['issuer:' + row.entryIndex]: { issuer: event.target.value },
                            }))}
                            style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid var(--line)', background: 'transparent', color: 'inherit' }}
                          />
                        ) : null}
                        {row.evidence ? <span className="faint" style={{ fontSize: 12 }}>Evidence: {row.evidence}</span> : null}
                        {row.note ? <span className="muted" style={{ fontSize: 12 }}>{row.note}</span> : null}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          ) : null}
        </section>
      )}

      {/* -------------------------------------------------------------
          MODULE 8: Media Gallery
          ------------------------------------------------------------- */}
      {activeSection === 'media' && (
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
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* -------------------------------------------------------------
          MODULE 9: Links & Contacts
          ------------------------------------------------------------- */}
      {activeSection === 'contacts' && (
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
                  <div key={lnk.id || lnk._id || idx} className="glass" style={{ padding: 14, borderRadius: 14, border: '1px solid var(--line)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
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
            <textarea className="input" rows={2} style={{ height: 'auto', padding: 10 }} value={projForm.shortDescription} onChange={(e) => setProjForm({ ...projForm, shortDescription: e.target.value })} placeholder="One or two sentences describing what you built..." />
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
          <Input label="Verification URL" value={credForm.verificationUrl} onChange={(e) => setCredForm({ ...credForm, verificationUrl: e.target.value })} placeholder="https://www.credly.com/badges/..." />
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
          <Input label="Media URL *" value={mediaForm.mediaUrl} onChange={(e) => setMediaForm({ ...mediaForm, mediaUrl: e.target.value })} placeholder="https://..." />
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
          <Button block variant="primary" loading={isSubmitting} onClick={handleSaveLinkModal}>
            Save Platform Link
          </Button>
        </div>
      </Modal>
    </div>
  );
}

window.StudentIdentityPage = StudentIdentityPage;
