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
 * 6. Bounded timeouts, bounded retries with backoff, distinct error categorization.
 * 7. Live execution disabled by default (ENABLE_LIVE_GITHUB_PROVISIONING != true).
 * 8. Content delivery uses the GitHub Git Data API (blob -> tree -> commit -> ref),
 *    so no git binary and no on-disk credential is ever required.
 * 9. Repository deletion is available for rollback of a repository that this
 *    client created during the current process only.
 */

export const FIXED_GITHUB_ORG = "qubort-tech" as const;
export const FIXED_REPO_VISIBILITY = "private" as const;

/** Default branch of the provisioned private mirror. */
export const DEFAULT_PROVISIONING_BRANCH = "main" as const;

export interface GitHubClientConfig {
  token?: string;
  baseUrl?: string;
  timeoutMs?: number;
  liveEnabled: boolean;
  fetchImpl?: typeof fetch;
  /** Maximum attempts for a single request. Defaults to 3. */
  maxAttempts?: number;
  /** Base backoff delay in milliseconds. Defaults to 250. */
  retryBaseDelayMs?: number;
}

export interface GitHubRepoCreateResult {
  success: boolean;
  url?: string;
  visibility?: string;
  owner?: string;
  repo?: string;
  error?: string;
  status?: number;
  errorCategory?:
    | "AUTHENTICATION_FAILED"
    | "INSUFFICIENT_PERMISSIONS"
    | "COLLISION"
    | "RATE_LIMITED"
    | "NETWORK_ERROR"
    | "CONFIG_ERROR";
}

export interface GitHubFileCommit {
  relativePath: string;
  contentBase64: string;
}

export interface GitHubRepositoryState {
  success: boolean;
  exists: boolean;
  owner?: string;
  visibility?: string;
  isPrivate?: boolean;
  defaultBranch?: string;
  headCommitSha?: string;
  htmlUrl?: string;
  error?: string;
  status?: number;
}

export interface GitHubFileContent {
  success: boolean;
  exists: boolean;
  contentBase64?: string;
  sha?: string;
  error?: string;
  status?: number;
}

export interface GitHubPushResult {
  success: boolean;
  commitSha?: string;
  branch?: string;
  ref?: string;
  createdRef?: boolean;
  error?: string;
  status?: number;
  errorCategory?: "AUTHENTICATION_FAILED" | "INSUFFICIENT_PERMISSIONS" | "RATE_LIMITED" | "NETWORK_ERROR";
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
  private maxAttempts: number;
  private retryBaseDelayMs: number;
  /**
   * Repositories created by this client instance. The rollback delete is
   * restricted to this set so the client can never delete a repository it
   * did not create itself.
   */
  private createdRepositories = new Set<string>();

  constructor(config: {
    token?: string;
    baseUrl?: string;
    timeoutMs?: number;
    fetchImpl?: typeof fetch;
    maxAttempts?: number;
    retryBaseDelayMs?: number;
  } = {}) {
    this.token = config.token || process.env.GITHUB_PROVISIONING_TOKEN || process.env.ONEVUE_GITHUB_TOKEN || "";
    this.baseUrl = config.baseUrl || "https://api.github.com";
    this.timeoutMs = config.timeoutMs || 20000;
    this.fetchImpl = config.fetchImpl || globalThis.fetch;
    this.maxAttempts = Math.max(1, Math.min(5, Math.floor(config.maxAttempts ?? 3)));
    this.retryBaseDelayMs = Math.max(0, Math.min(5000, Math.floor(config.retryBaseDelayMs ?? 250)));
  }

  private sanitizeError(err: unknown): string {
    const raw = err instanceof Error ? err.message : String(err);
    if (this.token && this.token.length > 5) {
      return raw.replace(new RegExp(this.token, "g"), "[REDACTED_GITHUB_TOKEN]");
    }
    return raw;
  }

  /**
   * Only transient upstream conditions are retried. A 429 is surfaced
   * immediately: it is a global rate limit, and the caller needs the reset
   * time rather than another request.
   */
  private isRetryableStatus(status: number): boolean {
    return status === 502 || status === 503 || status === 504;
  }

  private isRetryableNetworkError(err: unknown): boolean {
    const anyErr = err as any;
    if (!anyErr) return false;
    if (anyErr.name === "AbortError" || anyErr.name === "TypeError") return true;
    const code = anyErr.code;
    return code === "ECONNRESET" || code === "ETIMEDOUT" || code === "ECONNREFUSED" || code === "EPIPE";
  }

  private retryDelayMs(attempt: number, res?: Response): number {
    if (res && typeof res.headers?.get === "function") {
      const retryAfter = res.headers.get("retry-after");
      if (retryAfter) {
        const seconds = Number.parseInt(retryAfter, 10);
        if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 30000);
      }
      const reset = res.headers.get("x-ratelimit-reset");
      if (reset) {
        const resetEpoch = Number.parseInt(reset, 10);
        if (Number.isFinite(resetEpoch)) {
          const delta = resetEpoch * 1000 - Date.now();
          if (delta > 0) return Math.min(delta, 30000);
        }
      }
    }
    return Math.min(this.retryBaseDelayMs * Math.pow(2, attempt - 1), 8000);
  }

  private async delay(ms: number): Promise<void> {
    if (ms <= 0) return;
    await new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * True when the response indicates the caller has exhausted the rate limit
   * rather than lacking the required permission.
   */
  private isRateLimited(res: Response): boolean {
    if (res.status !== 403) return false;
    if (typeof res.headers?.get !== "function") return false;
    const remaining = res.headers.get("x-ratelimit-remaining");
    if (remaining === "0") return true;
    return Boolean(res.headers.get("retry-after"));
  }

  private authHeaders(hasBody: boolean): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github.v3+json",
      Authorization: `Bearer ${this.token}`,
      "User-Agent": "OneVue-Template-Provisioner/1.0",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    if (hasBody) headers["Content-Type"] = "application/json";
    return headers;
  }

  /**
   * Single request primitive with bounded retries on transient upstream
   * conditions. Returns the raw response so callers can map status codes.
   */
  private async request(
    method: string,
    endpoint: string,
    options: { body?: unknown; timeoutMs?: number; maxAttempts?: number } = {}
  ): Promise<Response> {
    const attempts = Math.max(1, Math.min(5, Math.floor(options.maxAttempts ?? this.maxAttempts)));
    let lastError: unknown;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), options.timeoutMs || this.timeoutMs);
      try {
        const res = await this.fetchImpl(endpoint, {
          method,
          headers: this.authHeaders(options.body !== undefined),
          body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
          signal: controller.signal,
        });
        if (attempt < attempts && this.isRetryableStatus(res.status)) {
          await this.delay(this.retryDelayMs(attempt, res));
          continue;
        }
        return res;
      } catch (err) {
        lastError = err;
        if (attempt < attempts && this.isRetryableNetworkError(err)) {
          await this.delay(this.retryDelayMs(attempt));
          continue;
        }
        throw new Error(this.sanitizeError(err));
      } finally {
        clearTimeout(timer);
      }
    }

    throw new Error(this.sanitizeError(lastError));
  }

  /**
   * Checks whether a repository already exists under qubort-tech.
   */
  async checkRepositoryExists(org: string, repo: string): Promise<boolean> {
    if (org !== FIXED_GITHUB_ORG) {
      throw new Error(`Organizational constraint violation: organization must be '${FIXED_GITHUB_ORG}'.`);
    }

    const endpoint = `${this.baseUrl}/repos/${encodeURIComponent(org)}/${encodeURIComponent(repo)}`;

    try {
      const res = await this.request("GET", endpoint);

      if (res.status === 200) return true;
      if (res.status === 404) return false;

      if (res.status === 401) {
        throw new Error("GitHub authentication failed: Token is invalid or expired.");
      }
      if (this.isRateLimited(res) || res.status === 429) {
        throw new Error("GitHub API rate limit exceeded.");
      }
      if (res.status === 403) {
        throw new Error("GitHub access forbidden: the token lacks access to this repository.");
      }

      throw new Error(`GitHub repository lookup returned unexpected status ${res.status}.`);
    } catch (err) {
      throw new Error(this.sanitizeError(err));
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

    try {
      const res = await this.request("POST", endpoint, {
        body: {
          name: repo,
          description: options.description || "OneVue approved private template repository",
          private: true,
          visibility: "private",
          has_issues: false,
          has_projects: false,
          has_wiki: false,
          /**
           * The repository MUST be seeded with an initial commit.
           *
           * GitHub's Git Data API refuses to create a blob in a repository that
           * has no commits: `POST /repos/{org}/{repo}/git/blobs` answers
           * `409 "Git Repository is empty."`. The mirror is delivered through
           * that API (blob -> tree -> commit -> ref), so a repository created
           * without an initial commit can never receive its files and every
           * provisioning attempt fails at the first blob.
           *
           * The auto-created README does not leak into the mirror: the tree is
           * built from the mirrored files alone (no `base_tree`), so the
           * provisioned branch contains exactly the approved source files.
           */
          auto_init: true,
        },
      });

      if (res.status === 201) {
        const data: any = await res.json();
        this.createdRepositories.add(`${org}/${repo}`);
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

      if (this.isRateLimited(res) || res.status === 429) {
        return {
          success: false,
          status: res.status,
          error: "GitHub rate limit exceeded.",
          errorCategory: "RATE_LIMITED",
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
    }
  }

  /**
   * Reads the live state of a repository: owner, visibility and head commit.
   */
  async getRepositoryState(org: string, repo: string): Promise<GitHubRepositoryState> {
    if (org !== FIXED_GITHUB_ORG) {
      return {
        success: false,
        exists: false,
        error: `Organizational constraint violation: organization must be '${FIXED_GITHUB_ORG}'.`,
      };
    }

    const endpoint = `${this.baseUrl}/repos/${encodeURIComponent(org)}/${encodeURIComponent(repo)}`;

    try {
      const res = await this.request("GET", endpoint);

      if (res.status === 404) {
        return { success: true, exists: false };
      }
      if (res.status === 401) {
        return { success: false, exists: false, status: 401, error: "GitHub authentication failed: Token is invalid or has expired." };
      }
      if (res.status === 429 || this.isRateLimited(res)) {
        return { success: false, exists: false, status: res.status, error: "GitHub rate limit exceeded." };
      }
      if (!res.ok) {
        return {
          success: false,
          exists: false,
          status: res.status,
          error: `Repository lookup failed (status ${res.status}).`,
        };
      }

      const data: any = await res.json();
      const defaultBranch: string | undefined = data.default_branch || undefined;

      let headCommitSha: string | undefined;
      if (defaultBranch) {
        try {
          const commitRes = await this.request(
            "GET",
            `${this.baseUrl}/repos/${encodeURIComponent(org)}/${encodeURIComponent(repo)}/commits/${encodeURIComponent(defaultBranch)}`
          );
          if (commitRes.ok) {
            const commitData: any = await commitRes.json();
            headCommitSha = commitData.sha || undefined;
          }
        } catch {
          // A missing head commit is not fatal for state inspection.
        }
      }

      return {
        success: true,
        exists: true,
        owner: data.owner?.login,
        visibility: data.visibility || (data.private ? "private" : "public"),
        isPrivate: data.private === true,
        defaultBranch,
        headCommitSha,
        htmlUrl: data.html_url,
      };
    } catch (err) {
      return { success: false, exists: false, error: this.sanitizeError(err) };
    }
  }

  /**
   * Deletes a repository. Restricted to repositories this client created in
   * the current process, so it can never remove an unrelated repository.
   */
  async deleteRepository(org: string, repo: string): Promise<{ success: boolean; error?: string; status?: number }> {
    const key = `${org}/${repo}`;
    if (!this.createdRepositories.has(key)) {
      return {
        success: false,
        error: `Refusing to delete '${key}': it was not created by this provisioning run.`,
      };
    }

    const endpoint = `${this.baseUrl}/repos/${encodeURIComponent(org)}/${encodeURIComponent(repo)}`;
    try {
      const res = await this.request("DELETE", endpoint, { maxAttempts: 1 });
      if (res.status === 204 || res.ok) {
        this.createdRepositories.delete(key);
        return { success: true };
      }
      return {
        success: false,
        status: res.status,
        error: `Repository deletion failed with status ${res.status}.`,
      };
    } catch (err) {
      return { success: false, error: this.sanitizeError(err) };
    }
  }

  /**
   * Reads a file from a repository branch. Returns base64 content.
   */
  async readFileContent(
    org: string,
    repo: string,
    filePath: string,
    ref?: string
  ): Promise<GitHubFileContent> {
    const encodedPath = filePath
      .split("/")
      .filter(Boolean)
      .map((segment) => encodeURIComponent(segment))
      .join("/");
    let endpoint = `${this.baseUrl}/repos/${encodeURIComponent(org)}/${encodeURIComponent(repo)}/contents/${encodedPath}`;
    if (ref) endpoint += `?ref=${encodeURIComponent(ref)}`;

    try {
      const res = await this.request("GET", endpoint);
      if (res.status === 404) {
        return { success: true, exists: false, status: 404 };
      }
      if (!res.ok) {
        return {
          success: false,
          exists: false,
          status: res.status,
          error: `File read failed with status ${res.status}.`,
        };
      }

      const data: any = await res.json();
      if (data.type !== "file" || typeof data.content !== "string" || data.content.length === 0) {
        // The contents API omits inline content for large files; fall back to
        // the blob endpoint, which returns the full base64 payload.
        if (data.sha) {
          try {
            const blobRes = await this.request(
              "GET",
              `${this.baseUrl}/repos/${encodeURIComponent(org)}/${encodeURIComponent(repo)}/git/blobs/${encodeURIComponent(data.sha)}`
            );
            if (blobRes.ok) {
              const blob: any = await blobRes.json();
              if (typeof blob.content === "string") {
                return { success: true, exists: true, contentBase64: blob.content, sha: data.sha };
              }
            }
          } catch {
            // Fall through to the empty-content result below.
          }
        }
        return { success: true, exists: true, contentBase64: "", sha: data.sha };
      }

      return {
        success: true,
        exists: true,
        contentBase64: data.encoding === "base64" ? data.content : "",
        sha: data.sha,
      };
    } catch (err) {
      return { success: false, exists: false, error: this.sanitizeError(err) };
    }
  }

  /**
   * Resolves the head commit of a branch, if the branch exists.
   */
  private async getRefHead(org: string, repo: string, branch: string): Promise<{ exists: boolean; sha?: string }> {
    const endpoint = `${this.baseUrl}/repos/${encodeURIComponent(org)}/${encodeURIComponent(repo)}/git/ref/heads/${encodeURIComponent(branch)}`;
    try {
      const res = await this.request("GET", endpoint);
      if (res.status === 404) return { exists: false };
      if (!res.ok) return { exists: false };
      const data: any = await res.json();
      return { exists: true, sha: data.object?.sha };
    } catch {
      return { exists: false };
    }
  }

  private async createBlob(org: string, repo: string, contentBase64: string): Promise<{ success: boolean; sha?: string; error?: string }> {
    const endpoint = `${this.baseUrl}/repos/${encodeURIComponent(org)}/${encodeURIComponent(repo)}/git/blobs`;
    try {
      const res = await this.request("POST", endpoint, { body: { content: contentBase64, encoding: "base64" } });
      if (res.status === 201) {
        const data: any = await res.json();
        return { success: true, sha: data.sha };
      }
      return { success: false, error: `Blob creation failed with status ${res.status}.` };
    } catch (err) {
      return { success: false, error: this.sanitizeError(err) };
    }
  }

  private async createTree(
    org: string,
    repo: string,
    entries: Array<{ path: string; mode: string; type: "blob"; sha: string }>
  ): Promise<{ success: boolean; sha?: string; error?: string }> {
    const endpoint = `${this.baseUrl}/repos/${encodeURIComponent(org)}/${encodeURIComponent(repo)}/git/trees`;
    try {
      const res = await this.request("POST", endpoint, { body: { tree: entries } });
      if (res.status === 201) {
        const data: any = await res.json();
        return { success: true, sha: data.sha };
      }
      return { success: false, error: `Tree creation failed with status ${res.status}.` };
    } catch (err) {
      return { success: false, error: this.sanitizeError(err) };
    }
  }

  private async createCommit(
    org: string,
    repo: string,
    message: string,
    treeSha: string,
    parents: string[]
  ): Promise<{ success: boolean; sha?: string; error?: string }> {
    const endpoint = `${this.baseUrl}/repos/${encodeURIComponent(org)}/${encodeURIComponent(repo)}/git/commits`;
    try {
      const res = await this.request("POST", endpoint, {
        body: { message, tree: treeSha, parents },
      });
      if (res.status === 201) {
        const data: any = await res.json();
        return { success: true, sha: data.sha };
      }
      return { success: false, error: `Commit creation failed with status ${res.status}.` };
    } catch (err) {
      return { success: false, error: this.sanitizeError(err) };
    }
  }

  /**
   * Pushes a complete file set to a repository branch using the Git Data API.
   *
   * The resulting tree contains exactly the supplied files, so the private
   * mirror is an exact reflection of the approved source snapshot.
   */
  async pushFiles(
    org: string,
    repo: string,
    files: GitHubFileCommit[],
    options: { branch?: string; message?: string } = {}
  ): Promise<GitHubPushResult> {
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
        errorCategory: "NETWORK_ERROR",
      };
    }

    const branch = options.branch || DEFAULT_PROVISIONING_BRANCH;
    const refName = `refs/heads/${branch}`;

    try {
      const head = await this.getRefHead(org, repo, branch);

      const treeEntries: Array<{ path: string; mode: string; type: "blob"; sha: string }> = [];
      for (const file of files) {
        const blob = await this.createBlob(org, repo, file.contentBase64);
        if (!blob.success || !blob.sha) {
          return {
            success: false,
            branch,
            error: `Failed to create blob for '${file.relativePath}': ${blob.error || "unknown error"}`,
            errorCategory: "NETWORK_ERROR",
          };
        }
        treeEntries.push({ path: file.relativePath, mode: "100644", type: "blob", sha: blob.sha });
      }

      const tree = await this.createTree(org, repo, treeEntries);
      if (!tree.success || !tree.sha) {
        return {
          success: false,
          branch,
          error: `Failed to create tree: ${tree.error || "unknown error"}`,
          errorCategory: "NETWORK_ERROR",
        };
      }

      const commit = await this.createCommit(
        org,
        repo,
        options.message || `OneVue approved template mirror (${files.length} files)`,
        tree.sha,
        head.exists && head.sha ? [head.sha] : []
      );
      if (!commit.success || !commit.sha) {
        return {
          success: false,
          branch,
          error: `Failed to create commit: ${commit.error || "unknown error"}`,
          errorCategory: "NETWORK_ERROR",
        };
      }

      let createdRef = false;
      if (head.exists) {
        const updateEndpoint = `${this.baseUrl}/repos/${encodeURIComponent(org)}/${encodeURIComponent(repo)}/git/refs/heads/${encodeURIComponent(branch)}`;
        const updateRes = await this.request("PATCH", updateEndpoint, { body: { sha: commit.sha, force: false } });
        if (!updateRes.ok) {
          return {
            success: false,
            branch,
            error: `Failed to update branch '${branch}' (status ${updateRes.status}).`,
            errorCategory: "NETWORK_ERROR",
          };
        }
      } else {
        const createEndpoint = `${this.baseUrl}/repos/${encodeURIComponent(org)}/${encodeURIComponent(repo)}/git/refs`;
        const createRes = await this.request("POST", createEndpoint, { body: { ref: refName, sha: commit.sha } });
        if (!createRes.ok) {
          return {
            success: false,
            branch,
            error: `Failed to create branch '${branch}' (status ${createRes.status}).`,
            errorCategory: "NETWORK_ERROR",
          };
        }
        createdRef = true;
      }

      return {
        success: true,
        commitSha: commit.sha,
        branch,
        ref: refName,
        createdRef,
      };
    } catch (err) {
      return {
        success: false,
        error: this.sanitizeError(err),
        errorCategory: "NETWORK_ERROR",
      };
    }
  }

  /**
   * Verifies destination repository ownership and private visibility post-creation.
   */
  async verifyRepositoryState(
    org: string,
    repo: string
  ): Promise<{ verified: boolean; error?: string; owner?: string; visibility?: string }> {
    const state = await this.getRepositoryState(org, repo);
    if (!state.success) {
      return { verified: false, error: state.error || "Repository verification lookup failed." };
    }
    if (!state.exists) {
      return { verified: false, error: "Repository verification lookup failed: repository not found." };
    }
    if (state.owner !== FIXED_GITHUB_ORG) {
      return { verified: false, error: `Owner verification mismatch: expected '${FIXED_GITHUB_ORG}', got '${state.owner}'.` };
    }
    if (state.isPrivate !== true || state.visibility !== FIXED_REPO_VISIBILITY) {
      return { verified: false, error: "Visibility invariant violation: repository is not private." };
    }
    return { verified: true, owner: state.owner, visibility: FIXED_REPO_VISIBILITY };
  }
}
