/* ==========================================================
   PDSCHAIN — AUTH.JS
   Frontend Simulated Authentication & Role-Based Routing.
   Demo Credentials:
     - Admin:     admin / admin123
     - Shop:      shop / shop123
     - Warehouse: warehouse / warehouse123
     - Citizen:   citizen / citizen123
     - Validator: validator / validator123
   ========================================================== */

(function () {
  "use strict";

  function isDemoModeAllowed() {
    var isLocalHost = window.location && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
    // Under no circumstances can demo mode be active on non-local domains
    if (!isLocalHost) return false;
    return !!(window.PDSCHAIN_CONFIG && window.PDSCHAIN_CONFIG.DEMO_MODE === true);
  }

  var DEMO_USERS = {
    "admin": { password: "admin123", role: "admin", name: "Administrator", redirect: "admin/admin.html" },
    "shop": { password: "shop123", role: "shop", name: "FPS Officer (FPS-102)", redirect: "shop/shop.html" },
    "warehouse": { password: "warehouse123", role: "warehouse", name: "Warehouse Officer (WH-003)", redirect: "warehouse/warehouse.html" },
    "citizen": { password: "citizen123", role: "citizen", name: "Arun Kumar (BEN-1024)", redirect: "citizen/citizen.html" },
    "validator": { password: "validator123", role: "validator", validatorId: "VAL-07", shortValidatorId: "V7", name: "V7 (VAL-07) — Public Audit & Governance Node", redirect: "validator/validator.html" },
    // Legacy support
    "admin@pdschain.local": { password: "Admin@123", role: "admin", name: "Administrator", redirect: "admin/admin.html" }
  };

  var VALIDATOR_ORGS = [
    "Ministry of Consumer Affairs",
    "National Informatics Centre",
    "State Food Commission",
    "Civil Supplies Corporation",
    "District Administration Node",
    "Auditor General Observer Node",
    "Public Audit & Governance Node",
    "Regional Warehouse Authority",
    "Fair Price Shop Union Node",
    "State Monitoring Cell",
    "Citizen Oversight Organisation",
    "Security & Cryptography Validator"
  ];

  for (var vIdx = 1; vIdx <= 12; vIdx++) {
    var padNum = vIdx < 10 ? "0" + vIdx : "" + vIdx;
    var valId = "VAL-" + padNum;
    var shortId = "V" + vIdx;
    var vEntry = {
      password: "validator123",
      role: "validator",
      validatorId: valId,
      shortValidatorId: shortId,
      name: shortId + " (" + valId + ") — " + VALIDATOR_ORGS[vIdx - 1],
      redirect: "validator/validator.html"
    };
    DEMO_USERS["v" + vIdx] = vEntry;
    DEMO_USERS["val-" + padNum] = vEntry;
    DEMO_USERS["validator" + vIdx] = vEntry;
  }

  /* Password visibility toggle buttons */
  document.querySelectorAll("[data-toggle-password]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var targetId = btn.getAttribute("data-toggle-password");
      var input = document.getElementById(targetId);
      if (!input) return;
      var isPw = input.type === "password";
      input.type = isPw ? "text" : "password";
      var icon = btn.querySelector("i");
      if (icon) {
        icon.classList.toggle("bi-eye", !isPw);
        icon.classList.toggle("bi-eye-slash", isPw);
      }
    });
  });

  /* Field status indicator helpers */
  function setFieldState(input, state, msg) {
    if (!input) return;
    var group = input.closest(".form-group");
    if (!group) return;
    group.classList.remove("is-valid", "is-invalid");
    var hint = group.querySelector(".form-hint");
    if (state === "valid") {
      group.classList.add("is-valid");
      if (hint) {
        hint.replaceChildren();
        var icon = document.createElement("i");
        icon.className = "bi bi-check-circle-fill";
        icon.setAttribute("aria-hidden", "true");
        hint.appendChild(icon);
        hint.appendChild(document.createTextNode(" " + (msg || "Looks good.")));
      }
    } else if (state === "invalid") {
      group.classList.add("is-invalid");
      if (hint) {
        hint.replaceChildren();
        var icon = document.createElement("i");
        icon.className = "bi bi-exclamation-circle-fill";
        icon.setAttribute("aria-hidden", "true");
        hint.appendChild(icon);
        hint.appendChild(document.createTextNode(" " + (msg || "Please check this field.")));
      }
    } else if (hint) {
      hint.textContent = msg || "";
    }
  }

  /* ==========================================================
     LOGIN FORM HANDLING
     ========================================================== */
  var loginForm = document.getElementById("login-form");
  if (loginForm) {
    var idInput = document.getElementById("login-id");
    var pwInput = document.getElementById("login-password");
    var roleSelect = document.getElementById("login-role");
    var statusBox = document.getElementById("login-status");
    var submitBtn = document.getElementById("login-submit");

    // Quick prefill helper when role is changed (restricted to local demo environment)
    if (roleSelect && idInput && pwInput) {
      roleSelect.addEventListener("change", function () {
        var selectedRole = roleSelect.value;
        var isLocal = window.location && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
        if (isLocal && DEMO_USERS[selectedRole]) {
          idInput.value = selectedRole;
          pwInput.value = DEMO_USERS[selectedRole].password;
          if (statusBox) statusBox.hidden = true;
        }
      });

      // Check URL query param ?validator=v1 or ?role=v1 for quick validator switching
      try {
        var params = new URLSearchParams(window.location.search);
        var qVal = (params.get("validator") || params.get("role") || "").toLowerCase();
        var isLocalHost = window.location && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
        if (isLocalHost && qVal && DEMO_USERS[qVal]) {
          roleSelect.value = qVal;
          idInput.value = qVal;
          pwInput.value = DEMO_USERS[qVal].password;
        }
      } catch (e) {}
    }

    loginForm.addEventListener("submit", function (e) {
      e.preventDefault();
      if (statusBox) statusBox.hidden = true;

      var username = (idInput ? idInput.value.trim().toLowerCase() : "");
      var password = (pwInput ? pwInput.value : "");
      var selectedRole = (roleSelect ? roleSelect.value : "");

      var isValid = true;
      if (!username) {
        setFieldState(idInput, "invalid", "Enter username or email.");
        isValid = false;
      } else {
        setFieldState(idInput, "valid", "");
      }

      if (!password) {
        setFieldState(pwInput, "invalid", "Password is required.");
        isValid = false;
      } else {
        setFieldState(pwInput, "valid", "");
      }

      if (!isValid) return;

      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.classList.add("btn-loading");
      }

      // Try Backend API First
      fetch((window.getPDSChainApiBase ? window.getPDSChainApiBase("api") : "http://localhost:3000/api") + "/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username, password: password })
      })
      .then(function (res) { return window.parsePDSJsonResponse ? window.parsePDSJsonResponse(res) : res.json(); })
      .then(function (resData) {
        if (resData.success && resData.token) {
          localStorage.setItem("pdschain_jwt_token", resData.token);
          var effectiveRole = ((resData.user && resData.user.role) || "citizen").toLowerCase();
          var destination = effectiveRole + "/" + effectiveRole + ".html";
          if (effectiveRole === "admin") destination = "admin/admin.html";

          var validatorId = (resData.user && (resData.user.validatorId || resData.user.entityId)) || null;
          var shortValidatorId = (resData.user && resData.user.shortValidatorId) || null;

          localStorage.setItem("pds_role", effectiveRole);
          localStorage.setItem("pds_username", resData.user.username);
          if (validatorId) {
            localStorage.setItem("pds_validator_id", validatorId);
          } else {
            localStorage.removeItem("pds_validator_id");
          }
          if (shortValidatorId) {
            localStorage.setItem("pds_short_validator_id", shortValidatorId);
          } else {
            localStorage.removeItem("pds_short_validator_id");
          }

          var userPayload = {
            username: resData.user.username,
            role: effectiveRole,
            name: resData.user.name,
            entityId: resData.user.entityId,
            validatorId: validatorId,
            shortValidatorId: shortValidatorId
          };
          localStorage.setItem("pdschain_user", JSON.stringify(userPayload));
          sessionStorage.setItem("pdschain-user", JSON.stringify(Object.assign({}, userPayload, {
            timestamp: new Date().toISOString()
          })));

          if (statusBox) {
            statusBox.hidden = false;
            statusBox.className = "form-status is-success";
            statusBox.replaceChildren();
            var okIcon = document.createElement("i");
            okIcon.className = "bi bi-check-circle-fill";
            statusBox.appendChild(okIcon);
            var labelText = shortValidatorId
              ? shortValidatorId + " (" + validatorId + ")"
              : effectiveRole.toUpperCase();
            statusBox.appendChild(document.createTextNode(" Authenticated as " + labelText + ". Redirecting to dashboard…"));
          }

          setTimeout(function () { window.location.href = destination; }, 500);
        } else {
          throw new Error(resData.message || "Invalid credentials");
        }
      })
      .catch(function (apiErr) {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.classList.remove("btn-loading");
        }

        // Check if explicit demo mode is enabled (allowed only in local dev/test)
        if (isDemoModeAllowed()) {
          var user = DEMO_USERS[username];
          if (user && user.password === password) {
            var effectiveRole = user.role || "citizen";
            var destination = user.redirect;

            localStorage.setItem("pds_role", effectiveRole);
            localStorage.setItem("pds_username", username);
            if (user.validatorId) localStorage.setItem("pds_validator_id", user.validatorId);
            if (user.shortValidatorId) localStorage.setItem("pds_short_validator_id", user.shortValidatorId);
            localStorage.setItem("pdschain_user", JSON.stringify({
              username: username,
              role: effectiveRole,
              name: user.name,
              validatorId: user.validatorId || null,
              shortValidatorId: user.shortValidatorId || null
            }));
            sessionStorage.setItem("pdschain-user", JSON.stringify({
              username: username,
              role: effectiveRole,
              name: user.name,
              validatorId: user.validatorId || null,
              shortValidatorId: user.shortValidatorId || null,
              isDemoMode: true,
              timestamp: new Date().toISOString()
            }));

            if (statusBox) {
              statusBox.hidden = false;
              statusBox.className = "form-status is-warning";
              statusBox.replaceChildren();
              var warnIcon = document.createElement("i");
              warnIcon.className = "bi bi-shield-exclamation";
              statusBox.appendChild(warnIcon);
              statusBox.appendChild(document.createTextNode(" [DEMO/OFFLINE MODE] Authenticated locally. Redirecting to " + effectiveRole.toUpperCase() + "…"));
            }

            setTimeout(function () { window.location.href = destination; }, 800);
            return;
          }
        }

        // Normal mode (or invalid demo credentials): Reject without fallback or redirect
        if (statusBox) {
          statusBox.hidden = false;
          statusBox.className = "form-status is-error";
          statusBox.replaceChildren();
          var errIcon = document.createElement("i");
          errIcon.className = "bi bi-exclamation-triangle-fill";
          statusBox.appendChild(errIcon);
          statusBox.appendChild(document.createTextNode(" " + (apiErr.message || "Login failed. Unable to authenticate with PDSChain backend.")));
        }
      });
    });

    // Forgot password trigger
    var forgotLinks = document.querySelectorAll(".link-muted");
    forgotLinks.forEach(function (link) {
      if (link.textContent.toLowerCase().includes("forgot")) {
        link.addEventListener("click", function (ev) {
          ev.preventDefault();
          if (window.showToast) {
            window.showToast("This feature will be connected to the backend.", "info");
          } else {
            alert("This feature will be connected to the backend.");
          }
        });
      }
    });
  }

  /* ==========================================================
     REGISTER FORM HANDLING
     ========================================================== */
  var regForm = document.getElementById("register-form");
  if (regForm) {
    var regName = document.getElementById("reg-name");
    var regEmail = document.getElementById("reg-email");
    var regPhone = document.getElementById("reg-phone");
    var regPw = document.getElementById("reg-password");
    var regConfirm = document.getElementById("reg-confirm");
    var regStatus = document.getElementById("register-status");
    var regBtn = document.getElementById("register-submit");

    regForm.addEventListener("submit", function (e) {
      e.preventDefault();
      if (regStatus) regStatus.hidden = true;

      var nameVal = regName ? regName.value.trim() : "";
      var emailVal = regEmail ? regEmail.value.trim() : "";
      var phoneVal = regPhone ? regPhone.value.trim() : "";
      var pwVal = regPw ? regPw.value : "";
      var confirmVal = regConfirm ? regConfirm.value : "";

      var valid = true;

      if (!nameVal || nameVal.length < 2) {
        setFieldState(regName, "invalid", "Full name is required.");
        valid = false;
      } else {
        setFieldState(regName, "valid", "");
      }

      var emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailVal || !emailPattern.test(emailVal)) {
        setFieldState(regEmail, "invalid", "Enter a valid email address.");
        valid = false;
      } else {
        setFieldState(regEmail, "valid", "");
      }

      if (!phoneVal || phoneVal.length < 7) {
        setFieldState(regPhone, "invalid", "Enter a valid contact phone number.");
        valid = false;
      } else {
        setFieldState(regPhone, "valid", "");
      }

      if (!pwVal || pwVal.length < 6) {
        setFieldState(regPw, "invalid", "Password must be at least 6 characters.");
        valid = false;
      } else {
        setFieldState(regPw, "valid", "");
      }

      if (pwVal !== confirmVal) {
        setFieldState(regConfirm, "invalid", "Passwords do not match.");
        valid = false;
      } else {
        setFieldState(regConfirm, "valid", "");
      }

      if (!valid) {
        if (regStatus) {
          regStatus.hidden = false;
          regStatus.className = "form-status is-error";
          regStatus.replaceChildren();
          var warnIcon = document.createElement("i");
          warnIcon.className = "bi bi-exclamation-triangle-fill";
          regStatus.appendChild(warnIcon);
          regStatus.appendChild(document.createTextNode(" Please complete all required fields correctly."));
        }
        return;
      }

      if (regBtn) {
        regBtn.disabled = true;
        regBtn.classList.add("btn-loading");
      }

      var usernameFromEmail = emailVal.split("@")[0].toLowerCase().replace(/[^a-z0-9_]/g, "");

      fetch((window.getPDSChainApiBase ? window.getPDSChainApiBase("api") : "http://localhost:3000/api") + "/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: usernameFromEmail || nameVal.toLowerCase().replace(/\s+/g, ""),
          name: nameVal,
          email: emailVal,
          password: pwVal,
          role: "CITIZEN"
        })
      })
      .then(function (res) { return window.parsePDSJsonResponse ? window.parsePDSJsonResponse(res) : res.json(); })
      .then(function (resData) {
        if (resData.success) {
          if (regStatus) {
            regStatus.hidden = false;
            regStatus.className = "form-status is-success";
            regStatus.replaceChildren();
            var okIcon = document.createElement("i");
            okIcon.className = "bi bi-check-circle-fill";
            regStatus.appendChild(okIcon);
            regStatus.appendChild(document.createTextNode(" Citizen account registered successfully! Redirecting to login…"));
          }
          if (window.showToast) {
            window.showToast("Account registered! Redirecting to login...", "success");
          }
          setTimeout(function () {
            window.location.href = "login.html";
          }, 1200);
        } else {
          throw new Error(resData.message || (resData.errors && resData.errors[0]) || "Registration failed");
        }
      })
      .catch(function (err) {
        if (regBtn) {
          regBtn.disabled = false;
          regBtn.classList.remove("btn-loading");
        }
        if (regStatus) {
          regStatus.hidden = false;
          regStatus.className = "form-status is-error";
          regStatus.replaceChildren();
          var errIcon = document.createElement("i");
          errIcon.className = "bi bi-exclamation-triangle-fill";
          regStatus.appendChild(errIcon);
          regStatus.appendChild(document.createTextNode(" " + (err.message || "Registration failed. Please check inputs.")));
        }
      });
    });
  }

  /* ==========================================================
     LOGOUT HANDLER
     ========================================================== */
  document.querySelectorAll(".logout-btn, [data-action='logout']").forEach(function (btn) {
    btn.addEventListener("click", function (e) {
      e.preventDefault();
      if (typeof window.pdsLogout === "function") {
        window.pdsLogout();
      } else {
        try {
          localStorage.removeItem("pdschain_jwt_token");
          localStorage.removeItem("pds_role");
          localStorage.removeItem("pds_username");
          localStorage.removeItem("pdschain_user");
          localStorage.removeItem("pds_user_profile");
          sessionStorage.removeItem("pdschain-user");
          sessionStorage.clear();
        } catch (err) {}
        var inSubfolder = window.location.pathname.includes("/admin/") ||
                          window.location.pathname.includes("/warehouse/") ||
                          window.location.pathname.includes("/shop/") ||
                          window.location.pathname.includes("/citizen/") ||
                          window.location.pathname.includes("/validator/");
        window.location.replace(inSubfolder ? "../login.html" : "login.html");
      }
    });
  });

  /* ==========================================================
     PROFILE EDIT FORM HANDLER (profile.html)
     ========================================================== */
  var profileEditForm = document.getElementById("profile-edit-form");
  if (profileEditForm) {
    var profName = document.getElementById("prof-name");
    var profEmail = document.getElementById("prof-email");
    var profPhone = document.getElementById("prof-phone");

    // Prepopulate if saved in localStorage
    try {
      var savedProfile = JSON.parse(localStorage.getItem("pds_user_profile") || "null");
      if (savedProfile) {
        if (profName && savedProfile.name) profName.value = savedProfile.name;
        if (profEmail && savedProfile.email) profEmail.value = savedProfile.email;
        if (profPhone && savedProfile.phone) profPhone.value = savedProfile.phone;
      }
    } catch (e) {}

    profileEditForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var nameVal = profName ? profName.value.trim() : "";
      var emailVal = profEmail ? profEmail.value.trim() : "";
      var phoneVal = profPhone ? profPhone.value.trim() : "";

      var profileData = {
        name: nameVal,
        email: emailVal,
        phone: phoneVal,
        updatedAt: new Date().toISOString()
      };

      localStorage.setItem("pds_user_profile", JSON.stringify(profileData));
      if (window.showToast) {
        window.showToast("Personal profile changes saved to storage successfully!", "success");
      }
    });
  }

})();
