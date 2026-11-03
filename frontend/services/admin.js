/**
 * OneVue Organization Administration Service
 * Manages admin authentication, domain registry, and security audit log fetching.
 */
(function () {
  'use strict';
  const { db, ServiceError } = window.OV.core;
  const ADMIN_SESSION_KEY = 'admin_session';
  const BACKEND_BASE = (window.OV_ENV && window.OV_ENV.API_URL && window.OV_ENV.API_MODE === 'live')
    ? window.OV_ENV.API_URL.replace(/\/$/, '')
    : 'http://localhost:3000/api';

  async function adminRequest(path, options = {}) {
    const session = db.get(ADMIN_SESSION_KEY, null);
    const headers = {
      'Content-Type': 'application/json',
      ...(session && session.token ? { Authorization: 'Bearer ' + session.token } : {}),
      ...(options.headers || {}),
    };

    const url = `${BACKEND_BASE}${path}`;
    try {
      const res = await fetch(url, {
        method: options.method || 'GET',
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new ServiceError(
          'admin_http_' + res.status,
          data.message || `Administrative request failed (${res.status})`
        );
      }

      return data;
    } catch (err) {
      if (err instanceof ServiceError) throw err;
      throw new ServiceError('network_error', 'Cannot reach OneVue Admin API at ' + BACKEND_BASE);
    }
  }

  const adminService = {
    /**
     * Authenticates administrator using secure credentials.
     * Rejects regular users.
     */
    async login(email, password) {
      const res = await adminRequest('/admin/auth/login', {
        method: 'POST',
        body: { email, password },
      });

      if (res.success && res.token) {
        const session = {
          token: res.token,
          user: res.user,
          loginTime: new Date().toISOString(),
        };
        db.set(ADMIN_SESSION_KEY, session);
        return session;
      }

      throw new ServiceError('auth_failed', res.message || 'Authentication failed');
    },

    /**
     * Gets active admin session from storage
     */
    getSession() {
      return db.get(ADMIN_SESSION_KEY, null);
    },

    /**
     * Validates current admin session with backend
     */
    async fetchProfile() {
      const session = this.getSession();
      if (!session || !session.token) return null;

      try {
        const res = await adminRequest('/admin/auth/me');
        if (res.success) {
          // Update cached user info
          const updatedSession = { ...session, user: res.user, domains: res.domains, roleConfig: res.roleConfig };
          db.set(ADMIN_SESSION_KEY, updatedSession);
          return updatedSession;
        }
      } catch (err) {
        this.logout();
        throw err;
      }
      return null;
    },

    /**
     * Clears administrator session
     */
    logout() {
      db.remove(ADMIN_SESSION_KEY);
    },

    /**
     * Checks if current admin has role or domain permission
     */
    hasPermission(domainKey, action = 'read') {
      const session = this.getSession();
      if (!session || !session.user) return false;
      if (session.user.role === 'super_admin') return true;

      const custom = session.user.customPermissions || {};
      if (custom[domainKey]) {
        return custom[domainKey].includes('*') || custom[domainKey].includes(action) || custom[domainKey].includes('manage');
      }

      if (session.roleConfig && session.roleConfig.permissions) {
        const p = session.roleConfig.permissions.find(x => x.domainKey === domainKey);
        if (p) {
          return p.actions.includes('*') || p.actions.includes(action) || p.actions.includes('manage');
        }
      }

      return false;
    },

    /**
     * Domain Registry APIs
     */
    async getDomains() {
      const res = await adminRequest('/admin/domains');
      return res.domains || [];
    },

    async createDomain(payload) {
      return adminRequest('/admin/domains', {
        method: 'POST',
        body: payload,
      });
    },

    async updateDomain(payload) {
      return adminRequest('/admin/domains', {
        method: 'PATCH',
        body: payload,
      });
    },

    /**
     * Role & Permission Matrix APIs
     */
    async getRoles() {
      const res = await adminRequest('/admin/roles');
      return res.roles || [];
    },

    async updateRolePermissions(role, permissions, description) {
      return adminRequest('/admin/roles', {
        method: 'PUT',
        body: { role, permissions, description },
      });
    },

    /**
     * High-Signal Audit Logs API
     */
    async getAuditLogs(params = {}) {
      const qs = new URLSearchParams();
      if (params.domain) qs.set('domain', params.domain);
      if (params.severity) qs.set('severity', params.severity);
      if (params.status) qs.set('status', params.status);
      if (params.search) qs.set('search', params.search);
      if (params.page) qs.set('page', params.page);
      if (params.limit) qs.set('limit', params.limit || '25');

      const url = '/admin/audit-logs' + (qs.toString() ? '?' + qs.toString() : '');
      return adminRequest(url);
    },

    async purgeAuditLogs(olderThanDays = 30) {
      return adminRequest(`/admin/audit-logs?days=${olderThanDays}`, {
        method: 'DELETE',
      });
    },

    /**
     * User Management APIs
     */
    async getUsers(params = {}) {
      const qs = new URLSearchParams();
      if (params.search) qs.set('search', params.search);
      if (params.role) qs.set('role', params.role);
      if (params.identity) qs.set('identity', params.identity);
      if (params.status) qs.set('status', params.status);
      if (params.page) qs.set('page', params.page);
      if (params.limit) qs.set('limit', params.limit || '20');

      const url = '/admin/users' + (qs.toString() ? '?' + qs.toString() : '');
      return adminRequest(url);
    },

    async updateUser(userId, patch) {
      return adminRequest('/admin/users', {
        method: 'PATCH',
        body: { userId, ...patch },
      });
    },

    /**
     * User Safeguards & Impact Previews
     */
    async getUserPreview(userId) {
      return adminRequest(`/admin/users/${userId}/preview`);
    },

    async blockUser(userId, payload) {
      return adminRequest(`/admin/users/${userId}/block`, {
        method: 'POST',
        body: payload,
      });
    },

    async unblockUser(userId, reason) {
      return adminRequest(`/admin/users/${userId}/unblock`, {
        method: 'POST',
        body: { reason },
      });
    },

    async deleteUser(userId, reason) {
      return adminRequest(`/admin/users/${userId}/delete`, {
        method: 'POST',
        body: { reason },
      });
    },

    async getUserHistory(userId) {
      return adminRequest(`/admin/users/${userId}/change-history`);
    },

    async bulkBlockPreview(payload) {
      return adminRequest('/admin/users/bulk/block', {
        method: 'POST',
        body: payload,
      });
    },

    async bulkBlockConfirm(confirmation_token) {
      return adminRequest('/admin/users/bulk/block/confirm', {
        method: 'POST',
        body: { confirmation_token },
      });
    },

    /**
     * Warning System
     */
    async getWarningTemplates() {
      const res = await adminRequest('/admin/warning-templates');
      return res.templates || [];
    },

    async warnUser(userId, payload) {
      return adminRequest(`/admin/users/${userId}/warn`, {
        method: 'POST',
        body: payload,
      });
    },

    async getUserWarnings(userId) {
      return adminRequest(`/admin/users/${userId}/warnings`);
    },

    /**
     * Ban Appeals Queue
     */
    async getAppeals(params = {}) {
      const qs = new URLSearchParams();
      if (params.status) qs.set('status', params.status);
      if (params.page) qs.set('page', params.page);
      if (params.limit) qs.set('limit', params.limit || '20');
      const url = '/admin/appeals' + (qs.toString() ? '?' + qs.toString() : '');
      return adminRequest(url);
    },

    async reviewAppeal(appealId, payload) {
      return adminRequest(`/admin/appeals/${appealId}/review`, {
        method: 'POST',
        body: payload,
      });
    },

    /**
     * GDPR & Compliance Management
     */
    async getComplianceRequests(params = {}) {
      const qs = new URLSearchParams();
      if (params.type) qs.set('type', params.type);
      if (params.status) qs.set('status', params.status);
      if (params.page) qs.set('page', params.page);
      if (params.limit) qs.set('limit', params.limit || '20');
      const url = '/admin/compliance/requests' + (qs.toString() ? '?' + qs.toString() : '');
      return adminRequest(url);
    },

    async createComplianceRequest(payload) {
      return adminRequest('/admin/compliance/requests', {
        method: 'POST',
        body: payload,
      });
    },

    async executeGdprDeletion(payload) {
      return adminRequest('/admin/compliance/gdpr-deletion', {
        method: 'POST',
        body: payload,
      });
    },

    async exportRightToAccess(userId, reason) {
      return adminRequest('/admin/compliance/right-to-access', {
        method: 'POST',
        body: { user_id: userId, reason },
      });
    },

    /**
     * Analytics & Performance
     */
    async getUserStats() {
      return adminRequest('/admin/analytics/user-stats');
    },

    async getActivityTimeline(days = 30) {
      return adminRequest(`/admin/analytics/activity?days=${days}`);
    },

    async getPerformanceMetrics() {
      return adminRequest('/admin/analytics/performance');
    },

    /**
     * Report CSV Export
     */
    async downloadReport(type) {
      const session = this.getSession();
      const token = session ? session.token : '';
      const url = `${BACKEND_BASE}/admin/reports/export?type=${type}`;
      const res = await fetch(url, {
        headers: {
          Authorization: 'Bearer ' + token,
        },
      });
      if (!res.ok) throw new Error('Failed to export CSV report');
      const blob = await res.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = blobUrl;
      a.download = `onevue_${type}_${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(blobUrl);
    },

    /**
     * Session Management
     */
    async getSessions() {
      return adminRequest('/admin/sessions');
    },

    async revokeSession(sessionId, reason) {
      return adminRequest('/admin/sessions', {
        method: 'POST',
        body: { action: 'revoke', sessionId, reason },
      });
    },
  };

  window.OV.services.admin = adminService;
})();
