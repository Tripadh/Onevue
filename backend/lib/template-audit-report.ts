/**
 * =========================================================================
 * OneVue — Administrator audit-report projection (shared)
 * =========================================================================
 *
 * The audit report is the evidence a human reviewer decides on, so every
 * administrative surface that returns it must return the same projection.
 *
 * Two properties matter:
 * - Only known fields are returned. A stored report may carry additional
 *   evidence blocks that were never meant for a client, and a surface that
 *   returns the stored object verbatim leaks them.
 * - Evidence strings are truncated. Audit evidence is quoted source material
 *   and can be arbitrarily long.
 *
 * This module is the single definition of that projection; the submissions
 * list and the source-inspection surface both use it.
 */

export interface SanitizedAuditFinding {
  ruleId: string;
  severity: string;
  message: string;
  evidence: string;
}

/** The maximum number of characters of quoted evidence a client receives. */
export const AUDIT_EVIDENCE_MAX_CHARS = 300;

export function sanitizeFinding(finding: any): SanitizedAuditFinding {
  return {
    ruleId: String(finding?.ruleId || ""),
    severity: String(finding?.severity || "low"),
    message: String(finding?.message || ""),
    evidence: typeof finding?.evidence === "string" ? finding.evidence.slice(0, AUDIT_EVIDENCE_MAX_CHARS) : "",
  };
}

/**
 * The administrator-facing projection of an audit report.
 *
 * Returns `undefined` when there is no report, so a submission without an
 * audit omits the field entirely instead of reporting a null.
 */
export function sanitizeAuditReport(report: any): any {
  if (!report) return undefined;
  return {
    outcome: report.outcome,
    timestamp: report.timestamp,
    summary: report.summary,
    license: report.license
      ? {
          declaredLicense: report.license.declaredLicense,
          detectedSpdx: report.license.detectedSpdx,
          licenseFileFound: Boolean(report.license.licenseFileFound),
          isPermissive: Boolean(report.license.isPermissive),
          isCopyleftRestricted: Boolean(report.license.isCopyleftRestricted),
          findings: Array.isArray(report.license.findings)
            ? report.license.findings.map(sanitizeFinding)
            : [],
        }
      : undefined,
    dependencies: report.dependencies
      ? {
          totalDependencies: report.dependencies.totalDependencies || 0,
          lifecycleScriptsDetected: Array.isArray(report.dependencies.lifecycleScriptsDetected)
            ? report.dependencies.lifecycleScriptsDetected
            : [],
          lockfilePresent: Boolean(report.dependencies.lockfilePresent),
          findings: Array.isArray(report.dependencies.findings)
            ? report.dependencies.findings.map(sanitizeFinding)
            : [],
        }
      : undefined,
    generalFindings: Array.isArray(report.generalFindings)
      ? report.generalFindings.map(sanitizeFinding)
      : [],
  };
}
