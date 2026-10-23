/* Authenticated identity profile API. No local mock fallback. */
(function () {
  const { ServiceError } = window.OV.core;
  const IDENTITIES = ["professional", "freelancer", "creator", "business"];

  function apiBase() {
    const configured = window.OV_ENV && window.OV_ENV.API_BASE;
    return String(configured || "http://localhost:3000/api").replace(/\/$/, "");
  }

  function authToken() {
    const session = window.OV.core.db.get("session", null);
    return session && session.token ? session.token : "";
  }

  async function request(method, identity, body) {
    if (IDENTITIES.indexOf(identity) === -1) {
      throw new ServiceError("invalid_identity", "Unsupported profile identity.");
    }
    const token = authToken();
    if (!token) {
      throw new ServiceError("http_401", "Authentication required.");
    }
    let response;
    try {
      response = await fetch(apiBase() + "/" + identity + "/profile", {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (error) {
      throw new ServiceError("network", "Could not reach the profile service.");
    }
    let data = {};
    try {
      data = await response.json();
    } catch (error) {
      data = {};
    }
    if (!response.ok) {
      throw new ServiceError("http_" + response.status, data.message || "Request failed (" + response.status + ")");
    }
    return data;
  }

  async function getIdentityProfile(identity) {
    return request("GET", identity);
  }

  async function updateIdentityProfile(identity, patch) {
    const payload = Object.assign({}, patch || {});
    delete payload.userId;
    delete payload.ownerId;
    return request("PUT", identity, payload);
  }

  async function updateAccountName(name) {
    const token = authToken();
    if (!token) throw new ServiceError("http_401", "Authentication required.");
    let response;
    try {
      response = await fetch(apiBase() + "/profile", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer " + token,
        },
        body: JSON.stringify({ name }),
      });
    } catch (error) {
      throw new ServiceError("network", "Could not reach the profile service.");
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new ServiceError("http_" + response.status, data.message || "Could not save account name.");
    }
    return data;
  }

  window.OV.services.domainProfile = {
    getIdentityProfile,
    updateIdentityProfile,
    updateAccountName,
  };

  const profile = window.OV.services.profile;
  if (profile) {
    profile.getIdentityProfile = getIdentityProfile;
    profile.updateIdentityProfile = updateIdentityProfile;
  }
})();
