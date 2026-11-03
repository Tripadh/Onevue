const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dashboardPath = path.join(__dirname, '..', 'components', 'dashboard', 'shared', 'IdentityDashboard.jsx');
const source = fs.readFileSync(dashboardPath, 'utf8');

test('shared dashboard config covers all five identity domains', () => {
  for (const identity of ['student', 'freelancer', 'business', 'professional', 'creator']) {
    assert.match(source, new RegExp(`^  ${identity}: \\{`, 'm'));
  }
  assert.match(source, /window\.SharedIdentityDashboard = SharedIdentityDashboard/);
});

test('identity-only dashboard fields stay scoped to their domain', () => {
  const studentConfig = source.slice(source.indexOf('student: {'), source.indexOf('freelancer: {'));
  const freelancerConfig = source.slice(source.indexOf('freelancer: {'), source.indexOf('business: {'));
  const businessConfig = source.slice(source.indexOf('business: {'), source.indexOf('professional: {'));
  const professionalConfig = source.slice(source.indexOf('professional: {'), source.indexOf('creator: {'));
  const creatorConfig = source.slice(source.indexOf('creator: {'), source.indexOf('function primaryEducation'));

  assert.match(studentConfig, /\['GPA'/);
  assert.doesNotMatch(freelancerConfig, /\['GPA'/);
  assert.doesNotMatch(businessConfig, /\['GPA'/);
  assert.doesNotMatch(professionalConfig, /\['GPA'/);
  assert.doesNotMatch(creatorConfig, /\['GPA'/);
  assert.match(businessConfig, /\['Business presence analytics'/);
  assert.doesNotMatch(studentConfig, /\['Business presence analytics'/);
});
