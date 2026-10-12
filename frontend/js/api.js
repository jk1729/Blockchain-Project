/* ==========================================================
   PDSCHAIN — API.JS
   Centralized REST API Client for PDSChain Frontend:
   - Configurable Base URL (window.PDSCHAIN_API_URL or localhost:3000/api)
   - Automatic JWT Token Header Injection
   - Centralized Error & 401 Token Expiration Handling
   - Standardized GET, POST, PUT, DELETE Request Helpers
   ========================================================== */

(function () {
  "use strict";

  if (!window.escapeHtml) {
    window.escapeHtml = function (str) {
      if (str === null || str === undefined) return "";
      return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    };
  }

  var STATIC_DEV_PORTS = { "5500": true, "5501": true, "5502": true, "5503": true, "5173": true, "8080": true, "8000": true, "4200": true };

  function resolveApiBaseUrl() {
    if (window.PDSCHAIN_API_URL) {
      var cfg = String(window.PDSCHAIN_API_URL).replace(/\/+$/, "");
      return cfg.endsWith("/api") ? cfg : cfg + "/api";
    }
    if (typeof window.getPDSChainApiBase === "function") {
      return window.getPDSChainApiBase("api");
    }
    if (window.PDSCHAIN_BACKEND_ORIGIN) {
      return String(window.PDSCHAIN_BACKEND_ORIGIN).replace(/\/+$/, "") + "/api";
    }
    if (window.location && window.location.origin && window.location.origin.indexOf("http") === 0) {
      var port = String(window.location.port || "");
      var pathname = String(window.location.pathname || "").toLowerCase();
      if (!STATIC_DEV_PORTS[port] && pathname.indexOf("/frontend/") === -1) {
        return window.location.origin + "/api";
      }
    }
    return "http://localhost:3000/api";
  }

  var BASE_URL = resolveApiBaseUrl();

  if (!window.parsePDSJsonResponse) {
    window.parsePDSJsonResponse = function (res) {
      if (!res) {
        return Promise.reject(new Error("No response received from server."));
      }
      if (res.status === 204) {
        return Promise.resolve({ success: true, status: 204 });
      }
      return res.text().then(function (rawText) {
        var trimmed = (rawText || "").trim();
        if (!trimmed) {
          var emptyErr = new Error(
            res.ok
              ? "Server returned an empty response body (HTTP " + res.status + ")."
              : "Request failed with HTTP " + res.status + " (empty response from server)."
          );
          emptyErr.status = res.status;
          throw emptyErr;
        }
        try {
          return JSON.parse(trimmed);
        } catch (parseErr) {
          var invalidErr = new Error(
            "Server returned a non-JSON response (HTTP " + res.status + "). Ensure the PDSChain backend is running on http://localhost:3000."
          );
          invalidErr.status = res.status;
          throw invalidErr;
        }
      });
    };
  }

  function getAuthToken() {
    try {
      return localStorage.getItem("pdschain_jwt_token") || "";
    } catch (e) {
      return "";
    }
  }

  function setAuthToken(token) {
    try {
      if (token) {
        localStorage.setItem("pdschain_jwt_token", token);
      } else {
        localStorage.removeItem("pdschain_jwt_token");
      }
    } catch (e) {}
  }

  function handleUnauthorized() {
    if (typeof window.pdsLogout === "function") {
      window.pdsLogout();
    } else {
      try {
        localStorage.removeItem("pdschain_jwt_token");
        localStorage.removeItem("pds_role");
        localStorage.removeItem("pds_username");
        localStorage.removeItem("pdschain_user");
        sessionStorage.removeItem("pdschain-user");
        sessionStorage.clear();
      } catch (e) {}

      var path = window.location.pathname;
      if (path.includes("/admin/") || path.includes("/shop/") || path.includes("/warehouse/") || path.includes("/citizen/") || path.includes("/validator/")) {
        if (window.showToast) {
          window.showToast("Session expired. Please log in again.", "warning");
        }
        setTimeout(function () {
          window.location.replace("../login.html");
        }, 1000);
      }
    }
  }

  async function request(endpoint, options) {
    options = options || {};
    var activeBaseUrl = resolveApiBaseUrl();
    var url = endpoint.startsWith("http") ? endpoint : activeBaseUrl + (endpoint.startsWith("/") ? endpoint : "/" + endpoint);
    var token = getAuthToken();

    var headers = Object.assign({
      "Content-Type": "application/json",
      "Accept": "application/json"
    }, options.headers || {});

    if (token && !headers["Authorization"]) {
      headers["Authorization"] = "Bearer " + token;
    }

    var config = {
      method: options.method || "GET",
      headers: headers
    };

    if (options.body && (config.method === "POST" || config.method === "PUT" || config.method === "PATCH")) {
      config.body = typeof options.body === "string" ? options.body : JSON.stringify(options.body);
    }

    try {
      var response = await fetch(url, config);
      var data;
      try {
        data = await window.parsePDSJsonResponse(response);
      } catch (jsonErr) {
        data = { success: response.ok, statusText: response.statusText, message: jsonErr.message };
      }

      if (response.status === 401) {
        handleUnauthorized();
      }

      if (!response.ok) {
        var errorMsg = (data && data.message) ? data.message : "Request failed with status " + response.status;
        var err = new Error(errorMsg);
        err.status = response.status;
        err.data = data;
        throw err;
      }

      return data;
    } catch (networkErr) {
      if (networkErr.status) throw networkErr;
      console.warn("PDSChain API network failure for " + url + ":", networkErr.message);
      throw networkErr;
    }
  }

  window.PDSChainAPI = {
    get BASE_URL() {
      return resolveApiBaseUrl();
    },
    getToken: getAuthToken,
    setToken: setAuthToken,
    get: function (endpoint, options) {
      return request(endpoint, Object.assign({}, options, { method: "GET" }));
    },
    post: function (endpoint, body, options) {
      return request(endpoint, Object.assign({}, options, { method: "POST", body: body }));
    },
    put: function (endpoint, body, options) {
      return request(endpoint, Object.assign({}, options, { method: "PUT", body: body }));
    },
    delete: function (endpoint, options) {
      return request(endpoint, Object.assign({}, options, { method: "DELETE" }));
    }
  };

})();
