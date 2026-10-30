/* Hooks and Router bindings */
const { useState: sUseState, useEffect: sUseEffect, useMemo: sUseMemo, useRef: sUseRef, useCallback: sUseCallback } = React;
const { useLocation: sUseLocation, useNavigate: sUseNavigate, Link: sLink } = ReactRouterDOM;
const StudentIcons = window.StudentIcons || {};
const getPrimaryEducation = window.getPrimaryEducation || (() => null);


/* =========================================================================
   PAGE 1: Student Overview Page (Reads from Canonical Primary Education)
   ========================================================================= */
function StudentOverviewPage({ session, studentProfile, onNavigateSection }) {
  const toast = useToast();
  const publicUrl = session?.user?.username ? `onevue.id/${session.user.username}` : 'onevue.id/student.demo';
  const collegeViewUrl = session?.user?.username ? `/#/${session.user.username}/college` : '/#/amara/college';

  const primaryEdu = getPrimaryEducation(studentProfile);

  const storageKey = `ov_chk_${session?.user?.id || 'anon'}_student`;
  const [checkedItems, setCheckedItems] = sUseState(() => {
    try {
      const s = localStorage.getItem(storageKey);
      return s ? JSON.parse(s) : {};
    } catch {
      return {};
    }
  });

  const checklist = [
    { id: 'edu', label: 'Add university or college credentials' },
    { id: 'proj', label: 'Highlight capstone or coursework projects' },
    { id: 'skills', label: 'List academic competencies & tools' },
    { id: 'card', label: 'Configure digital visiting card' },
    { id: 'pub', label: 'Publish and share verified College view' },
  ];

  const toggleCheck = (id) => {
    setCheckedItems((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch (_) {}
      return next;
    });
  };

  const progressPercent = Math.round(
    (checklist.filter((c) => checkedItems[c.id]).length / checklist.length) * 100
  );

  return (
    <div style={{ display: 'grid', gap: 28 }}>
      <section className="glass" style={{ padding: '28px 32px', borderRadius: 24, display: 'grid', gap: 16 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 16 }}>
          <div>
            <span className="eyebrow" style={{ color: 'var(--accent)', fontSize: 12 }}>Academic Overview</span>
            <h1 className="h-card" style={{ fontSize: 32, margin: '6px 0 4px' }}>
              Welcome, {session?.user?.name || 'Student'}
            </h1>
            <p className="muted" style={{ fontSize: 15, margin: 0, maxWidth: 600 }}>
              Your academic records, coursework, and admissions portfolio in one verified place.
            </p>
          </div>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Button
              size="sm"
              variant="glass"
              icon={<StudentIcons.share />}
              onClick={async () => {
                await copyText('https://' + publicUrl);
                toast.push({ title: 'Link copied', body: publicUrl, tone: 'success' });
              }}
            >
              Share Portfolio
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => onNavigateSection('/app/student/identity')}
            >
              Edit Identity
            </Button>
          </div>
        </div>
      </section>

      {/* Snapshot Cards reading canonical education */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 18 }}>
        <div className="glass" style={{ padding: 20, borderRadius: 18 }}>
          <span className="faint" style={{ fontSize: 12, textTransform: 'uppercase' }}>Academic Identity</span>
          <h3 style={{ fontSize: 20, margin: '6px 0 2px' }}>{primaryEdu?.institution || 'Not specified yet'}</h3>
          <p className="muted" style={{ fontSize: 13, margin: 0 }}>{primaryEdu?.degree || 'Set up your education'}</p>
        </div>
        <div className="glass" style={{ padding: 20, borderRadius: 18 }}>
          <span className="faint" style={{ fontSize: 12, textTransform: 'uppercase' }}>Primary Template</span>
          <h3 style={{ fontSize: 20, margin: '6px 0 2px' }}>College / Intern View</h3>
          <p className="muted" style={{ fontSize: 13, margin: 0 }}>Admissions-ready profile layout</p>
        </div>
        <div className="glass" style={{ padding: 20, borderRadius: 18 }}>
          <span className="faint" style={{ fontSize: 12, textTransform: 'uppercase' }}>Cumulative GPA</span>
          <h3 style={{ fontSize: 20, margin: '6px 0 2px' }}>{primaryEdu?.gpa || 'Not added yet'}</h3>
          <p className="muted" style={{ fontSize: 13, margin: 0 }}>{primaryEdu?.gradYear ? `Class of ${primaryEdu.gradYear}` : 'Add graduation year'}</p>
        </div>
      </div>
    </div>
  );
}
window.StudentOverviewPage = StudentOverviewPage;
