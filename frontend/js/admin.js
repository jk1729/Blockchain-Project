/* ==========================================================
   PDSCHAIN — ADMIN.JS
   Administrator functionality: Beneficiary CRUD modals,
   Shop & Warehouse management, Transactions filter,
   Validator matrix, and Report generation with CSV export.
   ========================================================== */

(function () {
  "use strict";

  function escapeHtml(str) {
    if (str === null || str === undefined) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  var data = window.PDSCHAIN_DATA || { beneficiaries: [], shops: [], warehouses: [], transactions: [], validators: [] };

  /* ==========================================================
     1. ADMIN BENEFICIARIES PAGE
     ========================================================== */
  var benTableBody = document.getElementById("admin-beneficiaries-body");
  var benSearchInput = document.getElementById("beneficiary-search");
  var benRegionFilter = document.getElementById("beneficiary-region-filter");
  var benStatusFilter = document.getElementById("beneficiary-status-filter");

  function renderBeneficiaries() {
    if (!benTableBody) return;
    var q = benSearchInput ? benSearchInput.value.toLowerCase().trim() : "";
    var region = benRegionFilter ? benRegionFilter.value : "";
    var status = benStatusFilter ? benStatusFilter.value : "";

    var filtered = data.beneficiaries.filter(function (b) {
      var matchesQ = !q || b.id.toLowerCase().includes(q) || b.name.toLowerCase().includes(q);
      var matchesR = !region || b.region === region;
      var matchesS = !status || b.status === status;
      return matchesQ && matchesR && matchesS;
    });

    if (filtered.length === 0) {
      benTableBody.innerHTML = '<tr><td colspan="8" class="text-center muted" style="padding:32px;">No beneficiaries match your search criteria.</td></tr>';
      return;
    }

    benTableBody.innerHTML = filtered.map(function (b) {
      var statusClass = b.status === "Active" ? "badge badge-success" : "badge badge-danger";
      return '<tr>' +
        '<td><span class="mono font-bold">' + escapeHtml(b.id) + '</span></td>' +
        '<td><strong>' + escapeHtml(b.name) + '</strong></td>' +
        '<td>' + escapeHtml(b.region) + '</td>' +
        '<td>' + escapeHtml(b.household) + ' Members</td>' +
        '<td>Rice ' + escapeHtml(b.quotaRice) + 'kg, Wheat ' + escapeHtml(b.quotaWheat) + 'kg</td>' +
        '<td><span class="' + statusClass + '">' + escapeHtml(b.status) + '</span></td>' +
        '<td>' + escapeHtml(b.lastDist) + '</td>' +
        '<td>' +
          '<div class="table-actions-cell">' +
            '<button class="btn-action-sm" onclick="viewBeneficiary(\'' + escapeHtml(b.id) + '\')"><i class="bi bi-eye"></i> View</button>' +
            '<button class="btn-action-sm" onclick="editBeneficiary(\'' + escapeHtml(b.id) + '\')"><i class="bi bi-pencil"></i> Edit</button>' +
            '<button class="btn-action-sm is-danger" onclick="toggleSuspendBeneficiary(\'' + escapeHtml(b.id) + '\')"><i class="bi bi-slash-circle"></i></button>' +
          '</div>' +
        '</td>' +
      '</tr>';
    }).join("");
  }

  if (benSearchInput) benSearchInput.addEventListener("input", renderBeneficiaries);
  if (benRegionFilter) benRegionFilter.addEventListener("change", renderBeneficiaries);
  if (benStatusFilter) benStatusFilter.addEventListener("change", renderBeneficiaries);
  renderBeneficiaries();

  // Beneficiary Modals
  window.viewBeneficiary = function (id) {
    var b = data.beneficiaries.find(function (item) { return item.id === id; });
    if (!b) return;
    var body = document.getElementById("view-beneficiary-content");
    if (body) {
      body.innerHTML =
        '<div class="receipt-details">' +
          '<div class="receipt-row"><span class="label">Beneficiary ID:</span><span class="val mono">' + escapeHtml(b.id) + '</span></div>' +
          '<div class="receipt-row"><span class="label">Full Name:</span><span class="val">' + escapeHtml(b.name) + '</span></div>' +
          '<div class="receipt-row"><span class="label">Region:</span><span class="val">' + escapeHtml(b.region) + '</span></div>' +
          '<div class="receipt-row"><span class="label">Household Size:</span><span class="val">' + escapeHtml(b.household) + ' persons</span></div>' +
          '<div class="receipt-row"><span class="label">Monthly Entitlement:</span><span class="val">Rice: ' + escapeHtml(b.quotaRice) + 'kg, Wheat: ' + escapeHtml(b.quotaWheat) + 'kg, Sugar: ' + escapeHtml(b.quotaSugar) + 'kg</span></div>' +
          '<div class="receipt-row"><span class="label">Status:</span><span class="val">' + escapeHtml(b.status) + '</span></div>' +
          '<div class="receipt-row"><span class="label">Last Distribution:</span><span class="val">' + escapeHtml(b.lastDist) + '</span></div>' +
        '</div>';
    }
    window.openModal("modal-view-beneficiary");
  };

  window.editBeneficiary = function (id) {
    var b = data.beneficiaries.find(function (item) { return item.id === id; });
    if (!b) return;
    var idField = document.getElementById("edit-ben-id");
    var nameField = document.getElementById("edit-ben-name");
    var regionField = document.getElementById("edit-ben-region");
    var sizeField = document.getElementById("edit-ben-size");

    if (idField) idField.value = b.id;
    if (nameField) nameField.value = b.name;
    if (regionField) regionField.value = b.region;
    if (sizeField) sizeField.value = b.household;

    window.openModal("modal-edit-beneficiary");
  };

  window.toggleSuspendBeneficiary = function (id) {
    var b = data.beneficiaries.find(function (item) { return item.id === id; });
    if (!b) return;
    b.status = b.status === "Active" ? "Suspended" : "Active";
    renderBeneficiaries();
    if (window.showToast) {
      window.showToast("Beneficiary " + id + " status changed to: " + b.status, b.status === "Active" ? "success" : "warning");
    }
  };

  // Add Beneficiary Form
  var addBenForm = document.getElementById("form-add-beneficiary");
  if (addBenForm) {
    addBenForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var name = document.getElementById("add-ben-name").value.trim();
      var region = document.getElementById("add-ben-region").value;
      var size = parseInt(document.getElementById("add-ben-size").value || "4", 10);
      var newId = "BEN-" + (1050 + data.beneficiaries.length);

      data.beneficiaries.unshift({
        id: newId,
        name: name,
        region: region,
        household: size,
        quotaRice: size * 5,
        quotaWheat: size * 2.5,
        quotaSugar: 2,
        quotaPulses: 2,
        status: "Active",
        lastDist: "None"
      });

      window.closeModal("modal-add-beneficiary");
      renderBeneficiaries();
      addBenForm.reset();
      if (window.showToast) window.showToast("Beneficiary " + newId + " added successfully!", "success");
    });
  }

  // Save Edit Beneficiary Form
  var editBenForm = document.getElementById("form-edit-beneficiary");
  if (editBenForm) {
    editBenForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var id = document.getElementById("edit-ben-id").value;
      var b = data.beneficiaries.find(function (item) { return item.id === id; });
      if (b) {
        b.name = document.getElementById("edit-ben-name").value.trim();
        b.region = document.getElementById("edit-ben-region").value;
        b.household = parseInt(document.getElementById("edit-ben-size").value || "4", 10);
      }
      window.closeModal("modal-edit-beneficiary");
      renderBeneficiaries();
      if (window.showToast) window.showToast("Beneficiary details updated.", "success");
    });
  }

  /* ==========================================================
     2. ADMIN SHOPS PAGE
     ========================================================== */
  var shopTableBody = document.getElementById("admin-shops-body");
  var shopSearch = document.getElementById("shop-search");

  function renderShops() {
    if (!shopTableBody) return;
    var query = shopSearch ? shopSearch.value.toLowerCase().trim() : "";
    var filtered = data.shops.filter(function (s) {
      return !query || s.id.toLowerCase().includes(query) || s.name.toLowerCase().includes(query) || s.region.toLowerCase().includes(query);
    });

    shopTableBody.innerHTML = filtered.map(function (s) {
      return '<tr>' +
        '<td><span class="mono font-bold">' + escapeHtml(s.id) + '</span></td>' +
        '<td><strong>' + escapeHtml(s.name) + '</strong></td>' +
        '<td>' + escapeHtml(s.region) + '</td>' +
        '<td>' + escapeHtml(s.manager) + '</td>' +
        '<td><span class="badge badge-success">' + escapeHtml(s.stockHealth) + '</span></td>' +
        '<td>' + escapeHtml(s.beneficiaries) + '</td>' +
        '<td><span class="badge badge-success">' + escapeHtml(s.status) + '</span></td>' +
        '<td>' +
          '<div class="table-actions-cell">' +
            '<button class="btn-action-sm" onclick="viewShop(\'' + escapeHtml(s.id) + '\')"><i class="bi bi-eye"></i> View</button>' +
            '<button class="btn-action-sm" onclick="editShop(\'' + escapeHtml(s.id) + '\')"><i class="bi bi-pencil"></i> Edit</button>' +
          '</div>' +
        '</td>' +
      '</tr>';
    }).join("");
  }
  if (shopSearch) shopSearch.addEventListener("input", renderShops);
  renderShops();

  window.viewShop = function (id) {
    var s = data.shops.find(function (item) { return item.id === id; });
    if (!s) return;
    var body = document.getElementById("view-shop-content");
    if (body) {
      body.innerHTML =
        '<div class="receipt-details">' +
          '<div class="receipt-row"><span class="label">Shop ID:</span><span class="val mono">' + escapeHtml(s.id) + '</span></div>' +
          '<div class="receipt-row"><span class="label">Name:</span><span class="val">' + escapeHtml(s.name) + '</span></div>' +
          '<div class="receipt-row"><span class="label">Region:</span><span class="val">' + escapeHtml(s.region) + '</span></div>' +
          '<div class="receipt-row"><span class="label">Manager:</span><span class="val">' + escapeHtml(s.manager) + '</span></div>' +
          '<div class="receipt-row"><span class="label">Registered Beneficiaries:</span><span class="val">' + escapeHtml(s.beneficiaries) + '</span></div>' +
          '<div class="receipt-row"><span class="label">Inventory Status:</span><span class="val">' + escapeHtml(s.stockHealth) + '</span></div>' +
        '</div>';
    }
    window.openModal("modal-view-shop");
  };

  /* ==========================================================
     3. ADMIN WAREHOUSES PAGE
     ========================================================== */
  var whTableBody = document.getElementById("admin-warehouses-body");
  function renderWarehouses() {
    if (!whTableBody) return;
    whTableBody.innerHTML = data.warehouses.map(function (w) {
      var badgeClass = w.status === "Operational" ? "badge badge-success" : "badge badge-warning";
      return '<tr>' +
        '<td><span class="mono font-bold">' + escapeHtml(w.id) + '</span></td>' +
        '<td><strong>' + escapeHtml(w.name) + '</strong></td>' +
        '<td>' + escapeHtml(w.location) + '</td>' +
        '<td>' + escapeHtml(w.capacity) + '</td>' +
        '<td>' + escapeHtml(w.currentStock) + '</td>' +
        '<td><div class="progress-track" style="width:100px;display:inline-block;vertical-align:middle;margin-right:8px;"><div class="progress-fill ' + (w.utilization < 30 ? 'is-warning' : '') + '" style="width:' + escapeHtml(w.utilization) + '%;"></div></div>' + escapeHtml(w.utilization) + '%</td>' +
        '<td><span class="' + badgeClass + '">' + escapeHtml(w.status) + '</span></td>' +
        '<td><button class="btn-action-sm" onclick="viewWarehouse(\'' + escapeHtml(w.id) + '\')"><i class="bi bi-eye"></i> Details</button></td>' +
      '</tr>';
    }).join("");
  }
  renderWarehouses();

  window.viewWarehouse = function (id) {
    var w = data.warehouses.find(function (item) { return item.id === id; });
    if (!w) return;
    var body = document.getElementById("view-warehouse-content");
    if (body) {
      body.innerHTML =
        '<div class="receipt-details">' +
          '<div class="receipt-row"><span class="label">Warehouse ID:</span><span class="val mono">' + escapeHtml(w.id) + '</span></div>' +
          '<div class="receipt-row"><span class="label">Facility:</span><span class="val">' + escapeHtml(w.name) + '</span></div>' +
          '<div class="receipt-row"><span class="label">Location:</span><span class="val">' + escapeHtml(w.location) + '</span></div>' +
          '<div class="receipt-row"><span class="label">Storage Capacity:</span><span class="val">' + escapeHtml(w.capacity) + '</span></div>' +
          '<div class="receipt-row"><span class="label">Current Stock:</span><span class="val">' + escapeHtml(w.currentStock) + '</span></div>' +
          '<div class="receipt-row"><span class="label">Utilization:</span><span class="val">' + escapeHtml(w.utilization) + '%</span></div>' +
        '</div>';
    }
    window.openModal("modal-view-warehouse");
  };

  /* ==========================================================
     4. ADMIN TRANSACTIONS PAGE
     ========================================================== */
  var txTableBody = document.getElementById("admin-tx-body");
  var txSearch = document.getElementById("tx-search");
  var txCommodity = document.getElementById("tx-commodity-filter");
  var txStatus = document.getElementById("tx-status-filter");

  function renderTransactions() {
    if (!txTableBody) return;
    var q = txSearch ? txSearch.value.toLowerCase().trim() : "";
    var c = txCommodity ? txCommodity.value : "";
    var s = txStatus ? txStatus.value : "";

    var filtered = data.transactions.filter(function (t) {
      var matchesQ = !q || t.id.toLowerCase().includes(q) || t.beneficiary.toLowerCase().includes(q) || (t.name && t.name.toLowerCase().includes(q));
      var matchesC = !c || t.commodity === c;
      var matchesS = !s || t.status === s;
      return matchesQ && matchesC && matchesS;
    });

    txTableBody.innerHTML = filtered.map(function (t) {
      var badgeClass = t.status === "Verified" ? "badge badge-success" : "badge badge-warning";
      return '<tr>' +
        '<td><span class="mono font-bold">' + escapeHtml(t.id) + '</span></td>' +
        '<td>' + escapeHtml(t.beneficiary) + ' (' + escapeHtml(t.name || 'Citizen') + ')</td>' +
        '<td>' + escapeHtml(t.shop) + '</td>' +
        '<td>' + escapeHtml(t.commodity) + '</td>' +
        '<td><strong>' + escapeHtml(t.qty) + '</strong></td>' +
        '<td><span class="mono">' + escapeHtml(t.block) + '</span></td>' +
        '<td><span class="badge badge-info">' + escapeHtml(t.validators) + '/12</span></td>' +
        '<td><span class="' + badgeClass + '">' + escapeHtml(t.status) + '</span></td>' +
        '<td><span class="muted">' + escapeHtml(t.time) + '</span></td>' +
        '<td><button class="btn-action-sm" onclick="viewTransaction(\'' + escapeHtml(t.id) + '\')"><i class="bi bi-eye"></i></button></td>' +
      '</tr>';
    }).join("");
  }

  if (txSearch) txSearch.addEventListener("input", renderTransactions);
  if (txCommodity) txCommodity.addEventListener("change", renderTransactions);
  if (txStatus) txStatus.addEventListener("change", renderTransactions);
  renderTransactions();

  window.viewTransaction = function (id) {
    var t = data.transactions.find(function (item) { return item.id === id; });
    if (!t) return;
    var body = document.getElementById("view-tx-content");
    if (body) {
      body.innerHTML =
        '<div class="receipt-details">' +
          '<div class="receipt-row"><span class="label">Transaction ID:</span><span class="val mono">' + escapeHtml(t.id) + '</span></div>' +
          '<div class="receipt-row"><span class="label">Beneficiary:</span><span class="val">' + escapeHtml(t.beneficiary) + ' (' + escapeHtml(t.name || '') + ')</span></div>' +
          '<div class="receipt-row"><span class="label">Fair Price Shop:</span><span class="val">' + escapeHtml(t.shop) + '</span></div>' +
          '<div class="receipt-row"><span class="label">Commodity &amp; Quantity:</span><span class="val">' + escapeHtml(t.commodity) + ' — ' + escapeHtml(t.qty) + '</span></div>' +
          '<div class="receipt-row"><span class="label">Block:</span><span class="val mono">' + escapeHtml(t.block) + '</span></div>' +
          '<div class="receipt-row"><span class="label">Cryptographic Hash:</span><span class="val mono">' + escapeHtml(t.hash) + '</span></div>' +
          '<div class="receipt-row"><span class="label">Validators Agreed:</span><span class="val">' + escapeHtml(t.validators) + ' / 12 Nodes</span></div>' +
          '<div class="receipt-row"><span class="label">Timestamp:</span><span class="val">' + escapeHtml(t.time) + '</span></div>' +
        '</div>';
    }
    window.openModal("modal-view-tx");
  };

  /* ==========================================================
     5. ADMIN VALIDATORS PAGE
     ========================================================== */
  var valTableBody = document.getElementById("admin-validators-body");
  if (valTableBody) {
    valTableBody.innerHTML = data.validators.map(function (v) {
      return '<tr>' +
        '<td><span class="mono font-bold">' + escapeHtml(v.id) + '</span></td>' +
        '<td><strong>' + escapeHtml(v.org) + '</strong></td>' +
        '<td><span class="badge badge-success"><i class="bi bi-check-circle-fill"></i> ' + escapeHtml(v.status) + '</span></td>' +
        '<td><span class="mono">#' + escapeHtml(v.blockHeight) + '</span></td>' +
        '<td>' + escapeHtml(v.heartbeat) + '</td>' +
        '<td>' + escapeHtml(v.txValidated.toLocaleString()) + '</td>' +
        '<td><span class="badge badge-info">' + escapeHtml(v.participation) + '</span></td>' +
      '</tr>';
    }).join("");
  }

  /* ==========================================================
     6. ADMIN REPORTS PAGE (Simulated CSV Export)
     ========================================================== */
  window.generateReport = function (type) {
    if (window.showToast) {
      window.showToast("Generating " + type + " report...", "info");
    }
    setTimeout(function () {
      if (window.showToast) {
        window.showToast(type + " report compiled successfully.", "success");
      }
    }, 800);
  };

  window.previewReport = function (type) {
    var titleEl = document.getElementById("report-preview-title");
    var bodyEl = document.getElementById("report-preview-body");
    if (titleEl) titleEl.textContent = type + " Preview";
    if (bodyEl) {
      bodyEl.innerHTML =
        '<p class="muted" style="margin-bottom:14px;">Showing top 5 sample entries for ' + type + ':</p>' +
        '<div class="table-wrap"><table class="data-table"><thead><tr><th>ID</th><th>Entity</th><th>Item/Metric</th><th>Timestamp</th><th>Status</th></tr></thead>' +
        '<tbody>' +
        '<tr><td class="mono">REC-01</td><td>Chennai Hub</td><td>Rice · 500 KG</td><td>Today 09:30</td><td><span class="badge badge-success">Verified</span></td></tr>' +
        '<tr><td class="mono">REC-02</td><td>FPS-102</td><td>Wheat · 380 KG</td><td>Today 08:45</td><td><span class="badge badge-success">Verified</span></td></tr>' +
        '<tr><td class="mono">REC-03</td><td>FPS-118</td><td>Sugar · 120 KG</td><td>Yesterday</td><td><span class="badge badge-success">Verified</span></td></tr>' +
        '</tbody></table></div>';
    }
    window.openModal("modal-report-preview");
  };

  window.exportReportCSV = function (type) {
    var csvContent = "data:text/csv;charset=utf-8,ID,Entity,Item,Quantity,Status,Timestamp\n" +
      "REC-001,WH-003,Rice,500 KG,Verified,2026-08-30 09:40\n" +
      "REC-002,FPS-102,Wheat,300 KG,Verified,2026-08-30 09:10\n" +
      "REC-003,BEN-1024,Rice,5 KG,Verified,2026-08-30 08:45\n";

    var encodedUri = encodeURI(csvContent);
    var link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", type.toLowerCase().replace(/\s+/g, "_") + "_export.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    if (window.showToast) window.showToast(type + " exported to CSV.", "success");
  };

  window.exportReportPDF = function (type) {
    if (window.showToast) {
      window.showToast("PDF generation initiated. Backend report service will be connected later.", "info");
    }
  };

})();
