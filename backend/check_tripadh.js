const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

const env = fs.readFileSync(path.join(__dirname, '.env.local'), 'utf8');
const uri = env.match(/MONGODB_URI="([^"]+)"/)[1];

async function run() {
  await mongoose.connect(uri);
  const UserWebsiteConfig = mongoose.model('UserWebsiteConfig', new mongoose.Schema({}, { strict: false }));
  const StudentProfile = mongoose.model('StudentProfile', new mongoose.Schema({}, { strict: false }));
  const PublishedProfileRevision = mongoose.model('PublishedProfileRevision', new mongoose.Schema({}, { strict: false }));

  const config = await UserWebsiteConfig.findOne({ username: 'tripadh' });
  console.log('CONFIG FOUND:', !!config);
  if (!config) return process.exit(0);

  console.log('ACTIVE REVISION ID:', config.activeRevisionId);

  const profile = await StudentProfile.findOne({ userId: config.userId });
  if (profile) {
    const obj = profile.toObject();
    console.log('PROFILE KEYS:', Object.keys(obj));
    console.log('PROFILE DATA SUMMARY:', {
      name: obj.name,
      headline: obj.headline,
      bio: obj.bio,
      educationCount: (obj.education || []).length,
      projectsCount: (obj.projects || []).length,
      skillsCount: (obj.skills || []).length,
      experienceCount: (obj.experience || []).length,
      achievementsCount: (obj.achievements || []).length,
      skillsSample: obj.skills,
      projectsSample: obj.projects
    });
  } else {
    console.log('NO PROFILE FOUND FOR USER');
  }

  const activeRev = await PublishedProfileRevision.findById(config.activeRevisionId);
  if (activeRev) {
    console.log('ACTIVE REV NUMBER:', activeRev.revisionNumber);
    console.log('ACTIVE REV DTO EDUCATION:', activeRev.dto?.education);
    console.log('ACTIVE REV DTO PROJECTS:', activeRev.dto?.projects);
    console.log('ACTIVE REV DTO SKILLS:', activeRev.dto?.skills);
  }

  process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
