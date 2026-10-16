/**
 * OneVue Student Identity — Database Integrity Check & Migration Utility
 * 
 * Usage:
 *   node backend/scripts/integrity_and_migration.js --check
 *   node backend/scripts/integrity_and_migration.js --dry-run
 *   node backend/scripts/integrity_and_migration.js --apply --confirm
 */

const path = require('path');
const fs = require('fs');

const projectRoot = path.resolve(__dirname, '..');
const mongoose = require(path.join(projectRoot, 'node_modules', 'mongoose'));

const envFile = fs.readFileSync(path.join(projectRoot, '.env.local'), 'utf8');
const match = envFile.match(/MONGODB_URI="([^"]+)"/);
if (!match) {
  console.error("MONGODB_URI not found in .env.local");
  process.exit(1);
}
const uri = match[1];

async function run() {
  const args = process.argv.slice(2);
  const isApply = args.includes('--apply') && args.includes('--confirm');
  const isDryRun = args.includes('--dry-run') || (!isApply && !args.includes('--check'));
  const isCheckOnly = args.includes('--check');

  console.log("=================================================================");
  console.log("OneVue Student Identity — Database Integrity & Migration Tool");
  console.log(`Mode: ${isApply ? "LIVE APPLY (Changes will be written)" : isDryRun ? "DRY RUN (Read-only simulation)" : "INTEGRITY CHECK"}`);
  console.log("=================================================================\n");

  await mongoose.connect(uri);
  const db = mongoose.connection.db;

  const users = await db.collection('users').find({}).toArray();
  const profiles = await db.collection('studentprofiles').find({}).toArray();

  const userMap = new Map(users.map(u => [u._id.toString(), u]));
  console.log(`[Summary] Total Users: ${users.length}`);
  console.log(`[Summary] Total StudentProfiles: ${profiles.length}`);

  // 1. Identify Orphaned Profiles
  const orphans = [];
  const validProfiles = [];

  for (const p of profiles) {
    const uid = p.userId ? p.userId.toString() : null;
    if (!uid || !userMap.has(uid)) {
      orphans.push(p);
    } else {
      validProfiles.push(p);
    }
  }

  console.log(`\n[Orphans] Found ${orphans.length} orphaned StudentProfile documents:`);
  orphans.forEach((o, idx) => {
    console.log(`  #${idx + 1} ProfileID: ${o._id} | UserId: ${o.userId} | School: "${o.school || ''}" | CreatedAt: ${o.createdAt}`);
  });

  // 2. Identify Academic Data Inconsistencies
  console.log("\n[Academic Consistency Analysis]");
  const academicReports = [];

  for (const p of validProfiles) {
    const user = userMap.get(p.userId.toString());
    const rootEdu = {
      school: (p.school || '').trim(),
      degree: (p.degree || '').trim(),
      gradYear: (p.gradYear || '').trim(),
      gpa: (p.gpa || '').trim()
    };
    const hasRootEdu = !!(rootEdu.school || rootEdu.degree);
    const eduList = Array.isArray(p.education) ? p.education : [];
    const firstEdu = eduList[0] ? {
      institution: (eduList[0].institution || '').trim(),
      degree: (eduList[0].degree || '').trim(),
      gradYear: (eduList[0].gradYear || eduList[0].endDate || '').trim(),
      gpa: (eduList[0].gpa || '').trim()
    } : null;

    let status = "ok";
    let conflictDetails = null;

    if (eduList.length === 0 && hasRootEdu) {
      status = "root_only_needs_canonical_record";
    } else if (eduList.length > 0 && hasRootEdu) {
      const isMismatch = (
        rootEdu.school !== firstEdu.institution ||
        rootEdu.degree !== firstEdu.degree ||
        (rootEdu.gradYear && firstEdu.gradYear && rootEdu.gradYear !== firstEdu.gradYear) ||
        (rootEdu.gpa && firstEdu.gpa && rootEdu.gpa !== firstEdu.gpa)
      );
      if (isMismatch) {
        status = "academic_conflict";
        conflictDetails = { root: rootEdu, canonical: firstEdu };
      } else {
        status = "aligned";
      }
    } else if (eduList.length > 0 && !hasRootEdu) {
      status = "canonical_only";
    }

    academicReports.push({
      profileId: p._id.toString(),
      userEmail: user ? user.email : "unknown",
      status,
      eduCount: eduList.length,
      conflictDetails
    });
  }

  academicReports.forEach(r => {
    console.log(`  Profile ${r.profileId} (${r.userEmail}): Status = ${r.status}, Education Count = ${r.eduCount}`);
    if (r.conflictDetails) {
      console.log(`    Conflict - Root:`, r.conflictDetails.root);
      console.log(`    Conflict - Canonical[0]:`, r.conflictDetails.canonical);
    }
  });

  // 3. Resume & Storage Health Check
  console.log("\n[Resume Storage Verification]");
  for (const p of validProfiles) {
    const hasFileName = !!(p.resume?.fileName || p.resumeFileName);
    const hasKey = !!(p.resume?.storageKey);
    const fileName = p.resume?.fileName || p.resumeFileName || "(none)";
    console.log(`  Profile ${p._id}: FileName = "${fileName}" | StorageKey = ${hasKey ? "present" : "MISSING (Needs re-upload)"}`);
  }

  // 4. Migration Plan / Execution
  if (isCheckOnly) {
    console.log("\nIntegrity check complete.");
    await mongoose.disconnect();
    return;
  }

  console.log(`\n=================================================================`);
  console.log(`Migration Actions (${isApply ? "EXECUTING" : "SIMULATION"}):`);
  console.log(`=================================================================`);

  let migratedCount = 0;
  for (const p of validProfiles) {
    const updates = {};
    let needsUpdate = false;

    // Action A: Create canonical education entry if only root exists
    const eduList = Array.isArray(p.education) ? [...p.education] : [];
    if (eduList.length === 0 && (p.school || p.degree)) {
      eduList.push({
        institution: (p.school || 'Unspecified Institution').trim(),
        institutionType: 'university',
        degree: (p.degree || 'Degree Program').trim(),
        gradYear: (p.gradYear || '').trim(),
        gpa: (p.gpa || '').trim(),
        currentStatus: 'studying',
        verificationStatus: 'self-reported'
      });
      updates.education = eduList;
      needsUpdate = true;
      console.log(`  [Action] Profile ${p._id}: Synthesized canonical education[0] from root fields.`);
    }

    // Action B: Migrate contacts to links[] if links is empty
    const currentLinks = Array.isArray(p.links) ? [...p.links] : [];
    if (currentLinks.length === 0 && p.contacts) {
      const platforms = [
        { key: 'github', label: 'GitHub', cat: 'coding' },
        { key: 'linkedin', label: 'LinkedIn', cat: 'professional' },
        { key: 'twitter', label: 'Twitter / X', cat: 'social' },
        { key: 'portfolio', label: 'Portfolio', cat: 'professional' },
      ];
      for (const plat of platforms) {
        const val = (p.contacts[plat.key] || '').trim();
        if (val && val.startsWith('http')) {
          currentLinks.push({
            platform: plat.label,
            url: val,
            category: plat.cat,
            isPrimary: plat.key === 'portfolio',
            visibility: 'public',
            verificationStatus: 'unverified'
          });
          needsUpdate = true;
        }
      }
      if (currentLinks.length > 0) {
        updates.links = currentLinks;
        console.log(`  [Action] Profile ${p._id}: Populated ${currentLinks.length} platform links from legacy contacts.`);
      }
    }

    // Action C: Migrate legacy mediaUrls to media[] if media is empty
    const currentMedia = Array.isArray(p.media) ? [...p.media] : [];
    if (currentMedia.length === 0 && Array.isArray(p.mediaUrls) && p.mediaUrls.length > 0) {
      for (let i = 0; i < p.mediaUrls.length; i++) {
        const url = (p.mediaUrls[i] || '').trim();
        if (url) {
          currentMedia.push({
            mediaUrl: url,
            mediaType: 'image',
            title: `Media Asset ${i + 1}`,
            category: 'project',
            displayOrder: i,
            visibility: 'public'
          });
          needsUpdate = true;
        }
      }
      if (currentMedia.length > 0) {
        updates.media = currentMedia;
        console.log(`  [Action] Profile ${p._id}: Populated ${currentMedia.length} structured media items from mediaUrls.`);
      }
    }

    // Action D: Skill category normalization
    if (Array.isArray(p.skills) && p.skills.length > 0) {
      const skillMap = { technical: "Programming Languages", frameworks: "Frontend", soft: "Other Skills", general: "Tools" };
      let skillUpdated = false;
      const updatedSkills = p.skills.map(s => {
        if (skillMap[s.category]) {
          skillUpdated = true;
          return { ...s, category: skillMap[s.category] };
        }
        return s;
      });
      if (skillUpdated) {
        updates.skills = updatedSkills;
        needsUpdate = true;
        console.log(`  [Action] Profile ${p._id}: Normalized legacy skill categories.`);
      }
    }

    if (needsUpdate) {
      migratedCount++;
      if (isApply) {
        await db.collection('studentprofiles').updateOne(
          { _id: p._id },
          { $set: updates }
        );
        console.log(`  [APPLIED] Successfully updated Profile ${p._id}.`);
      }
    }
  }

  // Action E: Orphan Archival (Never delete live user data!)
  if (orphans.length > 0) {
    console.log(`\n[Orphan Handling] ${orphans.length} orphan profiles identified.`);
    if (isApply) {
      // Archive into dedicated archival collection before touching anything
      const archiveCol = db.collection('_archived_orphaned_studentprofiles');
      for (const orphan of orphans) {
        await archiveCol.updateOne(
          { _id: orphan._id },
          { $set: { ...orphan, _archivedAt: new Date(), _archivedReason: "Orphaned profile: referenced non-existent userId" } },
          { upsert: true }
        );
      }
      console.log(`  [ARCHIVED] Safely archived ${orphans.length} orphan profiles into '_archived_orphaned_studentprofiles' collection.`);
      // Note: We do NOT delete from studentprofiles collection unless explicitly authorized
      console.log(`  [SAFETY] Live collection untouched — records safely preserved in archive.`);
    } else {
      console.log(`  [DRY RUN] Would safely archive ${orphans.length} orphans into '_archived_orphaned_studentprofiles'.`);
    }
  }

  console.log(`\n=================================================================`);
  console.log(`Result: ${migratedCount} profiles eligible for safe, non-destructive migration.`);
  console.log(`Mode was: ${isApply ? "LIVE (Applied)" : "DRY RUN (No data modified)"}`);
  console.log(`=================================================================\n`);

  await mongoose.disconnect();
}

run().catch(err => {
  console.error("Error running integrity & migration tool:", err);
  process.exit(1);
});
