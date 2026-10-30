/* Seed data for mock mode. The landing demo profile lives here, not in components. */
(function () {
  const { db } = window.OV.core;
  const SEED_VERSION = 3;
  if (db.get('seed_version', 0) === SEED_VERSION) return;

  const demoProfile = {
    id: 'pf_demo', username: 'amara', userId: 'usr_demo',
    name: 'Amara Okafor', headline: 'Product designer & design-systems lead',
    location: 'Lisbon, Portugal', type: 'professional',
    avatarInitials: 'AO',
    summary: 'Eight years designing financial products used by four million people. I build design systems that let small teams ship like large ones.',
    experience: [
      { id: 'x1', role: 'Lead Product Designer', org: 'Fenwick Bank', period: '2022 — now', note: 'Led the rebuild of mobile onboarding; drop-off fell 31%.' },
      { id: 'x2', role: 'Senior Designer', org: 'Atlas Payments', period: '2019 — 2022', note: 'Created the Meridian design system across 14 product teams.' },
      { id: 'x3', role: 'Product Designer', org: 'Northwind Studio', period: '2017 — 2019', note: 'Shipped 20+ client launches across retail and travel.' },
    ],
    education: [
      { id: 'e1', degree: 'MA, Interaction Design', org: 'Royal College of Art', period: '2015 — 2017', note: 'Distinction. Thesis on trust signals in fintech.' },
      { id: 'e2', degree: 'BSc, Computer Science', org: 'University of Lagos', period: '2011 — 2015', note: 'First-class honours. Teaching assistant, HCI.' },
    ],
    skills: ['Design systems', 'Prototyping', 'User research', 'Figma', 'Accessibility', 'Front-end (React)'],
    portfolio: [
      { id: 'p1', title: 'Fenwick onboarding', kind: 'Case study', metric: '−31% drop-off' },
      { id: 'p2', title: 'Meridian design system', kind: 'System', metric: '14 teams' },
      { id: 'p3', title: 'Atlas merchant app', kind: 'Mobile', metric: '4.8★ rating' },
    ],
    services: [
      { id: 's1', name: 'Design-system audit', price: 'From €4,800', time: '2 weeks' },
      { id: 's2', name: 'Product design sprint', price: 'From €7,500', time: '3 weeks' },
    ],
    testimonials: [
      { id: 't1', quote: 'Amara turned a tangled product into something our customers actually enjoy.', by: 'Rui Matos, COO at Fenwick' },
    ],
    activities: [
      { id: 'a1', title: 'Mentor, ADPList', note: '120+ sessions with early-career designers' },
      { id: 'a2', title: 'Speaker, Config Lisbon 2025', note: '“Systems that scale down”' },
    ],
    availability: 'Open to senior roles & select freelance work',
    links: { email: 'amara@onevue.id', phone: '+351 912 000 418', web: 'amaraokafor.design' },
  };

  const credentials = [
    { id: 'cr1', profileId: 'pf_demo', title: 'MA, Interaction Design', issuer: 'Royal College of Art', kind: 'Degree', issued: '2017-07-01', status: 'verified', method: 'Registrar API' },
    { id: 'cr2', profileId: 'pf_demo', title: 'Lead Product Designer', issuer: 'Fenwick Bank', kind: 'Employment', issued: '2022-03-14', status: 'verified', method: 'Work email + HR' },
    { id: 'cr3', profileId: 'pf_demo', title: 'Certified Accessibility Professional', issuer: 'IAAP', kind: 'Certification', issued: '2024-11-20', status: 'verified', method: 'Issuer registry' },
    { id: 'cr4', profileId: 'pf_demo', title: 'Government ID', issuer: 'República Portuguesa', kind: 'Identity', issued: '2025-02-02', status: 'verified', method: 'Document + liveness' },
  ];

  const testimonials = [
    { id: 'q1', quote: 'I sent a recruiter view to six companies and a client view to two. Nobody saw what they didn’t need to. I had three offers in a month.', name: 'Daniel Reyes', role: 'Staff Engineer, Barcelona', initials: 'DR' },
    { id: 'q2', quote: 'Admissions asked for proof of everything. I sent one link with verified transcripts. It was the calmest application I have ever done.', name: 'Priya Natarajan', role: 'MSc candidate, Edinburgh', initials: 'PN' },
    { id: 'q3', quote: 'My studio page, my rates and my case studies finally live in one place I control. Clients book from the QR on my card.', name: 'Lena Hofmann', role: 'Brand designer, Berlin', initials: 'LH' },
  ];

  db.set('c:profiles', [demoProfile]);
  db.set('c:credentials', credentials);
  db.set('c:testimonials', testimonials);
  db.set('c:reserved_usernames', ['admin', 'onevue', 'support', 'help', 'api', 'www', 'jobs', 'about', 'pricing', 'login', 'amara', 'john', 'sarah', 'alex', 'maria', 'david', 'design', 'studio']);
  if (!db.get('c:users', null)) db.set('c:users', []);
  if (!db.get('c:claims', null)) db.set('c:claims', []);
  if (!db.get('c:shares', null)) db.set('c:shares', []);
  if (!db.get('c:events', null)) db.set('c:events', []);
  if (!db.get('c:notifications', null)) db.set('c:notifications', []);
  db.set('seed_version', SEED_VERSION);
})();
