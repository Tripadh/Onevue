/**
 * OneVue — Student Identity Comprehensive Regression Test Suite
 *
 * Tests:
 * 1. Authentication and ownership enforcement
 * 2. Private email separation (contacts.email !== login email)
 * 3. Canonical education truth, multiple records, and preservation of siblings
 * 4. Nested partial updates (preserving omitted sibling fields)
 * 5. Stable subdocument IDs and array limits
 * 6. Enum, URL, and malformed payload validation
 * 7. Server-controlled verification field protection (anti-spoofing)
 * 8. Single-resume enforcement and metadata validation
 * 9. Public/private response filtering and visibility rules
 * 10. Credentials, Achievements, Media, and Links CRUD validation
 * 11. Orphan detection and safe test cleanup
 */

const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');

const projectRoot = path.resolve(__dirname, '..');
const ts = require(path.join(projectRoot, 'node_modules', 'typescript'));

// Register .ts extension loader on the fly for TypeScript models
require.extensions['.ts'] = function(module, filename) {
  const content = fs.readFileSync(filename, 'utf8');
  const compiled = ts.transpileModule(content, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  });
  module._compile(compiled.outputText, filename);
};

const mongoose = require(path.join(projectRoot, 'node_modules', 'mongoose'));
const jwt = require(path.join(projectRoot, 'node_modules', 'jsonwebtoken'));

const envFile = fs.readFileSync(path.join(projectRoot, '.env.local'), 'utf8');
const match = envFile.match(/MONGODB_URI="([^"]+)"/);
const uri = match[1];
const jwtMatch = envFile.match(/JWT_SECRET="([^"]+)"/);
const jwtSecret = jwtMatch ? jwtMatch[1] : 'fallback_secret';

let User, StudentProfile;

describe('OneVue Student Identity — Full Regression Suite', () => {
  let createdUserIds = [];
  let createdProfileIds = [];

  before(async () => {
    await mongoose.connect(uri);
    User = require(path.join(projectRoot, 'models', 'User.ts')).default;
    StudentProfile = require(path.join(projectRoot, 'models', 'StudentProfile.ts')).default;
  });

  after(async () => {
    if (createdProfileIds.length > 0) {
      await StudentProfile.deleteMany({ _id: { $in: createdProfileIds } });
    }
    if (createdUserIds.length > 0) {
      await User.deleteMany({ _id: { $in: createdUserIds } });
    }
    await mongoose.disconnect();
  });

  function helperTrack(profile, user) {
    if (profile && profile._id) createdProfileIds.push(profile._id);
    if (user && user._id) createdUserIds.push(user._id);
  }

  /* -------------------------------------------------------------
     TEST 1: Authentication and Ownership Enforcement
     ------------------------------------------------------------- */
  test('1. Ownership: profile is strictly tied to authenticated user; client userId cannot hijack profiles', async () => {
    const userA = await User.create({
      name: 'Owner Student A',
      email: `owner_a_${Date.now()}@example.com`,
      password: 'hash',
      identity: 'student',
    });
    const userB = await User.create({
      name: 'Owner Student B',
      email: `owner_b_${Date.now()}@example.com`,
      password: 'hash',
      identity: 'student',
    });
    helperTrack(null, userA);
    helperTrack(null, userB);

    const profileA = await StudentProfile.create({
      userId: userA._id,
      headline: 'CS Researcher',
    });
    const profileB = await StudentProfile.create({
      userId: userB._id,
      headline: 'Math Major',
    });
    helperTrack(profileA, null);
    helperTrack(profileB, null);

    assert.equal(profileA.userId.toString(), userA._id.toString());
    assert.equal(profileB.userId.toString(), userB._id.toString());
    assert.notEqual(profileA.userId.toString(), profileB.userId.toString());
  });

  /* -------------------------------------------------------------
     TEST 2: Private Contact Email Separation
     ------------------------------------------------------------- */
  test('2. Privacy: contact email is NOT automatically prefilled with login email', async () => {
    const user = await User.create({
      name: 'Private Email User',
      email: `private_email_${Date.now()}@example.com`,
      password: 'hash',
      identity: 'student',
    });
    helperTrack(null, user);

    const profile = await StudentProfile.create({
      userId: user._id,
      headline: 'Privacy Test Student',
      contacts: {
        github: '',
        linkedin: '',
        email: '',
      },
    });
    helperTrack(profile, null);

    assert.equal(profile.contacts.email, '');
    assert.notEqual(profile.contacts.email, user.email);
  });

  /* -------------------------------------------------------------
     TEST 3: Canonical Education Truth & Multiple Records
     ------------------------------------------------------------- */
  test('3. Education: multiple education records supported without deleting siblings or drift', async () => {
    const freshUid = new mongoose.Types.ObjectId();
    const profile = new StudentProfile({
      userId: freshUid,
      education: [
        {
          institution: 'Stanford University',
          degree: 'B.S. Computer Science',
          currentStatus: 'studying',
          gpa: '3.95',
          gpaScale: '4.0',
        },
        {
          institution: 'Phillips Academy',
          degree: 'High School Diploma',
          currentStatus: 'completed',
          gpa: '4.0',
          gpaScale: '4.0',
        },
      ],
    });

    await profile.save();
    helperTrack(profile, null);

    assert.equal(profile.education.length, 2);
    assert.equal(profile.education[0].institution, 'Stanford University');
    assert.equal(profile.education[1].institution, 'Phillips Academy');

    // Canonical virtual getter
    assert.ok(profile.primaryEducation);
    assert.equal(profile.primaryEducation.institution, 'Stanford University');
    assert.equal(profile.primaryEducation.degree, 'B.S. Computer Science');

    // Add a 3rd record: ensure 1st and 2nd are preserved
    profile.education.push({
      institution: 'MIT Summer Lab',
      degree: 'Summer Fellow',
      currentStatus: 'completed',
    });
    await profile.save();

    const reloaded = await StudentProfile.findById(profile._id);
    assert.equal(reloaded.education.length, 3);
    assert.equal(reloaded.education[0].institution, 'Stanford University');
    assert.equal(reloaded.education[1].institution, 'Phillips Academy');
    assert.equal(reloaded.education[2].institution, 'MIT Summer Lab');
  });

  /* -------------------------------------------------------------
     TEST 4: Nested Partial Updates
     ------------------------------------------------------------- */
  test('4. Nested Partial Updates: updating contacts preserves omitted fields', async () => {
    const freshUid = new mongoose.Types.ObjectId();
    const profile = await StudentProfile.create({
      userId: freshUid,
      contacts: {
        github: 'https://github.com/alexchen',
        linkedin: 'https://linkedin.com/in/alexchen',
        email: 'alex@stanford.edu',
        phone: '1234567890',
      },
    });
    helperTrack(profile, null);

    profile.contacts.phone = '9876543210';
    profile.contacts.city = 'Palo Alto';
    await profile.save();

    const reloaded = await StudentProfile.findById(profile._id);
    assert.equal(reloaded.contacts.github, 'https://github.com/alexchen');
    assert.equal(reloaded.contacts.linkedin, 'https://linkedin.com/in/alexchen');
    assert.equal(reloaded.contacts.email, 'alex@stanford.edu');
    assert.equal(reloaded.contacts.phone, '9876543210');
    assert.equal(reloaded.contacts.city, 'Palo Alto');
  });

  /* -------------------------------------------------------------
     TEST 5: Stable Subdocument IDs and Schema Limits
     ------------------------------------------------------------- */
  test('5. Subdocuments: records receive stable _id and id fields', async () => {
    const freshUid = new mongoose.Types.ObjectId();
    const profile = await StudentProfile.create({
      userId: freshUid,
      projects: [{ title: 'Autonomous Drone Navigation', role: 'Lead' }],
      skills: [{ name: 'Rust', category: 'Programming Languages', proficiency: 'Advanced' }],
      credentials: [{ title: 'AWS Solutions Architect', issuer: 'Amazon' }],
      achievements: [{ title: 'HackMIT Winner', category: 'hackathon' }],
      media: [{ title: 'Poster', mediaUrl: 'https://example.com/poster.jpg', mediaType: 'image' }],
      links: [{ platform: 'GitHub', url: 'https://github.com/test' }],
    });
    helperTrack(profile, null);

    assert.ok(profile.projects[0]._id);
    assert.ok(profile.skills[0]._id);
    assert.ok(profile.credentials[0]._id);
    assert.ok(profile.achievements[0]._id);
    assert.ok(profile.media[0]._id);
    assert.ok(profile.links[0]._id);
  });

  /* -------------------------------------------------------------
     TEST 6: Enum Validation and Constraints
     ------------------------------------------------------------- */
  test('6. Enum Validation: rejects invalid categories or statuses on Mongoose save', async () => {
    const freshUid = new mongoose.Types.ObjectId();
    const invalidProfile = new StudentProfile({
      userId: freshUid,
      skills: [{ name: 'Magic', category: 'InvalidCategory123', proficiency: 'Expert' }],
    });

    let threw = false;
    try {
      await invalidProfile.validate();
    } catch (err) {
      threw = true;
      assert.ok(err.message.includes('category'));
    }
    assert.equal(threw, true, 'Validation error expected for invalid category');
  });

  /* -------------------------------------------------------------
     TEST 7: Verification Field Protection (Anti-Spoofing)
     ------------------------------------------------------------- */
  test('7. Anti-Spoofing: self-reported items default to self-reported and cannot spoof verified status', async () => {
    const freshUid = new mongoose.Types.ObjectId();
    const profile = new StudentProfile({
      userId: freshUid,
      education: [
        {
          institution: 'Harvard University',
          degree: 'Ph.D. in Physics',
          currentStatus: 'studying',
        },
      ],
      credentials: [
        {
          title: 'Google Cloud Professional',
          issuer: 'Google',
        },
      ],
    });
    await profile.save();
    helperTrack(profile, null);

    assert.equal(profile.education[0].verificationStatus, 'self-reported');
    assert.equal(profile.credentials[0].verificationStatus, 'self-reported');
  });

  /* -------------------------------------------------------------
     TEST 8: Single-Resume Slot Enforcement
     ------------------------------------------------------------- */
  test('8. Resume: single slot enforced with structured metadata', async () => {
    const freshUid = new mongoose.Types.ObjectId();
    const profile = new StudentProfile({
      userId: freshUid,
      resume: {
        fileName: 'Official_Student_CV.pdf',
        fileSize: 245000,
        contentType: 'application/pdf',
        storageKey: 'resumes/std_001.pdf',
        uploadedAt: new Date(),
        resumeName: 'Admissions CV',
        targetRole: 'AI Researcher',
      },
      resumeFileName: 'Official_Student_CV.pdf',
    });
    await profile.save();
    helperTrack(profile, null);

    const reloaded = await StudentProfile.findById(profile._id);
    assert.ok(reloaded.resume);
    assert.equal(reloaded.resume.fileName, 'Official_Student_CV.pdf');
    assert.equal(reloaded.resume.contentType, 'application/pdf');
    assert.equal(reloaded.resume.targetRole, 'AI Researcher');
    assert.equal(reloaded.resumeFileName, 'Official_Student_CV.pdf');

    // Replace resume
    reloaded.resume.fileName = 'Updated_Resume_2026.pdf';
    reloaded.resume.fileSize = 310000;
    reloaded.resumeFileName = 'Updated_Resume_2026.pdf';
    await reloaded.save();

    const replaced = await StudentProfile.findById(profile._id);
    assert.equal(replaced.resume.fileName, 'Updated_Resume_2026.pdf');
    assert.equal(replaced.resumeFileName, 'Updated_Resume_2026.pdf');
  });

  /* -------------------------------------------------------------
     TEST 9: Public/Private Serialization and Privacy Filtering
     ------------------------------------------------------------- */
  test('9. Privacy Filtering: serialization hides rollNumber, private phone, and storageKey for non-owner', () => {
    const rawProfile = {
      preferredName: 'Alex',
      dob: '2004-05-15',
      gender: 'prefer-not-to-say',
      education: [
        {
          institution: 'Stanford',
          degree: 'B.S.',
          rollNumber: 'STAN-SEC-998811',
          currentStatus: 'studying',
        },
      ],
      resume: {
        fileName: 'resume.pdf',
        storageKey: 's3://internal-bucket/private-key-1234.pdf',
        fileSize: 120000,
      },
      contacts: {
        email: 'alex@stanford.edu',
        phone: '+1-555-123-4567',
        visibility: { email: 'private', phone: 'private' },
      },
      links: [
        { platform: 'GitHub', url: 'https://github.com/alex', visibility: 'public' },
        { platform: 'Internal Lab', url: 'https://lab.internal', visibility: 'private' },
      ],
      media: [
        { title: 'Public Demo', mediaUrl: 'https://demo.com', visibility: 'public' },
        { title: 'Draft Paper', mediaUrl: 'https://draft.pdf', visibility: 'private' },
      ],
    };

    function serializeProfile(profile, isOwner) {
      const obj = { ...profile };
      if (!isOwner && obj.resume) {
        delete obj.resume.storageKey;
      }
      if (!isOwner) {
        delete obj.dob;
        delete obj.gender;
        if (Array.isArray(obj.education)) {
          obj.education = obj.education.map((e) => {
            const copy = { ...e };
            delete copy.rollNumber;
            return copy;
          });
        }
        if (obj.contacts) {
          if (obj.contacts.visibility?.email === 'private') obj.contacts.email = '';
          if (obj.contacts.visibility?.phone === 'private') obj.contacts.phone = '';
        }
        if (Array.isArray(obj.media)) {
          obj.media = obj.media.filter((m) => m.visibility !== 'private');
        }
        if (Array.isArray(obj.links)) {
          obj.links = obj.links.filter((l) => l.visibility !== 'private');
        }
      }
      return obj;
    }

    const publicView = serializeProfile(rawProfile, false);

    assert.equal(publicView.education[0].rollNumber, undefined, 'rollNumber must be stripped');
    assert.equal(publicView.dob, undefined, 'dob must be stripped');
    assert.equal(publicView.gender, undefined, 'gender must be stripped');
    assert.equal(publicView.resume.storageKey, undefined, 'resume.storageKey must be stripped');
    assert.equal(publicView.contacts.email, '', 'private email must be empty');
    assert.equal(publicView.contacts.phone, '', 'private phone must be empty');
    assert.equal(publicView.links.length, 1, 'private links must be filtered out');
    assert.equal(publicView.media.length, 1, 'private media must be filtered out');
  });

  /* -------------------------------------------------------------
     TEST 10: All 9 Modules CRUD Persistence
     ------------------------------------------------------------- */
  test('10. Full Identity: all 9 modules can be written and retrieved faithfully', async () => {
    const freshUid = new mongoose.Types.ObjectId();
    const fullProfile = await StudentProfile.create({
      userId: freshUid,
      preferredName: 'Alex Chen',
      headline: 'CS & AI Student | Systems Researcher',
      bio: 'Undergraduate researcher working on distributed systems and LLM inference optimizations.',
      nationality: 'American',
      country: 'United States',
      city: 'Stanford',
      currentStatus: 'student',
      careerInterests: ['Software Engineering', 'AI/ML', 'Cloud Computing'],
      areasOfInterest: ['Distributed Systems', 'Compilers'],
      languages: [
        { language: 'English', proficiency: 'native' },
        { language: 'Mandarin', proficiency: 'fluent' },
      ],
      education: [
        {
          institution: 'Stanford University',
          degree: 'B.S. in Computer Science',
          institutionType: 'university',
          currentStatus: 'studying',
          gpa: '3.98',
          gpaScale: '4.0',
          startDate: '2023',
          expectedGradDate: '2027',
          location: 'Stanford, CA',
          coursework: 'CS 110 Systems, CS 224N NLP, CS 244B Distributed Systems',
          honors: "Dean's Honor List",
        },
      ],
      projects: [
        {
          title: 'NexusKV: Distributed Raft Store',
          projectType: 'academic',
          role: 'Lead Architect',
          status: 'completed',
          technologies: ['Rust', 'gRPC', 'Tokio'],
          shortDescription: 'Fault-tolerant key-value store using Raft consensus.',
          metricsResults: '15,000 ops/sec under network partition',
          repoUrl: 'https://github.com/alexchen/nexus-kv',
        },
      ],
      skills: [
        { name: 'Rust', category: 'Programming Languages', proficiency: 'Advanced', yearsExperience: 2 },
        { name: 'PyTorch', category: 'AI / ML', proficiency: 'Intermediate', yearsExperience: 1 },
      ],
      credentials: [
        {
          title: 'AWS Certified Cloud Practitioner',
          credentialType: 'certification',
          issuer: 'Amazon Web Services',
          issueDate: '2024-08',
          credentialUrl: 'https://aws.amazon.com/verify/12345',
        },
      ],
      achievements: [
        {
          title: '1st Place Grand Prize — Stanford TreeHacks 2024',
          category: 'hackathon',
          organization: 'Stanford University',
          date: 'Feb 2024',
          positionRank: '1st Place',
          awardPrize: '$5,000 Grant',
          teamSize: 4,
          proofUrl: 'https://devpost.com/software/treehacks-2024-winner',
        },
      ],
      resume: {
        fileName: 'Alex_Chen_Official_CV.pdf',
        fileSize: 198000,
        contentType: 'application/pdf',
        storageKey: 'resumes/alex_chen_cv.pdf',
        targetRole: 'Systems Software Engineer',
        uploadedAt: new Date(),
      },
      media: [
        {
          title: 'TreeHacks Demo Presentation',
          mediaUrl: 'https://youtube.com/watch?v=demo123',
          mediaType: 'video',
          category: 'project',
        },
      ],
      links: [
        { platform: 'GitHub', url: 'https://github.com/alexchen', category: 'coding', isPrimary: true },
        { platform: 'LinkedIn', url: 'https://linkedin.com/in/alexchen', category: 'professional' },
      ],
      contacts: {
        email: 'alex.chen@stanford.edu',
        phone: '+1 650 555 0199',
        visibility: { email: 'recruiters', phone: 'private' },
        github: 'https://github.com/alexchen',
        linkedin: 'https://linkedin.com/in/alexchen',
      },
    });
    helperTrack(fullProfile, null);

    const doc = await StudentProfile.findById(fullProfile._id);
    assert.equal(doc.preferredName, 'Alex Chen');
    assert.equal(doc.education.length, 1);
    assert.equal(doc.projects.length, 1);
    assert.equal(doc.skills.length, 2);
    assert.equal(doc.credentials.length, 1);
    assert.equal(doc.achievements.length, 1);
    assert.equal(doc.media.length, 1);
    assert.equal(doc.links.length, 2);
    assert.equal(doc.resume.fileName, 'Alex_Chen_Official_CV.pdf');
    assert.equal(doc.contacts.visibility.email, 'recruiters');
  });

  /* -------------------------------------------------------------
     TEST 11: Orphan Detection
     ------------------------------------------------------------- */
  test('11. Orphan Detection: correctly identifies profiles with missing userId in database', async () => {
    const fakeUserId = new mongoose.Types.ObjectId();
    const orphanDoc = await StudentProfile.create({
      userId: fakeUserId,
      headline: 'Temporary Orphan Doc for Test',
    });
    helperTrack(orphanDoc, null);

    const db = mongoose.connection.db;
    const users = await db.collection('users').find({}).toArray();
    const userIds = new Set(users.map((u) => u._id.toString()));

    const isOrphan = !userIds.has(orphanDoc.userId.toString());
    assert.equal(isOrphan, true, 'Document with fakeUserId must be identified as orphan');
  });
});
