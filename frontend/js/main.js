/* ==========================================================
   PDSCHAIN — MAIN.JS
   Universal UI Engine: Modal Manager, Toast Notification Service,
   Theme Switcher, Responsive Sidebar, Dropdowns, Navigation Helpers,
   and Centralized Mock Data Engine.
   ========================================================== */

(function () {
  "use strict";

  /* ==========================================================
     UNIVERSAL AUTH GUARD & LOGOUT ENGINE
     ========================================================== */
  function enforcePageAuth() {
    var pathname = (window.location && window.location.pathname) ? window.location.pathname.toLowerCase() : "";
    var protectedRoutes = [
      { prefix: "/admin/", role: "admin" },
      { prefix: "/warehouse/", role: "warehouse" },
      { prefix: "/shop/", role: "shop" },
      { prefix: "/citizen/", role: "citizen" },
      { prefix: "/validator/", role: "validator" }
    ];
    var isSubPage = false;
    var requiredRole = null;
    for (var i = 0; i < protectedRoutes.length; i++) {
      if (pathname.indexOf(protectedRoutes[i].prefix) !== -1) {
        isSubPage = true;
        requiredRole = protectedRoutes[i].role;
        break;
      }
    }
    var isProtected = isSubPage || pathname.indexOf("profile.html") !== -1 || pathname.indexOf("settings.html") !== -1;
    if (!isProtected) return;

    var token = null;
    var role = null;
    try {
      token = localStorage.getItem("pdschain_jwt_token");
      role = (localStorage.getItem("pds_role") || "").toLowerCase().trim();
    } catch (e) {}

    var sessionUser = null;
    try {
      sessionUser = JSON.parse(sessionStorage.getItem("pdschain-user") || "null");
    } catch (e) {}

    // If neither JWT token nor valid session exists, immediately redirect to login
    if (!token && !sessionUser) {
      var target = isSubPage ? "../login.html" : "login.html";
      window.location.replace(target);
      return;
    }

    // Role-based access control: If role mismatch (except admin who can view all portals)
    if (requiredRole && role && role !== requiredRole && role !== "admin") {
      var target = isSubPage ? "../login.html" : "login.html";
      window.location.replace(target);
    }
  }

  // Execute auth guard immediately upon script load
  enforcePageAuth();

  // Re-verify on pageshow (handles browser Back button and bfcache restoration)
  window.addEventListener("pageshow", function () {
    enforcePageAuth();
  });

  window.pdsLogout = function (customRedirect) {
    try {
      localStorage.removeItem("pdschain_jwt_token");
      localStorage.removeItem("pds_role");
      localStorage.removeItem("pds_username");
      localStorage.removeItem("pdschain_user");
      localStorage.removeItem("pds_user_profile");
      sessionStorage.removeItem("pdschain-user");
      sessionStorage.clear();
    } catch (e) {}

    try {
      var apiBase = window.getPDSChainApiBase ? window.getPDSChainApiBase("api") : "http://localhost:3000/api";
      fetch(apiBase + "/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" }
      }).catch(function () {});
    } catch (e) {}

    if (window.showToast) {
      window.showToast("Signed out successfully.", "info");
    }

    var pathname = (window.location && window.location.pathname) ? window.location.pathname.toLowerCase() : "";
    var inSubfolder = pathname.indexOf("/admin/") !== -1 ||
                      pathname.indexOf("/warehouse/") !== -1 ||
                      pathname.indexOf("/shop/") !== -1 ||
                      pathname.indexOf("/citizen/") !== -1 ||
                      pathname.indexOf("/validator/") !== -1;
    var defaultTarget = inSubfolder ? "../login.html" : "login.html";
    var target = customRedirect || defaultTarget;

    setTimeout(function () {
      window.location.replace(target);
    }, 150);
  };

  // Universal click event delegation for any logout buttons or links
  document.addEventListener("click", function (e) {
    var btn = e.target && e.target.closest && e.target.closest(".logout-btn, [data-action='logout'], .btn-logout, #btn-logout, a[href*='logout']");
    if (btn) {
      e.preventDefault();
      e.stopPropagation();
      window.pdsLogout();
    }
  });

  // Global Mock Database for PDSChain Simulation (Now fetched from backend)
  window.PDSCHAIN_DATA = {
    beneficiaries: [], shops: [], warehouses: [], transactions: [], validators: [], blocks: []
  };

  var STATIC_DEV_PORTS = { "5500": true, "5501": true, "5502": true, "5503": true, "5173": true, "8080": true, "8000": true, "4200": true };

  function resolveBackendOrigin() {
    var configured = window.PDSCHAIN_API_URL;
    if (configured) {
      return String(configured).replace(/\/+$/, "").replace(/\/api(\/v1)?$/i, "");
    }
    if (window.PDSCHAIN_BACKEND_ORIGIN) {
      return String(window.PDSCHAIN_BACKEND_ORIGIN).replace(/\/+$/, "");
    }
    if (window.location && window.location.origin && window.location.origin.indexOf("http") === 0) {
      var port = String(window.location.port || "");
      var pathname = String(window.location.pathname || "").toLowerCase();
      if (!STATIC_DEV_PORTS[port] && pathname.indexOf("/frontend/") === -1) {
        return window.location.origin;
      }
    }
    return "http://localhost:3000";
  }

  window.getPDSChainApiBase = function (version) {
    var baseOrigin = resolveBackendOrigin();
    return baseOrigin + (version ? "/" + String(version).replace(/^\/+/, "") : "");
  };

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

  function tryLoadDataFromOrigin(originUrl) {
    try {
      var xhr = new XMLHttpRequest();
      xhr.open("GET", originUrl.replace(/\/+$/, "") + "/api/data", false);
      xhr.setRequestHeader("Accept", "application/json");
      xhr.send(null);
      var ctype = (xhr.getResponseHeader("content-type") || "").toLowerCase();
      var body = (xhr.responseText || "").trim();
      if (xhr.status === 200 && body.charAt(0) === "{" && (ctype.indexOf("application/json") !== -1 || !ctype)) {
        window.PDSCHAIN_DATA = JSON.parse(body);
        window.PDSCHAIN_BACKEND_ORIGIN = originUrl.replace(/\/+$/, "");
        console.log("Data loaded from backend API successfully.");
        return true;
      }
    } catch (e) {}
    return false;
  }

  var candidateOrigin = resolveBackendOrigin();
  if (!tryLoadDataFromOrigin(candidateOrigin)) {
    if (candidateOrigin !== "http://localhost:3000" && tryLoadDataFromOrigin("http://localhost:3000")) {
      window.PDSCHAIN_BACKEND_ORIGIN = "http://localhost:3000";
    } else {
      console.error("Failed to load data from backend, using empty data.");
    }
  }

  window.escapeHtml = function (str) {
    if (str === null || str === undefined) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  };

  /* ---------- Toast Notification Service ---------- */
  window.showToast = function (message, type) {
    type = type || "info";
    var stack = document.getElementById("toast-stack");
    if (!stack) {
      stack = document.createElement("div");
      stack.id = "toast-stack";
      stack.className = "toast-stack";
      document.body.appendChild(stack);
    }
    var toast = document.createElement("div");
    toast.className = "toast is-" + type;
    var iconClass = type === "success" ? "bi-check-circle-fill" :
                    type === "error" ? "bi-exclamation-triangle-fill" :
                    type === "warning" ? "bi-exclamation-circle-fill" : "bi-info-circle-fill";

    var icon = document.createElement("i");
    icon.className = "bi " + iconClass + " toast-icon";
    icon.setAttribute("aria-hidden", "true");

    var textDiv = document.createElement("div");
    textDiv.className = "toast-text";
    textDiv.textContent = message || "";

    var closeBtn = document.createElement("button");
    closeBtn.className = "toast-close";
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", "Close notification");
    closeBtn.innerHTML = '<i class="bi bi-x"></i>';
    closeBtn.addEventListener("click", function () {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    });

    toast.appendChild(icon);
    toast.appendChild(textDiv);
    toast.appendChild(closeBtn);

    var closeBtn = toast.querySelector(".toast-close");
    if (closeBtn) {
      closeBtn.addEventListener("click", function () {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      });
    }

    stack.appendChild(toast);

    setTimeout(function () {
      if (toast.parentNode) {
        toast.style.opacity = "0";
        toast.style.transform = "translateY(8px)";
        toast.style.transition = "all 0.3s ease";
        setTimeout(function () {
          if (toast.parentNode) toast.parentNode.removeChild(toast);
        }, 300);
      }
    }, 4200);
  };

  /* ---------- Modal Dialog Manager ---------- */
  window.openModal = function (modalId) {
    var modal = document.getElementById(modalId);
    if (!modal) return;
    modal.classList.add("is-open");
    document.body.style.overflow = "hidden";
    var firstInput = modal.querySelector("input, select, textarea, button:not(.modal-close)");
    if (firstInput) firstInput.focus();
  };

  window.closeModal = function (modalId) {
    var modal = document.getElementById(modalId);
    if (!modal) return;
    modal.classList.remove("is-open");
    if (!document.querySelector(".modal-backdrop.is-open")) {
      document.body.style.overflow = "";
    }
  };

  window.closeAllModals = function () {
    document.querySelectorAll(".modal-backdrop.is-open").forEach(function (m) {
      m.classList.remove("is-open");
    });
    document.body.style.overflow = "";
  };

  // Close modal when backdrop clicked or ESC pressed
  document.addEventListener("click", function (e) {
    if (e.target.classList && e.target.classList.contains("modal-backdrop")) {
      window.closeAllModals();
    }
    if (e.target.closest("[data-close-modal]")) {
      var modal = e.target.closest(".modal-backdrop");
      if (modal) window.closeModal(modal.id);
    }
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      window.closeAllModals();
    }
  });

  /* ---------- Navbar Scroll Effect ---------- */
  var navbar = document.querySelector(".navbar");
  if (navbar) {
    var checkScroll = function () {
      navbar.classList.toggle("is-scrolled", window.scrollY > 12);
    };
    checkScroll();
    window.addEventListener("scroll", checkScroll, { passive: true });
  }

  /* ---------- Mobile Navigation (Landing) ---------- */
  var navToggle = document.querySelector(".nav-toggle");
  var mobileDrawer = document.querySelector(".mobile-drawer");
  if (navToggle && mobileDrawer) {
    navToggle.addEventListener("click", function () {
      var isOpen = mobileDrawer.classList.toggle("is-open");
      navToggle.classList.toggle("is-open", isOpen);
      navToggle.setAttribute("aria-expanded", String(isOpen));
      document.body.style.overflow = isOpen ? "hidden" : "";
    });
  }

  /* ---------- Dashboard Sidebar & Drawer Toggle ---------- */
  var sidebarToggle = document.getElementById("sidebar-toggle");
  var drawerToggle = document.getElementById("drawer-toggle");
  var dashSidebar = document.getElementById("dash-sidebar");
  var dashShell = document.getElementById("dash-shell");
  var dashOverlay = document.getElementById("dash-overlay");

  if (sidebarToggle && dashShell) {
    sidebarToggle.addEventListener("click", function () {
      dashShell.classList.toggle("is-collapsed");
    });
  }

  if (drawerToggle && dashSidebar) {
    drawerToggle.addEventListener("click", function () {
      var isOpen = dashSidebar.classList.toggle("is-open");
      if (dashOverlay) dashOverlay.classList.toggle("is-open", isOpen);
      document.body.style.overflow = isOpen ? "hidden" : "";
    });
  }

  if (dashOverlay && dashSidebar) {
    dashOverlay.addEventListener("click", function () {
      dashSidebar.classList.remove("is-open");
      dashOverlay.classList.remove("is-open");
      document.body.style.overflow = "";
    });
  }

  /* ---------- Dropdown Toggles (Notifications & User menu) ---------- */
  document.querySelectorAll("[data-dropdown]").forEach(function (btn) {
    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      var targetId = btn.getAttribute("data-dropdown");
      var panel = document.getElementById(targetId);
      if (!panel) return;

      var isOpen = panel.classList.contains("is-open");
      // Close other dropdown panels
      document.querySelectorAll(".dropdown-panel.is-open").forEach(function (p) {
        if (p !== panel) p.classList.remove("is-open");
      });

      panel.classList.toggle("is-open", !isOpen);
      btn.setAttribute("aria-expanded", String(!isOpen));
    });
  });

  document.addEventListener("click", function () {
    document.querySelectorAll(".dropdown-panel.is-open").forEach(function (p) {
      p.classList.remove("is-open");
    });
  });

  /* ---------- Theme Switcher (Dark / Light) ---------- */
  var root = document.documentElement;
  var storedTheme = null;
  try { storedTheme = localStorage.getItem("pdschain-theme"); } catch (e) { storedTheme = null; }
  if (storedTheme) root.setAttribute("data-theme", storedTheme);

  document.querySelectorAll(".theme-toggle").forEach(function (toggle) {
    toggle.addEventListener("click", function () {
      var current = root.getAttribute("data-theme") === "light" ? "light" : "dark";
      var next = current === "light" ? "dark" : "light";
      if (next === "dark") {
        root.removeAttribute("data-theme");
      } else {
        root.setAttribute("data-theme", "light");
      }
      try { localStorage.setItem("pdschain-theme", next); } catch (e) { /* ignore */ }
    });
  });

  /* ---------- Active Sidebar Navigation Highlighter ---------- */
  var currentFile = window.location.pathname.split("/").pop() || "index.html";
  document.querySelectorAll(".sidebar-link").forEach(function (link) {
    var href = link.getAttribute("href");
    if (!href) return;
    var linkFile = href.split("/").pop();
    if (linkFile === currentFile && !href.startsWith("#")) {
      link.classList.add("is-active");
      link.setAttribute("aria-current", "page");
    }
  });

  /* ---------- Year Updater in Footers ---------- */
  var yearEl = document.getElementById("year");
  if (yearEl) yearEl.textContent = new Date().getFullYear();

})();
