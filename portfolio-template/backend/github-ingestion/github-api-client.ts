/**
 * =========================================================================
 * OneVue Phase 5.2 — GitHub REST API Client
 * =========================================================================
 *
 * Guarantees:
 * 1. Reads credentials exclusively from server-side environment variables.
 * 2. Never accepts credentials from client requests or untrusted input.
 * 3. Never logs or leaks tokens in error messages or responses.
 * 4. Fixed destination organization: 'qubort-tech'.
 * 5. Fixed repository visibility: 'private'.
 * 6. Bounded timeouts, rate limit handling, and distinct error categorization.
 * 7. Live execution disabled by default (ENABLE_LIVE_GITHUB_PROVISIONING != true).
 */

export const FIXED_GITHUB_ORG = "qubort-tech" as const;
export const FIXED_REPO_VISIBILITY = "private" as const;

export interface GitHubClientConfig {
  token?: string;
  baseUrl?: string;
  timeoutMs?: number;
  liveEnabled: boolean;
  fetchImpl?: typeof fetch;
}

export interface GitHubRepoCreateResult {
  success: boolean;
  url?: string;
  visibility?: string;
  owner?: string;
  repo?: string;
  error?: string;
  status?: number;
  errorCategory?: "AUTHENTICATION_FAILED" | "INSUFFICIENT_PERMISSIONS" | "COLLISION" | "RATE_LIMITED" | "NETWORK_ERROR" | "CONFIG_ERROR";
}

export interface GitHubFileCommit {
  relativePath: string;
  contentBase64: string;
}

/**
 * Reads server-managed GitHub configuration safely.
 * Never leaks token contents.
 */
export function getGitHubProvisioningConfig(): { configured: boolean; liveEnabled: boolean; error?: string } {
  const liveEnabled = process.env.ENABLE_LIVE_GITHUB_PROVISIONING === "true";
  const token = process.env.GITHUB_PROVISIONING_TOKEN || process.env.ONEVUE_GITHUB_TOKEN;

  if (liveEnabled && (!token || token.trim().length < 20)) {
    return {
      configured: false,
      liveEnabled: true,
      error: "GitHub provisioning credential (GITHUB_PROVISIONING_TOKEN) is missing or invalid on the server.",
    };
  }

  return {
    configured: Boolean(token && token.trim().length >= 20),
    liveEnabled,
  };
}

export class GitHubApiClient {
  private token: string;
  private baseUrl: string;
  private timeoutMs: number;
  private fetchImpl: typeof fetch;

  constructor(config: { token?: string; baseUrl?: string; timeoutMs?: number; fetchImpl?: typeof fetch } = {}) {
    this.token = config.token || process.env.GITHUB_PROVISIONING_TOKEN || process.env.ONEVUE_GITHUB_TOKEN || "";
    this.baseUrl = config.baseUrl || "https://api.github.com";
    this.timeoutMs = config.timeoutMs || 20000;
    this.fetchImpl = config.fetchImpl || globalThis.fetch;
  }

  private sanitizeError(err: unknown): string {
    const raw = err instanceof Error ? err.message : String(err);
    if (this.token && this.token.length > 5) {
      return raw.replace(new RegExp(this.token, "g"), "[REDACTED_GITHUB_TOKEN]");
    }
    return raw;
  }

  /**
   * Checks whether a repository already exists under qubort-tech.
   */
  async checkRepositoryExists(org: string, repo: string): Promise<boolean> {
    if (org !== FIXED_GITHUB_ORG) {
      throw new Error(`Organizational constraint violation: organization must be '${FIXED_GITHUB_ORG}'.`);
    }

    const endpoint = `${this.baseUrl}/repos/${encodeURIComponent(org)}/${encodeURIComponent(repo)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await this.fetchImpl(endpoint, {
        method: "GET",
        headers: {
          Accept: "application/vnd.github.v3+json",
          Authorization: `Bearer ${this.token}`,
          "User-Agent": "OneVue-Template-Provisioner/1.0",
        },
        signal: controller.signal,
      });

      if (res.status === 200) return true;
      if (res.status === 404) return false;

      if (res.status === 401) {
        throw new Error("GitHub authentication failed: Token is invalid or expired.");
      }
      if (res.status === 403 || res.status === 429) {
        throw new Error("GitHub API rate limit exceeded or access forbidden.");
      }

      throw new Error(`GitHub repository lookup returned unexpected status ${res.status}.`);
    } catch (err) {
      throw new Error(this.sanitizeError(err));
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Creates a private repository under the qubort-tech organization.
   */
  async createPrivateOrgRepository(
    org: string,
    repo: string,
    options: { description?: string } = {}
  ): Promise<GitHubRepoCreateResult> {
    if (org !== FIXED_GITHUB_ORG) {
      return {
        success: false,
        error: `Organizational violation: Organization must be '${FIXED_GITHUB_ORG}'.`,
        errorCategory: "INSUFFICIENT_PERMISSIONS",
      };
    }

    if (!this.token || this.token.trim().length < 20) {
      return {
        success: false,
        error: "Server configuration error: Valid GITHUB_PROVISIONING_TOKEN is not configured.",
        errorCategory: "CONFIG_ERROR",
      };
    }

    const endpoint = `${this.baseUrl}/orgs/${encodeURIComponent(org)}/repos`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await this.fetchImpl(endpoint, {
        method: "POST",
        headers: {
          Accept: "application/vnd.github.v3+json",
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
          "User-Agent": "OneVue-Template-Provisioner/1.0",
        },
        body: JSON.stringify({
          name: repo,
          description: options.description || "OneVue approved private template repository",
          private: true,
          visibility: "private",
          has_issues: false,
          has_projects: false,
          has_wiki: false,
          auto_init: false, // Critical: do not auto-init README or license
        }),
        signal: controller.signal,
      });

      if (res.status === 201) {
        const data: any = await res.json();
        return {
          success: true,
          url: data.html_url || `https://github.com/${org}/${repo}`,
          visibility: data.private ? "private" : "public",
          owner: data.owner?.login || org,
          repo,
        };
      }

      if (res.status === 422) {
        return {
          success: false,
          status: 422,
          error: `Repository '${org}/${repo}' collision: A repository with this name already exists or is unavailable.`,
          errorCategory: "COLLISION",
        };
      }

      if (res.status === 401) {
        return {
          success: false,
          status: 401,
          error: "GitHub authentication failed: Token is invalid or has expired.",
          errorCategory: "AUTHENTICATION_FAILED",
        };
      }

      if (res.status === 403) {
        return {
          success: false,
          status: 403,
          error: "GitHub permission error: Token lacks required organization administration privileges.",
          errorCategory: "INSUFFICIENT_PERMISSIONS",
        };
      }

      if (res.status === 429) {
        return {
          success: false,
          status: 429,
          error: "GitHub rate limit exceeded.",
          errorCategory: "RATE_LIMITED",
        };
      }

      return {
        success: false,
        status: res.status,
        error: `GitHub repository creation failed with status ${res.status}.`,
        errorCategory: "NETWORK_ERROR",
      };
    } catch (err) {
      return {
        success: false,
        error: this.sanitizeError(err),
        errorCategory: "NETWORK_ERROR",
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Verifies destination repository ownership and private visibility post-creation.
   */
  async verifyRepositoryState(
    org: string,
    repo: string
  ): Promise<{ verified: boolean; error?: string; owner?: string; visibility?: string }> {
    const endpoint = `${this.baseUrl}/repos/${encodeURIComponent(org)}/${encodeURIComponent(repo)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const res = await this.fetchImpl(endpoint, {
        method: "GET",
        headers: {
          Accept: "application/vnd.github.v3+json",
          Authorization: `Bearer ${this.token}`,
          "User-Agent": "OneVue-Template-Provisioner/1.0",
        },
        signal: controller.signal,
      });

      if (!res.ok) {
        return { verified: false, error: `Repository verification lookup failed (status ${res.status}).` };
      }

      const data: any = await res.json();
      const owner = data.owner?.login;
      const isPrivate = data.private === true && data.visibility === "private";

      if (owner !== FIXED_GITHUB_ORG) {
        return { verified: false, error: `Owner verification mismatch: expected '${FIXED_GITHUB_ORG}', got '${owner}'.` };
      }

      if (!isPrivate) {
        return { verified: false, error: "Visibility invariant violation: repository is not private." };
      }

      return { verified: true, owner, visibility: "private" };
    } catch (err) {
      return { verified: false, error: this.sanitizeError(err) };
    } finally {
      clearTimeout(timer);
    }
  }
}
