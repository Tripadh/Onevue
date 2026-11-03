const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

// 1. Resolve MONGODB_URI from .env
let envContent = '';
const envPath = path.join(__dirname, '..', '.env');
const envLocalPath = path.join(__dirname, '..', '.env.local');

if (fs.existsSync(envPath)) {
  envContent = fs.readFileSync(envPath, 'utf8');
} else if (fs.existsSync(envLocalPath)) {
  envContent = fs.readFileSync(envLocalPath, 'utf8');
}

const match = envContent.match(/MONGODB_URI=(.+)/);
if (!match) {
  console.error('[SEED ERROR] MONGODB_URI not found in .env');
  process.exit(1);
}

const uri = match[1].trim().replace(/^["']|["']$/g, '');

// 2. Define Mongoose Schemas directly for portable script execution
const DomainRegistrySchema = new mongoose.Schema(
  {
    domainKey: { type: String, required: true, unique: true, trim: true, lowercase: true, index: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: '' },
    allowedActions: { type: [String], default: ['read', 'write', 'create', 'delete', 'publish', 'manage'] },
    isSystem: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true, index: true },
    order: { type: Number, default: 0 },
  },
  { timestamps: true }
);

const RolePermissionSchema = new mongoose.Schema(
  {
    role: { type: String, required: true, unique: true, trim: true, lowercase: true, index: true },
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true, default: '' },
    isSystemRole: { type: Boolean, default: false },
    permissions: [
      {
        domainKey: { type: String, required: true },
        actions: { type: [String], default: ['read'] },
      },
    ],
  },
  { timestamps: true }
);

const UserSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true },
    name: { type: String, required: true },
    username: { type: String, trim: true, lowercase: true, sparse: true, default: null },
    identity: { type: String, default: 'business' },
    role: { type: String, enum: ['super_admin', 'admin', 'moderator', 'user'], default: 'user', index: true },
    status: { type: String, enum: ['active', 'suspended', 'pending'], default: 'active', index: true },
    customPermissions: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
    onboarding: {
      surveyCompleted: { type: Boolean, default: true },
      survey: { type: mongoose.Schema.Types.Mixed, default: null },
    },
  },
  { timestamps: true }
);

const AuditLogSchema = new mongoose.Schema(
  {
    timestamp: { type: Date, default: Date.now, index: true },
    eventType: { type: String, required: true, trim: true, index: true },
    domain: { type: String, required: true, trim: true, index: true },
    severity: { type: String, enum: ['info', 'warning', 'critical'], default: 'info', index: true },
    status: { type: String, enum: ['SUCCESS', 'FAILURE'], default: 'SUCCESS', index: true },
    actor: {
      userId: { type: String, default: null },
      email: { type: String, required: true },
      role: { type: String, required: true },
      ipAddress: { type: String, default: '127.0.0.1' },
      userAgent: { type: String, default: 'seed_script' },
    },
    target: {
      entityType: { type: String, default: 'System' },
      entityId: { type: String, default: null },
      label: { type: String, default: 'OneVue Admin Initialization' },
    },
    actionSummary: { type: String, required: true },
    changes: {
      before: { type: mongoose.Schema.Types.Mixed, default: null },
      after: { type: mongoose.Schema.Types.Mixed, default: null },
    },
    metadata: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  },
  { timestamps: true }
);

const DomainRegistry = mongoose.models.DomainRegistry || mongoose.model('DomainRegistry', DomainRegistrySchema);
const RolePermission = mongoose.models.RolePermission || mongoose.model('RolePermission', RolePermissionSchema);
const User = mongoose.models.User || mongoose.model('User', UserSchema);
const AuditLog = mongoose.models.AuditLog || mongoose.model('AuditLog', AuditLogSchema);

// 3. Seed Definitions
const DEFAULT_DOMAINS = [
  {
    domainKey: 'domain.users',
    name: 'Users & Identities',
    description: 'Manage users, role assignments, student/pro profiles, account statuses, and suspension controls.',
    allowedActions: ['read', 'write', 'create', 'delete', 'manage'],
    isSystem: true,
    isActive: true,
    order: 1,
  },
  {
    domainKey: 'domain.visiting_card',
    name: 'Visiting Card Studio',
    description: 'Manage Canva-style visiting card templates, featured templates, card moderation, and export quotas.',
    allowedActions: ['read', 'write', 'create', 'delete', 'publish', 'manage'],
    isSystem: true,
    isActive: true,
    order: 2,
  },
  {
    domainKey: 'domain.websites',
    name: 'Portfolios & Websites',
    description: 'Inspect UserWebsiteConfig records, public subdomains, revision histories, and published web snapshots.',
    allowedActions: ['read', 'write', 'delete', 'publish', 'manage'],
    isSystem: true,
    isActive: true,
    order: 3,
  },
  {
    domainKey: 'domain.credentials',
    name: 'Credentials & Verifications',
    description: 'Issue official student verification seals, approve academic credentials, and manage validation badges.',
    allowedActions: ['read', 'write', 'create', 'delete', 'publish', 'manage'],
    isSystem: true,
    isActive: true,
    order: 4,
  },
  {
    domainKey: 'domain.storage',
    name: 'Storage & Cloud Assets',
    description: 'Local and R2 asset storage metrics, orphan file garbage collection, and MIME validation rules.',
    allowedActions: ['read', 'write', 'delete', 'manage'],
    isSystem: true,
    isActive: true,
    order: 5,
  },
  {
    domainKey: 'domain.security_rbac',
    name: 'Roles & Domain Matrix',
    description: 'Dynamic registry of system & future domains, sub-role creations, and granular permission enforcement.',
    allowedActions: ['read', 'write', 'create', 'delete', 'manage'],
    isSystem: true,
    isActive: true,
    order: 6,
  },
  {
    domainKey: 'domain.audit_logs',
    name: 'Security & Audit Logs',
    description: 'Dedicated immutable operational and security event stream (zero noisy debug logs).',
    allowedActions: ['read', 'delete', 'manage'],
    isSystem: true,
    isActive: true,
    order: 7,
  },
  {
    domainKey: 'domain.platform_health',
    name: 'System & Analytics',
    description: 'Real-time platform traffic, database connection health, system maintenance modes, and telemetry.',
    allowedActions: ['read', 'write', 'manage'],
    isSystem: true,
    isActive: true,
    order: 8,
  },
];

const DEFAULT_ROLES = [
  {
    role: 'super_admin',
    name: 'Super Administrator',
    description: 'Master organization controller with unrestricted access across all current and future domains.',
    isSystemRole: true,
    permissions: DEFAULT_DOMAINS.map((d) => ({
      domainKey: d.domainKey,
      actions: ['read', 'write', 'create', 'delete', 'publish', 'manage'],
    })),
  },
  {
    role: 'admin',
    name: 'Organization Administrator',
    description: 'Standard administrator with full operational access over users, templates, websites, and logs.',
    isSystemRole: true,
    permissions: DEFAULT_DOMAINS.map((d) => ({
      domainKey: d.domainKey,
      actions: d.domainKey === 'domain.security_rbac' ? ['read'] : ['read', 'write', 'create', 'publish'],
    })),
  },
  {
    role: 'moderator',
    name: 'Content & Studio Moderator',
    description: 'Audits public visiting cards, reviews templates, and verifies student credentials.',
    isSystemRole: true,
    permissions: [
      { domainKey: 'domain.users', actions: ['read'] },
      { domainKey: 'domain.visiting_card', actions: ['read', 'write', 'publish'] },
      { domainKey: 'domain.websites', actions: ['read'] },
      { domainKey: 'domain.credentials', actions: ['read', 'write', 'publish'] },
      { domainKey: 'domain.audit_logs', actions: ['read'] },
    ],
  },
];

async function seed() {
  console.log('[SEED] Connecting to MongoDB...');
  await mongoose.connect(uri);
  console.log('[SEED] Connected successfully.');

  // 1. Seed Domains
  console.log('[SEED] Syncing Domain Registry...');
  for (const dom of DEFAULT_DOMAINS) {
    await DomainRegistry.findOneAndUpdate(
      { domainKey: dom.domainKey },
      { $set: dom },
      { upsert: true, new: true }
    );
  }
  console.log(`[SEED] Registered ${DEFAULT_DOMAINS.length} core domains.`);

  // 2. Seed Roles
  console.log('[SEED] Syncing Default Roles & Permissions...');
  for (const r of DEFAULT_ROLES) {
    await RolePermission.findOneAndUpdate(
      { role: r.role },
      { $set: r },
      { upsert: true, new: true }
    );
  }
  console.log(`[SEED] Registered ${DEFAULT_ROLES.length} system roles.`);

  // 3. Seed Super Admin User
  const ADMIN_EMAIL = 'onevue@gmail.com';
  const ADMIN_PASSWORD_RAW = 'OneVue@2026';

  console.log(`[SEED] Checking super admin account: ${ADMIN_EMAIL}...`);
  const existingUser = await User.findOne({ email: ADMIN_EMAIL });

  const salt = await bcrypt.genSalt(12);
  const hashedPassword = await bcrypt.hash(ADMIN_PASSWORD_RAW, salt);

  let adminUser;
  if (!existingUser) {
    adminUser = await User.create({
      email: ADMIN_EMAIL,
      password: hashedPassword,
      name: 'OneVue Organization Super Admin',
      username: 'onevue_admin',
      identity: 'business',
      role: 'super_admin',
      status: 'active',
      customPermissions: {},
      onboarding: { surveyCompleted: true },
    });
    console.log(`[SEED] Successfully created Super Admin: ${ADMIN_EMAIL}`);
  } else {
    existingUser.role = 'super_admin';
    existingUser.status = 'active';
    existingUser.password = hashedPassword;
    if (!existingUser.username) existingUser.username = 'onevue_admin';
    await existingUser.save();
    adminUser = existingUser;
    console.log(`[SEED] Successfully updated existing user to Super Admin with updated password: ${ADMIN_EMAIL}`);
  }

  // 4. Record Initial High-Signal Audit Log
  await AuditLog.create({
    timestamp: new Date(),
    eventType: 'SYSTEM_ADMIN_INITIALIZED',
    domain: 'domain.security_rbac',
    severity: 'info',
    status: 'SUCCESS',
    actor: {
      userId: adminUser._id ? adminUser._id.toString() : null,
      email: ADMIN_EMAIL,
      role: 'super_admin',
      ipAddress: '127.0.0.1',
      userAgent: 'CLI Seed Runner',
    },
    target: {
      entityType: 'User',
      entityId: adminUser._id ? adminUser._id.toString() : null,
      label: 'Super Admin Provisioning',
    },
    actionSummary: 'Database initialized with 8 core domains, 3 system roles, and super_admin account.',
    changes: {
      after: {
        adminEmail: ADMIN_EMAIL,
        role: 'super_admin',
        domainsSeeded: DEFAULT_DOMAINS.map((d) => d.domainKey),
        rolesSeeded: DEFAULT_ROLES.map((r) => r.role),
      },
    },
  });

  console.log('[SEED] Initial High-Signal Audit Log recorded.');
  console.log('\n======================================================');
  console.log('  SUPER ADMIN CREDENTIALS READY FOR TASK 2:');
  console.log(`  Email:    ${ADMIN_EMAIL}`);
  console.log(`  Password: ${ADMIN_PASSWORD_RAW}`);
  console.log('  Role:     super_admin');
  console.log('======================================================\n');

  await mongoose.connection.close();
  process.exit(0);
}

seed().catch((err) => {
  console.error('[SEED FATAL ERROR]:', err);
  process.exit(1);
});
