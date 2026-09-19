/* ==========================================================
   PDSCHAIN — WAREHOUSE.JS
   Warehouse operations: Inventory management, Stock transfer
   creation modal, dynamic records, and transaction history.
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

  var transfersList = [];

  /* 1. Transfers Table Renderer */
  var transferBody = document.getElementById("warehouse-transfer-body");
  var transferSearch = document.getElementById("transfer-search");
  var currentTab = "All";

  function renderTransfers() {
    if (!transferBody) return;
    var q = transferSearch ? transferSearch.value.toLowerCase().trim() : "";

    var filtered = transfersList.filter(function (t) {
      var matchesTab = (currentTab === "All") ||
                       (currentTab === "Incoming" && t.type === "Incoming") ||
                       (currentTab === "Outgoing" && t.type === "Outgoing") ||
                       (currentTab === "Pending" && (t.status.includes("Pending") || t.type === "Pending")) ||
                       (currentTab === "Completed" && t.status === "Verified");
      var matchesQ = !q || t.id.toLowerCase().includes(q) || t.destination.toLowerCase().includes(q) || t.item.toLowerCase().includes(q);
      return matchesTab && matchesQ;
    });

    if (filtered.length === 0) {
      transferBody.innerHTML = '<tr><td colspan="7" class="text-center muted" style="padding:28px;">No transfers match the selected filter.</td></tr>';
      return;
    }

    transferBody.innerHTML = filtered.map(function (t) {
      var badgeClass = t.status === "Verified" ? "badge badge-success" :
                       t.status.includes("Pending") ? "badge badge-warning" : "badge badge-info";
      var typeBadge = t.type === "Incoming" ? '<span class="transfer-badge is-in"><i class="bi bi-arrow-down-left"></i> IN</span>' :
                                              '<span class="transfer-badge is-out"><i class="bi bi-arrow-up-right"></i> OUT</span>';

      return '<tr>' +
        '<td><span class="mono font-bold">' + escapeHtml(t.id) + '</span></td>' +
        '<td>' + typeBadge + '</td>' +
        '<td>' + escapeHtml(t.source) + '</td>' +
        '<td>' + escapeHtml(t.destination) + '</td>' +
        '<td>' + escapeHtml(t.item) + '</td>' +
        '<td><strong>' + escapeHtml(t.qty) + '</strong></td>' +
        '<td><span class="' + badgeClass + '">' + escapeHtml(t.status) + '</span></td>' +
        '<td><span class="muted">' + escapeHtml(t.time) + '</span></td>' +
      '</tr>';
    }).join("");
  }

  function loadTransfers() {
    var user = null;
    try { user = JSON.parse(localStorage.getItem("pdschain_user") || "null"); } catch (e) {}
    var warehouseId = user && user.entityId ? user.entityId : "WH-003";
    var base = window.getPDSChainApiBase ? window.getPDSChainApiBase("api") : "http://localhost:3000/api";
    if (transferBody) transferBody.innerHTML = '<tr><td colspan="8" class="text-center muted" style="padding:28px;">Loading transfer history...</td></tr>';
    fetch(base + "/warehouses/" + encodeURIComponent(warehouseId) + "/transfers", {
      headers: { "Authorization": "Bearer " + (localStorage.getItem("pdschain_jwt_token") || "") }
    })
      .then(function (res) {
        return res.json().then(function (data) {
          if (!res.ok || !data.success) throw new Error(data.message || "Unable to load transfer history.");
          return data;
        });
      })
      .then(function (data) {
        transfersList = (data.transfers || []).map(function (t) {
          return {
            id: t.transferId,
            type: "Outgoing",
            source: t.warehouseId,
            destination: t.shopId,
            item: t.commodity,
            qty: t.quantity + " " + (t.unit || "KG"),
            status: t.status,
            time: t.timestamp,
            transactionId: t.transactionId,
            blockNumber: t.blockNumber
          };
        });
        renderTransfers();
      })
      .catch(function (err) {
        if (transferBody) {
          transferBody.replaceChildren();
          var errTr = document.createElement("tr");
          var errTd = document.createElement("td");
          errTd.colSpan = 8;
          errTd.className = "text-center text-danger";
          errTd.style.padding = "28px";
          errTd.textContent = err.message || "Failed to load transfer history.";
          errTr.appendChild(errTd);
          transferBody.appendChild(errTr);
        }
      });
  }

  if (transferSearch) transferSearch.addEventListener("input", renderTransfers);
  renderTransfers();
  loadTransfers();

  // Tab Filtering
  document.querySelectorAll(".transfer-tab-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      document.querySelectorAll(".transfer-tab-btn").forEach(function (b) { b.classList.remove("is-active"); });
      btn.classList.add("is-active");
      currentTab = btn.getAttribute("data-tab") || "All";
      renderTransfers();
    });
  });

  /* 2. Create Transfer Form Modal */
  var createTrfForm = document.getElementById("form-create-transfer");
  if (createTrfForm) {
    var transferSubmitting = false;
    createTrfForm.addEventListener("submit", function (e) {
      e.preventDefault();
      if (transferSubmitting) return;
      var dest = document.getElementById("trf-destination").value;
      var item = document.getElementById("trf-commodity").value;
      var qty = document.getElementById("trf-quantity").value;
      var remarks = document.getElementById("trf-remarks").value;

      if (!dest || !item || !qty) {
        if (window.showToast) window.showToast("Please fill in all required fields.", "error");
        return;
      }
      if (!Number.isFinite(parseFloat(qty)) || parseFloat(qty) <= 0) {
        if (window.showToast) window.showToast("Transfer quantity must be greater than zero.", "error");
        return;
      }

      transferSubmitting = true;
      var token = localStorage.getItem("pdschain_jwt_token") || "";
      var newTrfId = "TRF-" + (1030 + transfersList.length);

      var user = null;
      try { user = JSON.parse(localStorage.getItem("pdschain_user") || "null"); } catch (e) {}
      var warehouseId = user && user.entityId ? user.entityId : "WH-003";
      fetch((window.getPDSChainApiBase ? window.getPDSChainApiBase("api") : "http://localhost:3000/api") + "/warehouses/" + encodeURIComponent(warehouseId) + "/transfer", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { "Authorization": "Bearer " + token } : {})
        },
        body: JSON.stringify({
          targetShopId: dest,
          commodity: item,
          quantity: parseFloat(qty),
          notes: remarks
        })
      })
      .then(function (res) {
        return res.json().then(function (data) {
          if (!res.ok || !data.success || !data.transfer) {
            throw new Error(data.message || "Stock transfer was rejected.");
          }
          return data;
        });
      })
      .then(function (resData) {
        newTrfId = resData.transfer.transferId || newTrfId;

        transfersList.unshift({
          id: newTrfId,
          type: "Outgoing",
          source: warehouseId,
          destination: dest,
          item: item,
          qty: qty + " KG",
          status: "Verified",
          time: "Just now"
        });

        window.closeModal("modal-create-transfer");
        loadTransfers();
        renderTransfers();
        createTrfForm.reset();
        transferSubmitting = false;

        if (window.showToast) {
          window.showToast("Stock transfer " + newTrfId + " initiated and recorded to blockchain!", "success");
        }
      })
      .catch(function (err) {
        transferSubmitting = false;
        if (window.showToast) {
          window.showToast("Stock transfer failed: " + (err.message || "Request rejected."), "error");
        }
      });
    });
  }

  /* 3. Inventory Adjust Modal */
  window.viewInventoryItem = function (commodity, available, reserved, minLvl) {
    var title = document.getElementById("inv-item-title");
    var body = document.getElementById("inv-item-content");
    if (title) title.textContent = (commodity || "") + " Inventory Details";
    if (body) {
      body.innerHTML =
        '<div class="receipt-details">' +
          '<div class="receipt-row"><span class="label">Commodity:</span><span class="val font-bold">' + escapeHtml(commodity) + '</span></div>' +
          '<div class="receipt-row"><span class="label">Available Stock:</span><span class="val font-bold">' + escapeHtml(available) + ' KG</span></div>' +
          '<div class="receipt-row"><span class="label">Reserved Allocation:</span><span class="val">' + escapeHtml(reserved) + ' KG</span></div>' +
          '<div class="receipt-row"><span class="label">Safety Level Threshold:</span><span class="val">' + escapeHtml(minLvl) + ' KG</span></div>' +
          '<div class="receipt-row"><span class="label">Warehouse Facility:</span><span class="val">WH-003 Main Depot</span></div>' +
          '<div class="receipt-row"><span class="label">Last Reconciled:</span><span class="val">Today 08:00 AM</span></div>' +
        '</div>';
    }
    window.openModal("modal-inventory-detail");
  };

})();
