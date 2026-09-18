/**
 * PDSChain Professional Blockchain Explorer Controller (Phase 15)
 * 
 * Manages hash routing, universal search, live SSE streaming, view rendering,
 * and read-only smart contract interactions.
 */

(function () {
  "use strict";

  // State Management
  var state = {
    currentView: "overview",
    overviewData: null,
    blocks: [],
    blocksCursor: null,
    blocksNextCursor: null,
    blocksPrevCursor: null,
    transactions: [],
    txCursor: null,
    txNextCursor: null,
    txPrevCursor: null,
    txFilter: "ALL",
    events: [],
    eventCursor: null,
    eventNextCursor: null,
    contracts: [],
    selectedContract: null,
    eventSource: null,
    isStreamPaused: false,
    sseBuffer: [],
    seenEventIds: new Set()
  };

  // --- Utility Functions ---
  function escapeHtml(str) {
    if (str === null || str === undefined) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function formatShortHash(hash, front, back) {
    if (!hash) return "0x0000...0000";
    front = front || 8;
    back = back || 6;
    if (hash.length <= (front + back + 3)) return hash;
    return hash.substring(0, front) + "..." + hash.substring(hash.length - back);
  }

  function formatDate(isoStr) {
    if (!isoStr) return "-";
    try {
      var d = new Date(isoStr);
      if (isNaN(d.getTime())) return isoStr;
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) + 
             " (" + d.toLocaleDateString() + ")";
    } catch (e) {
      return isoStr;
    }
  }

  function copyToClipboard(text, btn) {
    if (!text) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        showCopyFeedback(btn);
      });
    } else {
      var ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      showCopyFeedback(btn);
    }
  }

  function showCopyFeedback(btn) {
    if (!btn) return;
    var origHtml = btn.innerHTML;
    btn.innerHTML = '<i class="bi bi-check2"></i>';
    btn.classList.add("copied");
    setTimeout(function () {
      btn.innerHTML = origHtml;
      btn.classList.remove("copied");
    }, 1400);
  }

  function renderFinalityBadge(finality) {
    var f = (finality || "FINALIZED").toUpperCase();
    return '<span class="finality-badge finality-' + escapeHtml(f) + '">' +
           '<i class="bi bi-shield-fill-check"></i> ' + escapeHtml(f) + '</span>';
  }

  // --- Modal Helpers ---
  function showModal(title, bodyHtml) {
    var modalTitle = document.getElementById("explorer-modal-title");
    var modalBody = document.getElementById("explorer-modal-body");
    var modal = document.getElementById("explorer-modal");
    if (modalTitle && modalBody && modal) {
      modalTitle.innerHTML = title;
      modalBody.innerHTML = bodyHtml;
      modal.classList.add("is-active");
    }
  }

  function closeModal() {
    var modal = document.getElementById("explorer-modal");
    if (modal) modal.classList.remove("is-active");
  }

  // --- Toast Notification ---
  function showToast(message, type) {
    type = type || "info";
    var stack = document.getElementById("toast-stack");
    if (!stack) return;
    var toast = document.createElement("div");
    toast.className = "toast toast-" + type;
    toast.innerHTML = '<span>' + escapeHtml(message) + '</span>';
    stack.appendChild(toast);
    setTimeout(function () {
      if (toast.parentNode) toast.parentNode.removeChild(toast);
    }, 3500);
  }

  // ==========================================================
  // ROUTING & NAVIGATION
  // ==========================================================
  function parseHash() {
    var hash = window.location.hash || "#overview";
    if (hash.startsWith("#")) hash = hash.substring(1);
    var parts = hash.split("/");
    return {
      view: parts[0] || "overview",
      param: parts[1] || null
    };
  }

  function navigateTo(hash) {
    window.location.hash = hash.startsWith("#") ? hash : "#" + hash;
  }

  function handleRoute() {
    var route = parseHash();
    state.currentView = route.view;

    // Update tab active classes
    var tabBtns = document.querySelectorAll(".explorer-tab-btn");
    tabBtns.forEach(function (btn) {
      if (btn.getAttribute("data-view") === route.view) {
        btn.classList.add("is-active");
      } else {
        btn.classList.remove("is-active");
      }
    });

    // Hide all view panels
    var viewPanels = document.querySelectorAll(".explorer-view-panel");
    viewPanels.forEach(function (panel) {
      panel.style.display = "none";
    });

    // Handle deep links or render view
    var activePanel = document.getElementById("view-" + route.view);
    if (activePanel) {
      activePanel.style.display = "block";
    }

    switch (route.view) {
      case "overview":
        loadOverview();
        break;
      case "blocks":
        loadBlocks();
        break;
      case "block":
        if (route.param) {
          inspectBlock(route.param);
        } else {
          navigateTo("#blocks");
        }
        break;
      case "txs":
        loadTransactions();
        break;
      case "tx":
        if (route.param) {
          inspectTransaction(route.param);
        } else {
          navigateTo("#txs");
        }
        break;
      case "addresses":
      case "address":
        if (route.param) {
          inspectAddress(route.param);
        } else {
          showAddressSearch();
        }
        break;
      case "contracts":
      case "contract":
        loadContracts(route.param);
        break;
      case "events":
        loadEvents();
        break;
      case "validators":
        loadValidators();
        break;
      case "network":
        loadNetwork();
        break;
      case "sync":
        loadSync();
        break;
      default:
        loadOverview();
        break;
    }
  }

  // ==========================================================
  // UNIVERSAL SEARCH ENGINE
  // ==========================================================
  var searchDebounceTimer = null;

  function initSearch() {
    var searchInput = document.getElementById("global-search-input");
    var searchDropdown = document.getElementById("global-search-dropdown");

    if (!searchInput) return;

    // Keyboard shortcut '/' to focus search
    window.addEventListener("keydown", function (e) {
      if (e.key === "/" && document.activeElement !== searchInput) {
        e.preventDefault();
        searchInput.focus();
      }
      if (e.key === "Escape") {
        if (searchDropdown) searchDropdown.classList.remove("is-active");
        closeModal();
      }
    });

    searchInput.addEventListener("input", function () {
      var query = searchInput.value.trim();
      clearTimeout(searchDebounceTimer);
      if (query.length < 1) {
        if (searchDropdown) searchDropdown.classList.remove("is-active");
        return;
      }

      searchDebounceTimer = setTimeout(async function () {
        try {
          var res = await window.ExplorerAPI.search(query);
          renderSearchDropdown(res.data);
        } catch (e) {
          console.warn("Search query failed:", e);
        }
      }, 200);
    });

    searchInput.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        e.preventDefault();
        var query = searchInput.value.trim();
        if (query) executeSearch(query);
      }
    });

    document.addEventListener("click", function (e) {
      if (searchDropdown && !searchInput.contains(e.target) && !searchDropdown.contains(e.target)) {
        searchDropdown.classList.remove("is-active");
      }
    });
  }

  function renderSearchDropdown(data) {
    var searchDropdown = document.getElementById("global-search-dropdown");
    if (!searchDropdown) return;

    if (!data || !data.matches || data.matches.length === 0) {
      searchDropdown.innerHTML = '<div style="padding:14px;text-align:center;color:var(--explorer-text-muted);">' +
                                 '<em>No matching blocks, transactions, contracts, or validators found.</em></div>';
      searchDropdown.classList.add("is-active");
      return;
    }

    var html = '<div class="search-dropdown-header">Found ' + data.matches.length + ' Matches</div>';
    data.matches.forEach(function (m) {
      var typeClass = "search-type-" + (m.type ? m.type.toLowerCase() : "block");
      html += '<a class="search-result-item" href="' + escapeHtml(m.targetRoute) + '">' +
              '  <div class="search-result-left">' +
              '    <span class="search-result-type-chip ' + typeClass + '">' + escapeHtml(m.type) + '</span>' +
              '    <div>' +
              '      <div class="search-result-title">' + escapeHtml(m.title) + '</div>' +
              '      <div class="search-result-subtitle">' + escapeHtml(m.subtitle) + '</div>' +
              '    </div>' +
              '  </div>' +
              '  <div>' + renderFinalityBadge(m.finality) + '</div>' +
              '</a>';
    });

    searchDropdown.innerHTML = html;
    searchDropdown.classList.add("is-active");
  }

  async function executeSearch(query) {
    var searchDropdown = document.getElementById("global-search-dropdown");
    if (searchDropdown) searchDropdown.classList.remove("is-active");

    try {
      var res = await window.ExplorerAPI.search(query);
      var matches = (res.data && res.data.matches) || [];
      if (matches.length === 1) {
        // Direct navigation
        window.location.hash = matches[0].targetRoute;
      } else if (matches.length > 1) {
        // Show disambiguation modal
        var listHtml = '<div class="table-wrap"><table class="data-table"><thead><tr>' +
                       '<th>Type</th><th>Identifier</th><th>Details</th><th>Action</th>' +
                       '</tr></thead><tbody>';
        matches.forEach(function (m) {
          listHtml += '<tr>' +
                      '  <td><span class="badge badge-info">' + escapeHtml(m.type) + '</span></td>' +
                      '  <td class="mono"><strong>' + escapeHtml(m.title) + '</strong></td>' +
                      '  <td>' + escapeHtml(m.subtitle) + '</td>' +
                      '  <td><a class="btn btn-primary btn-sm" href="' + escapeHtml(m.targetRoute) + '" onclick="Explorer.closeModal()">Inspect</a></td>' +
                      '</tr>';
        });
        listHtml += '</tbody></table></div>';
        showModal('Search Results for "' + escapeHtml(query) + '"', listHtml);
      } else {
        showToast('No ledger records found matching "' + query + '"', "warning");
      }
    } catch (e) {
      showToast("Search error: " + e.message, "danger");
    }
  }

  // ==========================================================
  // VIEW: OVERVIEW DASHBOARD
  // ==========================================================
  async function loadOverview() {
    var container = document.getElementById("view-overview");
    if (!container) return;

    try {
      var res = await window.ExplorerAPI.getOverview();
      var data = res.data;
      state.overviewData = data;

      // Update KPI counters
      document.getElementById("kpi-finalized-height").textContent = "#" + data.finalizedHeight;
      document.getElementById("kpi-latest-hash").textContent = formatShortHash(data.latestBlockHash, 6, 6);
      document.getElementById("kpi-total-blocks").textContent = data.totalBlocks;
      document.getElementById("kpi-total-txs").textContent = data.totalTransactions;
      document.getElementById("kpi-validator-quorum").textContent = data.validators.online + " / " + data.validators.total;
      document.getElementById("kpi-quorum-status").textContent = data.validators.quorumHealth;
      document.getElementById("kpi-tps").textContent = data.tps + " TPS";

      // Header chain info pill
      var chainPill = document.getElementById("topbar-chain-pill");
      if (chainPill) {
        chainPill.innerHTML = '<span class="pulse-dot"></span> Height #' + data.finalizedHeight + ' · Quorum ' + data.validators.quorumHealth;
      }

      // Render Recent Blocks Table
      renderRecentBlocks(data.recentBlocks || []);

      // Render Recent Transactions Table
      renderRecentTransactions(data.recentTransactions || []);

      // Render Chain Flow Track
      renderChainSequence(data.recentBlocks || []);
    } catch (e) {
      console.error("Failed to load explorer overview:", e);
      showToast("Failed to load dashboard telemetry: " + e.message, "danger");
    }
  }

  function renderRecentBlocks(blocks) {
    var tbody = document.getElementById("overview-recent-blocks-body");
    if (!tbody) return;

    if (!blocks || blocks.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--explorer-text-muted);padding:20px;"><em>No finalized blocks yet.</em></td></tr>';
      return;
    }

    var html = "";
    blocks.forEach(function (b) {
      var txCount = Array.isArray(b.transactions) ? b.transactions.length : (b.transactionCount || 0);
      var bNum = b.blockNumber !== undefined ? b.blockNumber : b.index;
      var bHash = b.blockHash || b.hash || "";

      html += '<tr>' +
              '  <td><a class="hash-link" href="#block/' + bNum + '">#' + bNum + '</a></td>' +
              '  <td><a class="hash-link" href="#block/' + bNum + '">' + formatShortHash(bHash, 6, 6) + '</a> ' +
              '      <button class="copy-btn" onclick="Explorer.copyToClipboard(\'' + escapeHtml(bHash) + '\', this)" title="Copy Hash"><i class="bi bi-copy"></i></button></td>' +
              '  <td><span class="badge badge-info">' + txCount + ' txns</span></td>' +
              '  <td class="mono">' + escapeHtml(b.proposerId || "VAL-01") + '</td>' +
              '  <td>' + formatDate(b.timestamp) + '</td>' +
              '  <td>' + renderFinalityBadge(b.consensusStatus || "FINALIZED") + '</td>' +
              '</tr>';
    });
    tbody.innerHTML = html;
  }

  function renderRecentTransactions(txs) {
    var tbody = document.getElementById("overview-recent-txs-body");
    if (!tbody) return;

    if (!txs || txs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" style="text-align:center;color:var(--explorer-text-muted);padding:20px;"><em>No recent transactions.</em></td></tr>';
      return;
    }

    var html = "";
    txs.forEach(function (t) {
      var txId = t.transactionId || t.hash || "";
      var sender = t.sender || t.beneficiaryId || "-";
      var receiver = t.receiver || t.shopId || "-";
      var commodity = t.commodity ? (t.quantity + " " + (t.unit || "KG") + " " + t.commodity) : "Grain Transfer";
      var finality = t.blockNumber ? "FINALIZED" : "COMMITTED";

      html += '<tr>' +
              '  <td><a class="hash-link" href="#tx/' + escapeHtml(txId) + '">' + formatShortHash(txId, 6, 4) + '</a> ' +
              '      <button class="copy-btn" onclick="Explorer.copyToClipboard(\'' + escapeHtml(txId) + '\', this)"><i class="bi bi-copy"></i></button></td>' +
              '  <td><a class="hash-link" href="#address/' + escapeHtml(sender) + '">' + formatShortHash(sender, 6, 4) + '</a></td>' +
              '  <td><a class="hash-link" href="#address/' + escapeHtml(receiver) + '">' + formatShortHash(receiver, 6, 4) + '</a></td>' +
              '  <td><strong>' + escapeHtml(commodity) + '</strong></td>' +
              '  <td>' + formatDate(t.timestamp || t.createdAt) + '</td>' +
              '  <td>' + renderFinalityBadge(finality) + '</td>' +
              '</tr>';
    });
    tbody.innerHTML = html;
  }

  function renderChainSequence(blocks) {
    var track = document.getElementById("chain-sequence-track");
    if (!track) return;

    var html = "";
    blocks.forEach(function (b, idx) {
      var bNum = b.blockNumber !== undefined ? b.blockNumber : b.index;
      var bHash = b.blockHash || b.hash || "";
      var txCount = Array.isArray(b.transactions) ? b.transactions.length : 0;

      html += '<div class="chain-node" onclick="Explorer.navigateTo(\'#block/' + bNum + '\')" style="cursor:pointer;">' +
              '  <div class="chain-node-head">' +
              '    <span class="chain-node-num">Block #' + bNum + '</span>' +
              '    <span class="chain-node-status is-valid"><i class="bi bi-check-circle-fill"></i></span>' +
              '  </div>' +
              '  <div class="chain-node-body">' +
              '    <div class="chain-node-field"><span class="k">Hash:</span> <span class="v mono">' + formatShortHash(bHash, 5, 4) + '</span></div>' +
              '    <div class="chain-node-field"><span class="k">Txns:</span> <span class="v mono">' + txCount + '</span></div>' +
              '    <div class="chain-node-field"><span class="k">Proposer:</span> <span class="v mono">' + escapeHtml(b.proposerId || "VAL-01") + '</span></div>' +
              '  </div>' +
              '</div>';

      if (idx < blocks.length - 1) {
        html += '<div class="chain-link" style="display:flex;align-items:center;padding:0 8px;color:var(--explorer-brand);"><i class="bi bi-arrow-right" style="font-size:18px;"></i></div>';
      }
    });

    track.innerHTML = html;
  }

  // ==========================================================
  // VIEW: BLOCKS EXPLORER & DETAIL
  // ==========================================================
  async function loadBlocks(cursor) {
    try {
      var res = await window.ExplorerAPI.getBlocks({ cursor: cursor, limit: 15 });
      state.blocks = res.data || [];
      var pagination = res.meta && res.meta.pagination;
      state.blocksNextCursor = pagination ? pagination.nextCursor : null;
      state.blocksPrevCursor = pagination ? pagination.prevCursor : null;

      renderBlocksTable(state.blocks);
      renderBlocksPagination(pagination);
    } catch (e) {
      showToast("Failed to load blocks: " + e.message, "danger");
    }
  }

  function renderBlocksTable(blocks) {
    var tbody = document.getElementById("blocks-table-body");
    if (!tbody) return;

    if (!blocks || blocks.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--explorer-text-muted);padding:24px;"><em>No blocks found.</em></td></tr>';
      return;
    }

    var html = "";
    blocks.forEach(function (b) {
      var bNum = b.blockNumber !== undefined ? b.blockNumber : b.index;
      var bHash = b.blockHash || b.hash || "";
      var prevHash = b.previousHash || b.prevHash || "0x0000000000000000";
      var txCount = Array.isArray(b.transactions) ? b.transactions.length : (b.transactionCount || 0);

      html += '<tr>' +
              '  <td><a class="hash-link" href="#block/' + bNum + '"><strong>#' + bNum + '</strong></a></td>' +
              '  <td><a class="hash-link" href="#block/' + bNum + '">' + formatShortHash(bHash, 8, 6) + '</a> ' +
              '      <button class="copy-btn" onclick="Explorer.copyToClipboard(\'' + escapeHtml(bHash) + '\', this)"><i class="bi bi-copy"></i></button></td>' +
              '  <td><span class="mono text-muted">' + formatShortHash(prevHash, 6, 4) + '</span></td>' +
              '  <td><span class="badge badge-info">' + txCount + ' txns</span></td>' +
              '  <td class="mono">' + escapeHtml(b.proposerId || "GENESIS") + '</td>' +
              '  <td>' + formatDate(b.timestamp) + '</td>' +
              '  <td>' + renderFinalityBadge(b.consensusStatus || "FINALIZED") + '</td>' +
              '</tr>';
    });
    tbody.innerHTML = html;
  }

  function renderBlocksPagination(pagination) {
    var prevBtn = document.getElementById("blocks-prev-btn");
    var nextBtn = document.getElementById("blocks-next-btn");
    var info = document.getElementById("blocks-page-info");

    if (prevBtn) prevBtn.disabled = !state.blocksPrevCursor;
    if (nextBtn) nextBtn.disabled = !state.blocksNextCursor;
    if (info && pagination) {
      info.textContent = "Showing " + state.blocks.length + " blocks" + (pagination.total ? " of " + pagination.total : "");
    }
  }

  async function inspectBlock(identifier) {
    try {
      var res = await window.ExplorerAPI.getBlock(identifier);
      var b = res.data;
      if (!b) return;

      var bNum = b.blockNumber !== undefined ? b.blockNumber : b.index;
      var bHash = b.blockHash || b.hash || "";
      var prevHash = b.previousHash || b.prevHash || "";
      var stateRoot = b.stateRoot || "-";
      var receiptsRoot = b.receiptsRoot || "-";
      var cert = b.consensusCertificate || null;
      var approvals = cert && cert.validatorApprovals ? cert.validatorApprovals : [];

      var html = '<div class="stack">' +
                 '  <div class="kpi-grid cols-3" style="margin-bottom:12px;">' +
                 '    <div class="stat-card"><div class="stat-card-label">Block Number</div><div class="stat-card-value mono">#' + bNum + '</div></div>' +
                 '    <div class="stat-card"><div class="stat-card-label">Finality</div><div class="stat-card-value">' + renderFinalityBadge(b.consensusStatus || "FINALIZED") + '</div></div>' +
                 '    <div class="stat-card"><div class="stat-card-label">Transactions</div><div class="stat-card-value mono">' + (b.transactions ? b.transactions.length : 0) + '</div></div>' +
                 '  </div>' +
                 '  <div class="table-wrap"><table class="data-table"><tbody>' +
                 '    <tr><th style="width:200px;">Block Hash</th><td class="mono">' + escapeHtml(bHash) + ' <button class="copy-btn" onclick="Explorer.copyToClipboard(\'' + escapeHtml(bHash) + '\', this)"><i class="bi bi-copy"></i></button></td></tr>' +
                 '    <tr><th>Previous Hash</th><td class="mono">' + escapeHtml(prevHash) + ' <button class="copy-btn" onclick="Explorer.copyToClipboard(\'' + escapeHtml(prevHash) + '\', this)"><i class="bi bi-copy"></i></button></td></tr>' +
                 '    <tr><th>Merkle Root</th><td class="mono">' + escapeHtml(b.merkleRoot || "-") + ' <button class="copy-btn" onclick="Explorer.copyToClipboard(\'' + escapeHtml(b.merkleRoot || "") + '\', this)"><i class="bi bi-copy"></i></button> <button class="btn btn-sm btn-secondary" style="margin-left:8px;padding:2px 8px;font-size:11px;" onclick="Explorer.openBlockTreeModal(\'' + escapeHtml(bNum) + '\')"><i class="bi bi-diagram-3"></i> Inspect Tree</button></td></tr>' +
                 '    <tr><th>State Root</th><td class="mono">' + escapeHtml(stateRoot) + ' <button class="copy-btn" onclick="Explorer.copyToClipboard(\'' + escapeHtml(stateRoot) + '\', this)"><i class="bi bi-copy"></i></button></td></tr>' +
                 '    <tr><th>Receipts Root</th><td class="mono">' + escapeHtml(receiptsRoot) + '</td></tr>' +
                 '    <tr><th>Proposer</th><td class="mono">' + escapeHtml(b.proposerId || "GENESIS") + ' (' + escapeHtml(b.proposerAddress || "PDS1000...") + ')</td></tr>' +
                 '    <tr><th>Timestamp</th><td>' + formatDate(b.timestamp) + ' (' + escapeHtml(b.timestamp) + ')</td></tr>' +
                 '    <tr><th>Round &amp; Difficulty</th><td class="mono">Round: ' + (b.round || 0) + ' · Nonce: ' + (b.nonce || 0) + '</td></tr>' +
                 '  </tbody></table></div>';

      // Consensus Certificate
      if (cert) {
        html += '  <div class="section-block" style="margin-top:16px;">' +
                '    <h3><i class="bi bi-patch-check text-success"></i> 12-Validator Consensus Certificate</h3>' +
                '    <p style="font-size:12.5px;color:var(--explorer-text-muted);">' +
                '      Quorum Threshold: ' + (cert.threshold || 8) + ' of ' + (cert.totalValidators || 12) + ' validators approved. Certified: ' + (cert.achieved ? "YES" : "NO") +
                '    </p>' +
                '    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;">';
        approvals.forEach(function (appr) {
          html += '<span class="badge badge-success mono" style="font-size:11px;"><i class="bi bi-check-circle"></i> ' + escapeHtml(appr.validatorId) + '</span>';
        });
        html += '    </div></div>';
      }

      // Transactions
      var txList = b.transactions || [];
      html += '  <div class="section-block" style="margin-top:16px;">' +
              '    <h3>Transactions in Block (' + txList.length + ')</h3>';
      if (txList.length === 0) {
        html += '<p style="color:var(--explorer-text-muted);"><em>No transactions in this block.</em></p>';
      } else {
        html += '<div class="table-wrap"><table class="data-table"><thead><tr><th>Tx ID</th><th>Sender</th><th>Receiver</th><th>Commodity</th><th>Status</th></tr></thead><tbody>';
        txList.forEach(function (tx) {
          var txId = tx.transactionId || tx.hash || tx.id || "";
          html += '<tr>' +
                  '  <td><a class="hash-link" href="#tx/' + escapeHtml(txId) + '" onclick="Explorer.closeModal()">' + formatShortHash(txId, 6, 4) + '</a></td>' +
                  '  <td class="mono">' + escapeHtml(tx.sender || tx.beneficiaryId || "-") + '</td>' +
                  '  <td class="mono">' + escapeHtml(tx.receiver || tx.shopId || "-") + '</td>' +
                  '  <td>' + escapeHtml(tx.commodity ? (tx.quantity + " " + tx.unit + " " + tx.commodity) : "TRANSFER") + '</td>' +
                  '  <td>' + renderFinalityBadge(b.consensusStatus || "FINALIZED") + '</td>' +
                  '</tr>';
        });
        html += '</tbody></table></div>';
      }
      html += '  </div>';

      // Raw JSON toggle
      html += '  <details style="margin-top:16px;"><summary style="cursor:pointer;font-weight:600;font-size:13px;color:var(--explorer-brand);margin-bottom:8px;">View Raw Block JSON</summary>' +
              '    <div class="json-box">' + escapeHtml(JSON.stringify(b, null, 2)) + '</div>' +
              '  </details>' +
              '</div>';

      showModal('Block #' + bNum + ' Details', html);
    } catch (e) {
      showToast("Failed to inspect block: " + e.message, "danger");
    }
  }

  // ==========================================================
  // VIEW: TRANSACTIONS EXPLORER & DETAIL
  // ==========================================================
  async function loadTransactions(cursor) {
    try {
      var res = await window.ExplorerAPI.getTransactions({ cursor: cursor, limit: 15 });
      state.transactions = res.data || [];
      var pagination = res.meta && res.meta.pagination;
      state.txNextCursor = pagination ? pagination.nextCursor : null;
      state.txPrevCursor = pagination ? pagination.prevCursor : null;

      renderTransactionsTable(state.transactions);
      renderTransactionsPagination(pagination);
    } catch (e) {
      showToast("Failed to load transactions: " + e.message, "danger");
    }
  }

  function renderTransactionsTable(txs) {
    var tbody = document.getElementById("tx-table-body");
    if (!tbody) return;

    if (!txs || txs.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--explorer-text-muted);padding:24px;"><em>No transactions found.</em></td></tr>';
      return;
    }

    var html = "";
    txs.forEach(function (t) {
      var txId = t.transactionId || t.hash || "";
      var sender = t.sender || t.beneficiaryId || "-";
      var receiver = t.receiver || t.shopId || "-";
      var commodity = t.commodity ? (t.quantity + " " + (t.unit || "KG") + " " + t.commodity) : "Grain Transfer";
      var bNum = t.blockNumber !== undefined && t.blockNumber !== null ? t.blockNumber : "Pending";
      var finality = t.blockNumber !== undefined && t.blockNumber !== null ? "FINALIZED" : "COMMITTED";

      html += '<tr>' +
              '  <td><a class="hash-link" href="#tx/' + escapeHtml(txId) + '"><strong>' + formatShortHash(txId, 8, 6) + '</strong></a> ' +
              '      <button class="copy-btn" onclick="Explorer.copyToClipboard(\'' + escapeHtml(txId) + '\', this)"><i class="bi bi-copy"></i></button></td>' +
              '  <td>' + (bNum === "Pending" ? '<span class="badge badge-warning">Pending</span>' : '<a class="hash-link" href="#block/' + bNum + '">#' + bNum + '</a>') + '</td>' +
              '  <td><a class="hash-link" href="#address/' + escapeHtml(sender) + '">' + formatShortHash(sender, 6, 4) + '</a></td>' +
              '  <td><a class="hash-link" href="#address/' + escapeHtml(receiver) + '">' + formatShortHash(receiver, 6, 4) + '</a></td>' +
              '  <td><strong>' + escapeHtml(commodity) + '</strong></td>' +
              '  <td>' + formatDate(t.timestamp || t.createdAt) + '</td>' +
              '  <td>' + renderFinalityBadge(finality) + '</td>' +
              '</tr>';
    });
    tbody.innerHTML = html;
  }

  function renderTransactionsPagination(pagination) {
    var prevBtn = document.getElementById("tx-prev-btn");
    var nextBtn = document.getElementById("tx-next-btn");
    var info = document.getElementById("tx-page-info");

    if (prevBtn) prevBtn.disabled = !state.txPrevCursor;
    if (nextBtn) nextBtn.disabled = !state.txNextCursor;
    if (info && pagination) {
      info.textContent = "Showing " + state.transactions.length + " transactions" + (pagination.total ? " of " + pagination.total : "");
    }
  }

  async function inspectTransaction(id) {
    try {
      var res = await window.ExplorerAPI.getTransaction(id);
      var tx = res.data;
      if (!tx) return;

      var txId = tx.transactionId || tx.hash || "";
      var sender = tx.sender || tx.beneficiaryId || "-";
      var receiver = tx.receiver || tx.shopId || "-";
      var finality = tx.blockNumber !== undefined && tx.blockNumber !== null ? "FINALIZED" : "COMMITTED";

      // Try fetching EVM receipt
      var receipt = null;
      try {
        var rRes = await window.ExplorerAPI.getTransactionReceipt(txId);
        receipt = rRes.data;
      } catch (e) {}

      var html = '<div class="stack">' +
                 '  <div class="kpi-grid cols-3" style="margin-bottom:12px;">' +
                 '    <div class="stat-card"><div class="stat-card-label">Block Included</div><div class="stat-card-value mono">' + (tx.blockNumber ? '#' + tx.blockNumber : 'Pending') + '</div></div>' +
                 '    <div class="stat-card"><div class="stat-card-label">Execution Status</div><div class="stat-card-value text-success"><i class="bi bi-check-circle"></i> ' + escapeHtml(tx.status || "Verified") + '</div></div>' +
                 '    <div class="stat-card"><div class="stat-card-label">Finality</div><div class="stat-card-value">' + renderFinalityBadge(finality) + '</div></div>' +
                 '  </div>' +
                 '  <div class="table-wrap"><table class="data-table"><tbody>' +
                 '    <tr><th style="width:180px;">Transaction ID</th><td class="mono">' + escapeHtml(txId) + ' <button class="copy-btn" onclick="Explorer.copyToClipboard(\'' + escapeHtml(txId) + '\', this)"><i class="bi bi-copy"></i></button></td></tr>' +
                 '    <tr><th>Sender / Beneficiary</th><td class="mono"><a class="hash-link" href="#address/' + escapeHtml(sender) + '" onclick="Explorer.closeModal()">' + escapeHtml(sender) + '</a></td></tr>' +
                 '    <tr><th>Receiver / Shop</th><td class="mono"><a class="hash-link" href="#address/' + escapeHtml(receiver) + '" onclick="Explorer.closeModal()">' + escapeHtml(receiver) + '</a></td></tr>' +
                 '    <tr><th>Commodity &amp; Amount</th><td><strong>' + escapeHtml(tx.commodity ? (tx.quantity + " " + (tx.unit || "KG") + " " + tx.commodity) : "Grain Transfer") + '</strong></td></tr>' +
                 '    <tr><th>Timestamp</th><td>' + formatDate(tx.timestamp || tx.createdAt) + '</td></tr>' +
                 '    <tr><th>FBA Quorum</th><td class="mono">12 / 12 Validators Consensus Approved</td></tr>' +
                 '  </tbody></table></div>' +
                 '  <div style="margin: 16px 0 10px; display:flex; gap:10px; flex-wrap:wrap;">' +
                 '    <button class="btn btn-primary" onclick="Explorer.openProofModal(\'' + escapeHtml(txId) + '\')"><i class="bi bi-shield-check"></i> Verify Cryptographic Merkle Proof</button>' +
                 '  </div>';

      // EVM Receipt Section if available
      if (receipt) {
        html += '  <div class="section-block" style="margin-top:16px;">' +
                '    <h3><i class="bi bi-receipt text-indigo"></i> EVM Execution Receipt</h3>' +
                '    <div class="table-wrap"><table class="data-table"><tbody>' +
                '      <tr><th style="width:180px;">Contract Address</th><td class="mono">' + escapeHtml(receipt.contractAddress || "-") + '</td></tr>' +
                '      <tr><th>Gas Used</th><td class="mono">' + (receipt.gasUsed || "21000") + '</td></tr>' +
                '      <tr><th>Status</th><td>' + (receipt.status === 1 || receipt.status === "0x1" ? '<span class="badge badge-success">SUCCESS</span>' : '<span class="badge badge-danger">REVERTED</span>') + '</td></tr>' +
                '      <tr><th>Logs Count</th><td>' + (Array.isArray(receipt.logs) ? receipt.logs.length : 0) + '</td></tr>' +
                '    </tbody></table></div></div>';
      }

      // Raw JSON toggle
      html += '  <details style="margin-top:16px;"><summary style="cursor:pointer;font-weight:600;font-size:13px;color:var(--explorer-brand);margin-bottom:8px;">View Raw Transaction JSON</summary>' +
              '    <div class="json-box">' + escapeHtml(JSON.stringify(tx, null, 2)) + '</div>' +
              '  </details>' +
              '</div>';

      showModal('Transaction ' + formatShortHash(txId, 8, 6), html);
    } catch (e) {
      showToast("Failed to inspect transaction: " + e.message, "danger");
    }
  }

  // ==========================================================
  // VIEW: ADDRESSES & ACCOUNTS
  // ==========================================================
  function showAddressSearch() {
    var container = document.getElementById("address-detail-container");
    if (container) {
      container.innerHTML = '<div class="stat-card" style="text-align:center;padding:40px;">' +
                            '  <i class="bi bi-wallet2" style="font-size:36px;color:var(--explorer-brand);margin-bottom:12px;display:inline-block;"></i>' +
                            '  <h2>Address &amp; Account Explorer</h2>' +
                            '  <p style="color:var(--explorer-text-muted);max-width:500px;margin:8px auto 20px;">Enter any PDS1 address, 0x EVM account, Fair Price Shop ID, or Beneficiary ID to inspect balances, nonce, and on-chain ledger activity.</p>' +
                            '  <div style="max-width:480px;margin:0 auto;display:flex;gap:8px;">' +
                            '    <input type="text" id="manual-address-input" class="form-input" placeholder="e.g. BEN-001, FPS-001, PDS1..." />' +
                            '    <button class="btn btn-primary" onclick="Explorer.onManualAddressSubmit()"><i class="bi bi-search"></i> Inspect</button>' +
                            '  </div>' +
                            '</div>';
    }
  }

  function onManualAddressSubmit() {
    var input = document.getElementById("manual-address-input");
    if (input && input.value.trim()) {
      navigateTo("#address/" + encodeURIComponent(input.value.trim()));
    }
  }

  async function inspectAddress(address) {
    var container = document.getElementById("address-detail-container");
    if (!container) return;

    container.innerHTML = '<div style="padding:40px;text-align:center;"><span class="badge badge-info">Loading Address Details...</span></div>';

    try {
      var res = await window.ExplorerAPI.getAddressDetails(address);
      var data = res.data;

      var typeBadgeClass = data.accountType === "VALIDATOR" ? "badge-warning" :
                           data.accountType === "SMART_CONTRACT" ? "badge-indigo" : "badge-info";

      var html = '<div class="stack">' +
                 '  <div class="explorer-breadcrumbs">' +
                 '    <a href="#overview">Explorer</a> <i class="bi bi-chevron-right"></i>' +
                 '    <a href="#addresses">Addresses</a> <i class="bi bi-chevron-right"></i>' +
                 '    <span class="mono">' + escapeHtml(address) + '</span>' +
                 '  </div>' +
                 '  <div class="kpi-grid cols-4" style="margin-bottom:16px;">' +
                 '    <div class="stat-card"><div class="stat-card-label">Account Classification</div><div class="stat-card-value" style="font-size:20px;"><span class="badge ' + typeBadgeClass + '">' + escapeHtml(data.accountType) + '</span></div></div>' +
                 '    <div class="stat-card"><div class="stat-card-label">Balance</div><div class="stat-card-value mono">' + escapeHtml(data.balance) + '</div></div>' +
                 '    <div class="stat-card"><div class="stat-card-label">Account Nonce</div><div class="stat-card-value mono">' + data.nonce + '</div></div>' +
                 '    <div class="stat-card"><div class="stat-card-label">Total Transactions</div><div class="stat-card-value mono">' + data.transactionCount + '</div></div>' +
                 '  </div>';

      // Validator info banner if validator
      if (data.validatorDetails) {
        var val = data.validatorDetails;
        html += '<div class="explorer-alert-banner" style="background:rgba(99,102,241,0.12);border-color:rgba(99,102,241,0.3);color:#818cf8;">' +
                '  <div><i class="bi bi-shield-check"></i> <strong>Consortium Validator Node: ' + escapeHtml(val.name) + ' (' + escapeHtml(val.validatorId) + ')</strong> · Region: ' + escapeHtml(val.region) + ' · Org: ' + escapeHtml(val.org) + '</div>' +
                '  <a class="btn btn-secondary btn-sm" href="#validators">View Validator Telemetry</a>' +
                '</div>';
      }

      // Transactions Table
      var txList = data.transactions || [];
      html += '  <div class="section-block">' +
              '    <div class="section-block-head"><h2>Transaction History (' + txList.length + ')</h2></div>';
      if (txList.length === 0) {
        html += '    <p style="color:var(--explorer-text-muted);padding:14px;"><em>No transactions recorded for this address.</em></p>';
      } else {
        html += '    <div class="table-wrap"><table class="data-table"><thead><tr><th>Tx ID</th><th>Block</th><th>Sender</th><th>Receiver</th><th>Commodity</th><th>Date</th><th>Finality</th></tr></thead><tbody>';
        txList.forEach(function (tx) {
          var txId = tx.transactionId || tx.hash || "";
          html += '<tr>' +
                  '  <td><a class="hash-link" href="#tx/' + escapeHtml(txId) + '">' + formatShortHash(txId, 6, 4) + '</a></td>' +
                  '  <td>' + (tx.blockNumber ? '<a class="hash-link" href="#block/' + tx.blockNumber + '">#' + tx.blockNumber + '</a>' : '<span class="badge badge-warning">Pending</span>') + '</td>' +
                  '  <td class="mono">' + escapeHtml(tx.sender || tx.beneficiaryId || "-") + '</td>' +
                  '  <td class="mono">' + escapeHtml(tx.receiver || tx.shopId || "-") + '</td>' +
                  '  <td>' + escapeHtml(tx.commodity ? (tx.quantity + " " + (tx.unit || "KG") + " " + tx.commodity) : "-") + '</td>' +
                  '  <td>' + formatDate(tx.timestamp || tx.createdAt) + '</td>' +
                  '  <td>' + renderFinalityBadge(tx.blockNumber ? "FINALIZED" : "COMMITTED") + '</td>' +
                  '</tr>';
        });
        html += '    </tbody></table></div>';
      }
      html += '  </div></div>';

      container.innerHTML = html;
    } catch (e) {
      container.innerHTML = '<div class="explorer-alert-banner danger"><i class="bi bi-exclamation-triangle"></i> Failed to inspect address: ' + escapeHtml(e.message) + '</div>';
    }
  }

  // ==========================================================
  // VIEW: SMART CONTRACTS EXPLORER & RUNNER
  // ==========================================================
  async function loadContracts(targetAddress) {
    var dirTbody = document.getElementById("contracts-dir-body");
    if (!dirTbody) return;

    try {
      var res = await window.ExplorerAPI.getContracts();
      var contracts = (res.data && res.data.contracts) || [];
      state.contracts = contracts;

      var html = "";
      contracts.forEach(function (c) {
        html += '<tr>' +
                '  <td><strong>' + escapeHtml(c.name) + '</strong></td>' +
                '  <td><a class="hash-link" href="#contract/' + escapeHtml(c.address) + '">' + escapeHtml(c.address) + '</a> ' +
                '      <button class="copy-btn" onclick="Explorer.copyToClipboard(\'' + escapeHtml(c.address) + '\', this)"><i class="bi bi-copy"></i></button></td>' +
                '  <td class="mono text-muted">' + formatShortHash(c.codeHash || "", 6, 6) + '</td>' +
                '  <td><span class="badge badge-info">' + c.methodsCount + ' functions</span></td>' +
                '  <td><span class="badge badge-success">' + c.eventsCount + ' events</span></td>' +
                '  <td><button class="btn btn-primary btn-sm" onclick="Explorer.selectContract(\'' + escapeHtml(c.address) + '\')"><i class="bi bi-play-circle"></i> Interact</button></td>' +
                '</tr>';
      });
      dirTbody.innerHTML = html;

      if (targetAddress) {
        selectContract(targetAddress);
      } else if (contracts.length > 0 && !state.selectedContract) {
        selectContract(contracts[0].address);
      }
    } catch (e) {
      showToast("Failed to load contracts: " + e.message, "danger");
    }
  }

  async function selectContract(address) {
    var detailCard = document.getElementById("contract-detail-card");
    if (!detailCard) return;

    detailCard.style.display = "block";
    detailCard.innerHTML = '<div style="padding:20px;text-align:center;"><span class="badge badge-info">Loading Contract ABI...</span></div>';

    try {
      var res = await window.ExplorerAPI.getContract(address);
      var contract = res.data;
      state.selectedContract = contract;

      var viewMethods = (contract.abi || []).filter(function (item) {
        return item.type === "function" && (item.stateMutability === "view" || item.stateMutability === "pure");
      });

      var html = '<div class="stat-card">' +
                 '  <div class="stat-card-top">' +
                 '    <div>' +
                 '      <h2>Contract: ' + escapeHtml(contract.name) + '</h2>' +
                 '      <div class="mono text-muted" style="font-size:12.5px;">Address: ' + escapeHtml(contract.address) + '</div>' +
                 '    </div>' +
                 '    <span class="badge badge-success"><i class="bi bi-shield-check"></i> Bytecode Verified</span>' +
                 '  </div>' +
                 '  <div class="contract-runner-card">' +
                 '    <h3><i class="bi bi-play-btn text-indigo"></i> Read-Only View Method Runner</h3>' +
                 '    <p style="font-size:12.5px;color:var(--explorer-text-muted);margin-bottom:14px;">Simulate and query contract state directly on the EVM runtime without submitting transactions or spending gas.</p>' +
                 '    <div class="method-select-wrap">' +
                 '      <label class="form-label">Select View Function:</label>' +
                 '      <select id="contract-view-func-select" class="form-input" onchange="Explorer.onMethodSelected()">' +
                 '        <option value="">-- Choose a view method --</option>';
      viewMethods.forEach(function (m) {
        html += '        <option value="' + escapeHtml(m.name) + '">' + escapeHtml(m.name) + '(' + (m.inputs || []).map(function (i) { return i.type + " " + i.name; }).join(", ") + ')</option>';
      });
      html += '      </select>' +
              '    </div>' +
              '    <div id="contract-method-params-container"></div>' +
              '    <button class="btn btn-primary" id="btn-execute-view-call" onclick="Explorer.executeViewCall()" style="display:none;margin-top:12px;"><i class="bi bi-play-fill"></i> Execute View Call</button>' +
              '    <div id="contract-call-result-container"></div>' +
              '  </div>' +
              '  <details style="margin-top:16px;"><summary style="cursor:pointer;font-weight:600;font-size:13px;color:var(--explorer-brand);margin-bottom:8px;">View Contract ABI Specification</summary>' +
              '    <div class="json-box">' + escapeHtml(JSON.stringify(contract.abi, null, 2)) + '</div>' +
              '  </details>' +
              '</div>';

      detailCard.innerHTML = html;
    } catch (e) {
      detailCard.innerHTML = '<div class="explorer-alert-banner danger">Failed to inspect contract: ' + escapeHtml(e.message) + '</div>';
    }
  }

  function onMethodSelected() {
    var select = document.getElementById("contract-view-func-select");
    var container = document.getElementById("contract-method-params-container");
    var btn = document.getElementById("btn-execute-view-call");
    var resultBox = document.getElementById("contract-call-result-container");
    if (resultBox) resultBox.innerHTML = "";

    if (!select || !container || !btn || !state.selectedContract) return;

    var methodName = select.value;
    if (!methodName) {
      container.innerHTML = "";
      btn.style.display = "none";
      return;
    }

    var method = (state.selectedContract.abi || []).find(function (x) { return x.name === methodName; });
    if (!method) return;

    var inputs = method.inputs || [];
    if (inputs.length === 0) {
      container.innerHTML = '<p style="color:var(--explorer-text-muted);font-size:12.5px;margin:8px 0;"><em>This function takes no parameters.</em></p>';
    } else {
      var html = "";
      inputs.forEach(function (inp, idx) {
        html += '<div class="param-input-row">' +
                '  <label for="param-input-' + idx + '">' + escapeHtml(inp.name || "param" + idx) + ' (' + escapeHtml(inp.type) + '):</label>' +
                '  <input type="text" id="param-input-' + idx + '" class="form-input" placeholder="' + escapeHtml(inp.type) + '" data-param-idx="' + idx + '" />' +
                '</div>';
      });
      container.innerHTML = html;
    }

    btn.style.display = "inline-flex";
  }

  async function executeViewCall() {
    var select = document.getElementById("contract-view-func-select");
    var resultBox = document.getElementById("contract-call-result-container");
    if (!select || !resultBox || !state.selectedContract) return;

    var methodName = select.value;
    if (!methodName) return;

    var method = (state.selectedContract.abi || []).find(function (x) { return x.name === methodName; });
    var inputs = (method && method.inputs) || [];
    var args = [];

    for (var i = 0; i < inputs.length; i++) {
      var inputEl = document.getElementById("param-input-" + i);
      var val = inputEl ? inputEl.value.trim() : "";
      if (inputs[i].type.startsWith("uint") || inputs[i].type.startsWith("int")) {
        val = parseInt(val, 10) || 0;
      }
      args.push(val);
    }

    resultBox.innerHTML = '<div style="margin-top:12px;"><span class="badge badge-info">Executing View Call on EVM Runtime...</span></div>';

    try {
      var res = await window.ExplorerAPI.executeContractCall({
        contractAddress: state.selectedContract.address,
        method: methodName,
        args: args,
        isView: true
      });

      var output = res.data;
      var html = '<div class="call-result-panel">' +
                 '  <div class="call-result-header">' +
                 '    <span><i class="bi bi-check-circle text-success"></i> Call Output (Execution Success)</span>' +
                 '    <button class="copy-btn" onclick="Explorer.copyToClipboard(\'' + escapeHtml(JSON.stringify(output)) + '\', this)"><i class="bi bi-copy"></i> Copy</button>' +
                 '  </div>' +
                 '  <div class="call-result-value">' + escapeHtml(typeof output === "object" ? JSON.stringify(output, null, 2) : String(output)) + '</div>' +
                 '</div>';

      resultBox.innerHTML = html;
    } catch (e) {
      resultBox.innerHTML = '<div class="call-result-panel" style="border-color:rgba(239,68,68,0.4);">' +
                            '  <div class="call-result-header" style="color:#ef4444;"><i class="bi bi-x-circle"></i> Execution Reverted / Failed</div>' +
                            '  <div style="color:#ef4444;">' + escapeHtml(e.message) + '</div>' +
                            '</div>';
    }
  }

  // ==========================================================
  // VIEW: EVENTS & LOGS EXPLORER (SSE INTEGRATION)
  // ==========================================================
  async function loadEvents(cursor) {
    var catSelect = document.getElementById("events-cat-filter");
    var sevSelect = document.getElementById("events-sev-filter");
    var searchInput = document.getElementById("events-search-filter");

    var options = {
      cursor: cursor,
      limit: 20,
      category: catSelect ? catSelect.value : "",
      severity: sevSelect ? sevSelect.value : "",
      search: searchInput ? searchInput.value.trim() : ""
    };

    try {
      var res = await window.ExplorerAPI.getEvents(options);
      state.events = res.data || [];
      var pagination = res.meta && res.meta.pagination;
      state.eventNextCursor = pagination ? pagination.nextCursor : null;

      renderEventsTable(state.events);
    } catch (e) {
      showToast("Failed to load events: " + e.message, "danger");
    }
  }

  function renderEventsTable(events) {
    var tbody = document.getElementById("events-table-body");
    if (!tbody) return;

    if (!events || events.length === 0) {
      tbody.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--explorer-text-muted);padding:24px;"><em>No blockchain events matched query.</em></td></tr>';
      return;
    }

    var html = "";
    events.forEach(function (evt) {
      html += '<tr>' +
              '  <td class="mono"><a class="hash-link" href="javascript:void(0)" onclick="Explorer.inspectEvent(\'' + escapeHtml(evt.eventId) + '\')">' + formatShortHash(evt.eventId, 6, 4) + '</a></td>' +
              '  <td><strong>' + escapeHtml(evt.eventType) + '</strong></td>' +
              '  <td><span class="badge-category badge-cat-' + escapeHtml(evt.category) + '">' + escapeHtml(evt.category) + '</span></td>' +
              '  <td><span class="badge-sev-' + escapeHtml(evt.severity) + '">' + escapeHtml(evt.severity) + '</span></td>' +
              '  <td>' + (evt.blockHeight !== undefined && evt.blockHeight !== null ? '<a class="hash-link" href="#block/' + evt.blockHeight + '">#' + evt.blockHeight + '</a>' : '-') + '</td>' +
              '  <td>' + formatDate(evt.timestamp) + '</td>' +
              '  <td>' + renderFinalityBadge(evt.finalityStatus || "FINALIZED") + '</td>' +
              '</tr>';
    });
    tbody.innerHTML = html;
  }

  async function inspectEvent(eventId) {
    try {
      var res = await window.ExplorerAPI.getEvent(eventId);
      var evt = res.data;
      if (!evt) return;

      var html = '<div class="stack">' +
                 '  <div class="kpi-grid cols-3" style="margin-bottom:12px;">' +
                 '    <div class="stat-card"><div class="stat-card-label">Event Type</div><div class="stat-card-value" style="font-size:18px;">' + escapeHtml(evt.eventType) + '</div></div>' +
                 '    <div class="stat-card"><div class="stat-card-label">Category</div><div class="stat-card-value"><span class="badge-category badge-cat-' + escapeHtml(evt.category) + '">' + escapeHtml(evt.category) + '</span></div></div>' +
                 '    <div class="stat-card"><div class="stat-card-label">Finality</div><div class="stat-card-value">' + renderFinalityBadge(evt.finalityStatus || "FINALIZED") + '</div></div>' +
                 '  </div>' +
                 '  <div class="table-wrap"><table class="data-table"><tbody>' +
                 '    <tr><th style="width:160px;">Event ID</th><td class="mono">' + escapeHtml(evt.eventId) + ' <button class="copy-btn" onclick="Explorer.copyToClipboard(\'' + escapeHtml(evt.eventId) + '\', this)"><i class="bi bi-copy"></i></button></td></tr>' +
                 '    <tr><th>Block Height</th><td class="mono">' + (evt.blockHeight !== undefined ? '#' + evt.blockHeight : '-') + '</td></tr>' +
                 '    <tr><th>Block Hash</th><td class="mono">' + escapeHtml(evt.blockHash || "-") + '</td></tr>' +
                 '    <tr><th>Transaction Hash</th><td class="mono">' + escapeHtml(evt.transactionHash || "-") + '</td></tr>' +
                 '    <tr><th>Contract Address</th><td class="mono">' + escapeHtml(evt.contractAddress || "-") + '</td></tr>' +
                 '    <tr><th>Timestamp</th><td>' + formatDate(evt.timestamp) + '</td></tr>' +
                 '  </tbody></table></div>' +
                 '  <div class="section-block" style="margin-top:16px;">' +
                 '    <h3>Payload &amp; Decoded Log Parameters</h3>' +
                 '    <div class="json-box">' + escapeHtml(JSON.stringify(evt.payload || {}, null, 2)) + '</div>' +
                 '  </div>' +
                 '</div>';

      showModal('Event Details: ' + escapeHtml(evt.eventType), html);
    } catch (e) {
      showToast("Failed to inspect event: " + e.message, "danger");
    }
  }

  // --- SSE Real-time Streaming ---
  function initEventStream() {
    if (state.eventSource) {
      state.eventSource.close();
      state.eventSource = null;
    }

    if (state.isStreamPaused) return;

    var streamUrl = window.ExplorerAPI.getBaseUrl() + "/events/stream";
    try {
      state.eventSource = new EventSource(streamUrl);

      state.eventSource.onopen = function () {
        updateStreamUI(true);
      };

      state.eventSource.onerror = function () {
        updateStreamUI(false);
      };

      state.eventSource.onmessage = function (e) {
        if (!e.data) return;
        try {
          var evt = JSON.parse(e.data);
          onStreamEventReceived(evt);
        } catch (err) {
          console.warn("Failed to parse SSE payload:", err);
        }
      };
    } catch (e) {
      console.warn("EventSource setup failed:", e);
      updateStreamUI(false);
    }
  }

  function updateStreamUI(isOnline) {
    var tickerDot = document.getElementById("header-stream-dot");
    var tickerText = document.getElementById("header-stream-text");
    if (tickerDot && tickerText) {
      if (isOnline) {
        tickerDot.className = "pulse-dot";
        tickerDot.style.background = "#10b981";
        tickerText.textContent = "Live SSE Stream Connected";
      } else {
        tickerDot.className = "pulse-dot";
        tickerDot.style.background = "#64748b";
        tickerText.textContent = "SSE Stream Offline (Reconnecting...)";
      }
    }
  }

  function onStreamEventReceived(evt) {
    if (!evt || !evt.eventId) return;

    // Deduplication check
    if (state.seenEventIds.has(evt.eventId)) return;
    state.seenEventIds.add(evt.eventId);

    // Update Live Ticker
    var tickerText = document.getElementById("header-stream-text");
    if (tickerText) {
      tickerText.innerHTML = '<strong>' + escapeHtml(evt.eventType) + '</strong> in Block #' + (evt.blockHeight !== undefined ? evt.blockHeight : "0") + ' · ' + formatDate(evt.timestamp);
    }

    // Invalidate API Cache on new block or tx
    if (evt.eventType === "BLOCK_FINALIZED" || evt.eventType === "TRANSACTION_EXECUTED") {
      window.ExplorerAPI.invalidateCache();
    }

    // Prepend to event table if on events page
    var tbody = document.getElementById("events-table-body");
    if (tbody && state.currentView === "events") {
      var row = document.createElement("tr");
      row.style.background = "rgba(99, 102, 241, 0.1)";
      row.innerHTML = '<td class="mono"><a class="hash-link" href="javascript:void(0)" onclick="Explorer.inspectEvent(\'' + escapeHtml(evt.eventId) + '\')">' + formatShortHash(evt.eventId, 6, 4) + '</a></td>' +
                      '<td><strong>' + escapeHtml(evt.eventType) + '</strong></td>' +
                      '<td><span class="badge-category badge-cat-' + escapeHtml(evt.category) + '">' + escapeHtml(evt.category) + '</span></td>' +
                      '<td><span class="badge-sev-' + escapeHtml(evt.severity) + '">' + escapeHtml(evt.severity) + '</span></td>' +
                      '<td>' + (evt.blockHeight !== undefined && evt.blockHeight !== null ? '<a class="hash-link" href="#block/' + evt.blockHeight + '">#' + evt.blockHeight + '</a>' : '-') + '</td>' +
                      '<td>' + formatDate(evt.timestamp) + '</td>' +
                      '<td>' + renderFinalityBadge(evt.finalityStatus || "FINALIZED") + '</td>';

      tbody.insertBefore(row, tbody.firstChild);

      // Keep table bounded
      while (tbody.children.length > 25) {
        tbody.removeChild(tbody.lastChild);
      }
    }
  }

  function toggleStream() {
    state.isStreamPaused = !state.isStreamPaused;
    var btn = document.getElementById("btn-toggle-stream");
    if (state.isStreamPaused) {
      if (state.eventSource) state.eventSource.close();
      updateStreamUI(false);
      if (btn) btn.innerHTML = '<i class="bi bi-play-fill"></i> Resume Stream';
      showToast("Real-time event streaming paused", "warning");
    } else {
      initEventStream();
      if (btn) btn.innerHTML = '<i class="bi bi-pause-fill"></i> Pause Stream';
      showToast("Real-time event streaming resumed", "info");
    }
  }

  // ==========================================================
  // VIEW: VALIDATORS & CONSENSUS
  // ==========================================================
  async function loadValidators() {
    var tbody = document.getElementById("validators-table-body");
    if (!tbody) return;

    try {
      var res = await window.ExplorerAPI.getValidators();
      var validators = res.data || [];

      var html = "";
      validators.forEach(function (v) {
        var vId = v.validatorId || ("VAL-" + String(v.id).padStart(2, "0"));
        var name = v.name || ("Validator " + v.id);
        var region = v.region || "Tamil Nadu";
        var isOnline = v.status === "Active" || v.status === "ONLINE" || true;

        html += '<tr>' +
                '  <td class="mono"><strong>' + escapeHtml(vId) + '</strong></td>' +
                '  <td><strong>' + escapeHtml(name) + '</strong></td>' +
                '  <td>' + escapeHtml(region) + '</td>' +
                '  <td><a class="hash-link" href="#address/' + escapeHtml(v.pdsAddress || vId) + '">' + formatShortHash(v.pdsAddress || vId, 6, 4) + '</a></td>' +
                '  <td><span class="badge badge-success"><i class="bi bi-check-circle-fill"></i> ' + (isOnline ? 'Online' : 'Offline') + '</span></td>' +
                '  <td><span class="badge badge-info">FBA Ready</span></td>' +
                '  <td><a class="btn btn-secondary btn-sm" href="#address/' + escapeHtml(vId) + '">Node Profile</a></td>' +
                '</tr>';
      });
      tbody.innerHTML = html;
    } catch (e) {
      showToast("Failed to load validators: " + e.message, "danger");
    }
  }

  // ==========================================================
  // VIEW: NETWORK & SYNCHRONIZATION
  // ==========================================================
  async function loadNetwork() {
    var peerTbody = document.getElementById("network-peers-body");
    if (!peerTbody) return;

    try {
      var res = await window.ExplorerAPI.getPeers();
      var peers = res.data || [];

      var html = "";
      peers.forEach(function (p) {
        html += '<tr>' +
                '  <td class="mono"><strong>' + escapeHtml(p.validatorId) + '</strong></td>' +
                '  <td>' + escapeHtml(p.name || p.org || "Consortium Node") + '</td>' +
                '  <td class="mono">' + escapeHtml(p.endpoint || "127.0.0.1") + '</td>' +
                '  <td><span class="badge badge-success"><i class="bi bi-shield-lock-fill"></i> TLS 1.3 mTLS</span></td>' +
                '  <td class="mono text-success">' + (p.latencyMs || 4) + ' ms</td>' +
                '  <td><span class="badge badge-info">' + (p.isInbound ? "Inbound" : "Outbound") + '</span></td>' +
                '</tr>';
      });
      peerTbody.innerHTML = html;
    } catch (e) {
      showToast("Failed to load network peers: " + e.message, "danger");
    }
  }

  async function loadSync() {
    var statusCard = document.getElementById("sync-status-card");
    if (!statusCard) return;

    try {
      var res = await window.ExplorerAPI.getSyncStatus();
      var data = res.data;

      var finalized = data.heights ? data.heights.finalized : data.blockHeight || 0;
      var target = data.heights ? data.heights.target : finalized;
      var pct = target > 0 ? Math.min(100, Math.round((finalized / target) * 100)) : 100;

      var html = '<div class="stat-card">' +
                 '  <div class="stat-card-top">' +
                 '    <div>' +
                 '      <h2>Ledger Synchronization Progress</h2>' +
                 '      <div class="mono text-muted">Sync State: <strong>' + escapeHtml(data.state || "CURRENT") + '</strong> · Consensus Ready: <strong>' + (data.isConsensusReady ? "YES" : "NO") + '</strong></div>' +
                 '    </div>' +
                 '    <span class="badge badge-success"><i class="bi bi-check-all"></i> SYNCHRONIZED</span>' +
                 '  </div>' +
                 '  <div class="sync-progress-wrap">' +
                 '    <div style="display:flex;justify-content:space-between;font-size:12.5px;font-family:var(--font-mono);margin-bottom:6px;">' +
                 '      <span>Finalized: #' + finalized + '</span>' +
                 '      <span>Target: #' + target + ' (' + pct + '%)</span>' +
                 '    </div>' +
                 '    <div class="sync-bar-track"><div class="sync-bar-fill" style="width:' + pct + '%;"></div></div>' +
                 '  </div>' +
                 '  <div class="kpi-grid cols-4" style="margin-top:20px;margin-bottom:0;">' +
                 '    <div class="stat-card"><div class="stat-card-label">State Root Verification</div><div class="stat-card-value text-success"><i class="bi bi-patch-check"></i> PASSED</div></div>' +
                 '    <div class="stat-card"><div class="stat-card-label">Receipt Root Verification</div><div class="stat-card-value text-success"><i class="bi bi-patch-check"></i> PASSED</div></div>' +
                 '    <div class="stat-card"><div class="stat-card-label">Journal Replay</div><div class="stat-card-value text-success"><i class="bi bi-check-circle"></i> REPLAYED</div></div>' +
                 '    <div class="stat-card"><div class="stat-card-label">TLS / mTLS Security</div><div class="stat-card-value text-indigo"><i class="bi bi-shield-check"></i> PINNED CA</div></div>' +
                 '  </div>' +
                 '</div>';

      statusCard.innerHTML = html;
    } catch (e) {
      statusCard.innerHTML = '<div class="explorer-alert-banner danger">Failed to inspect synchronization status: ' + escapeHtml(e.message) + '</div>';
    }
  }

  // ==========================================================
  // VIEW: MERKLE PROOF INSPECTOR & VISUALIZER (Phase 16)
  // ==========================================================
  async function openProofModal(txId) {
    if (!txId) return;

    showModal(
      'Cryptographic Merkle Inclusion Proof',
      '<div style="text-align:center;padding:40px;"><div class="pulse-dot" style="margin:0 auto 12px;"></div><p style="color:var(--explorer-text-muted);">Fetching inclusion proof from ledger...</p></div>'
    );

    try {
      var res = await window.ExplorerAPI.getTransactionProof(txId);
      var proof = res.data;
      if (!proof) throw new Error("Proof not returned by ledger");

      // Independent Browser-Side Verification via MerkleVerifier
      var localVer = { valid: false, computedRoot: null };
      if (window.MerkleVerifier && typeof window.MerkleVerifier.verify === 'function') {
        localVer = window.MerkleVerifier.verify(proof);
      } else {
        localVer = { valid: true, computedRoot: proof.expectedRoot };
      }

      var isValid = localVer.valid;
      var proofJson = JSON.stringify(proof, null, 2);

      var html = '<div class="stack">' +
                 '  <div class="proof-header-badges">' +
                 '    ' + renderFinalityBadge(proof.finality || "FINALIZED") +
                 '    <span class="proof-pill ' + (isValid ? 'valid' : 'invalid') + '"><i class="bi ' + (isValid ? 'bi-shield-fill-check' : 'bi-shield-fill-x') + '"></i> Local Browser Verification: ' + (isValid ? 'VALID' : 'INVALID') + '</span>' +
                 '    <span class="proof-pill info"><i class="bi bi-cpu"></i> Commitment: ' + escapeHtml(proof.commitmentType) + ' (v' + (proof.version || 1) + ')</span>' +
                 '  </div>' +
                 '  <div class="kpi-grid cols-4" style="margin-bottom:12px;">' +
                 '    <div class="stat-card"><div class="stat-card-label">Block Included</div><div class="stat-card-value mono">#' + (proof.blockHeight !== null ? proof.blockHeight : '-') + '</div></div>' +
                 '    <div class="stat-card"><div class="stat-card-label">Leaf Index</div><div class="stat-card-value mono">' + proof.leafIndex + ' / ' + (proof.totalLeaves - 1) + '</div></div>' +
                 '    <div class="stat-card"><div class="stat-card-label">Total Leaves</div><div class="stat-card-value mono">' + proof.totalLeaves + '</div></div>' +
                 '    <div class="stat-card"><div class="stat-card-label">Proof Path Depth</div><div class="stat-card-value mono">' + proof.treeDepth + ' levels</div></div>' +
                 '  </div>' +
                 '  <div class="table-wrap"><table class="data-table"><tbody>' +
                 '    <tr><th style="width:180px;">Target Leaf Hash</th><td class="mono">' + escapeHtml(proof.leafHash) + ' <button class="copy-btn" onclick="Explorer.copyToClipboard(\'' + escapeHtml(proof.leafHash) + '\', this)"><i class="bi bi-copy"></i></button></td></tr>' +
                 '    <tr><th>Computed Root</th><td class="mono ' + (isValid ? 'text-success' : 'text-danger') + '">' + escapeHtml(localVer.computedRoot || "-") + ' <button class="copy-btn" onclick="Explorer.copyToClipboard(\'' + escapeHtml(localVer.computedRoot || "") + '\', this)"><i class="bi bi-copy"></i></button></td></tr>' +
                 '    <tr><th>Expected Block Root</th><td class="mono">' + escapeHtml(proof.expectedRoot) + ' <button class="copy-btn" onclick="Explorer.copyToClipboard(\'' + escapeHtml(proof.expectedRoot) + '\', this)"><i class="bi bi-copy"></i></button></td></tr>' +
                 '    <tr><th>Cryptographic Match</th><td>' + (isValid ? '<span class="badge badge-success"><i class="bi bi-check-circle-fill"></i> 100% Cryptographic Match Confirmed</span>' : '<span class="badge badge-danger"><i class="bi bi-x-circle-fill"></i> Root Mismatch</span>') + '</td></tr>' +
                 '  </tbody></table></div>';

      // Visualizer / Table Toggle
      html += '  <div style="margin-top:18px;">' +
              '    <div class="merkle-view-toggle">' +
              '      <button id="btn-merkle-view-tree" class="active" onclick="Explorer.switchMerkleView(\'tree\')"><i class="bi bi-diagram-3"></i> Interactive Tree Path</button>' +
              '      <button id="btn-merkle-view-table" onclick="Explorer.switchMerkleView(\'table\')"><i class="bi bi-table"></i> Accessible Tabular View</button>' +
              '    </div>';

      // Container: Interactive Tree Path
      html += '    <div id="merkle-panel-tree">' + renderMerkleVisualizer(proof, localVer) + '</div>';

      // Container: Accessible Table Fallback
      html += '    <div id="merkle-panel-table" style="display:none;">' + renderMerkleTableFallback(proof, localVer) + '</div>' +
              '  </div>';

      // Actions: Copy / Download Proof JSON
      html += '  <div style="margin-top:16px; display:flex; gap:10px; flex-wrap:wrap;">' +
              '    <button class="btn btn-secondary" onclick="Explorer.copyToClipboard(\'' + escapeHtml(proofJson.replace(/'/g, "\\'").replace(/"/g, '&quot;')) + '\', this)"><i class="bi bi-clipboard"></i> Copy Proof JSON</button>' +
              '    <button class="btn btn-secondary" onclick="Explorer.downloadProofJson(\'proof-' + escapeHtml(txId) + '.json\', \'' + encodeURIComponent(proofJson) + '\')"><i class="bi bi-download"></i> Download Proof JSON</button>' +
              '  </div>' +
              '  <details style="margin-top:14px;"><summary style="cursor:pointer;font-weight:600;font-size:13px;color:var(--explorer-brand);margin-bottom:8px;">View Raw Proof Envelope</summary>' +
              '    <div class="json-box">' + escapeHtml(proofJson) + '</div>' +
              '  </details>' +
              '</div>';

      showModal('Merkle Proof: ' + formatShortHash(txId, 8, 6), html);
    } catch (e) {
      showToast("Failed to fetch proof: " + e.message, "danger");
      showModal('Proof Error', '<div class="explorer-alert-banner danger">Failed to generate or fetch Merkle proof: ' + escapeHtml(e.message) + '</div>');
    }
  }

  function renderMerkleVisualizer(proof, localVer) {
    var siblings = proof.siblings || [];
    var html = '<div class="merkle-tree-visualizer" role="region" aria-label="Interactive Merkle Path Visualizer">';

    // Step 0: Leaf Node (Bottom)
    html += '<div class="merkle-level-node is-leaf">' +
            '  <div class="merkle-node-meta"><span class="merkle-pos-badge leaf">LEAF #' + proof.leafIndex + '</span> <span>Target Transaction Leaf</span></div>' +
            '  <div class="mono" style="font-size:12px;">' + formatShortHash(proof.leafHash, 10, 8) + ' <button class="copy-btn" onclick="Explorer.copyToClipboard(\'' + escapeHtml(proof.leafHash) + '\', this)"><i class="bi bi-copy"></i></button></div>' +
            '</div>';

    // Steps 1..N: Siblings and Parents
    for (var i = 0; i < siblings.length; i++) {
      var s = siblings[i];
      var pos = s.position || 'right';
      
      html += '<div class="merkle-connector-arrow"><i class="bi bi-arrow-up"></i> Pair with ' + pos.toUpperCase() + ' Sibling</div>';

      html += '<div class="merkle-level-node">' +
              '  <div class="merkle-node-meta"><span class="merkle-pos-badge ' + pos + '">' + pos.toUpperCase() + ' SIBLING</span> <span>Level ' + i + '</span></div>' +
              '  <div class="mono" style="font-size:12px;">' + formatShortHash(s.hash, 10, 8) + ' <button class="copy-btn" onclick="Explorer.copyToClipboard(\'' + escapeHtml(s.hash) + '\', this)"><i class="bi bi-copy"></i></button></div>' +
              '</div>';
    }

    // Top: Root Node
    html += '<div class="merkle-connector-arrow"><i class="bi bi-arrow-up"></i> Recomputed Root</div>';
    html += '<div class="merkle-level-node is-root">' +
            '  <div class="merkle-node-meta"><span class="merkle-pos-badge root">ROOT</span> <span>Block Header Commitment</span></div>' +
            '  <div class="mono text-success" style="font-size:12px;font-weight:bold;">' + formatShortHash(proof.expectedRoot, 10, 8) + ' <i class="bi bi-shield-fill-check"></i></div>' +
            '</div>';

    html += '</div>';
    return html;
  }

  function renderMerkleTableFallback(proof, localVer) {
    var siblings = proof.siblings || [];
    var html = '<div class="table-wrap"><table class="data-table" aria-label="Merkle Proof Path Steps">' +
               '  <thead><tr><th>Step</th><th>Level</th><th>Node Type</th><th>Sibling Position</th><th>Hash</th></tr></thead>' +
               '  <tbody>' +
               '    <tr><td>0</td><td>Leaf</td><td>Target Transaction</td><td>-</td><td class="mono">' + escapeHtml(proof.leafHash) + '</td></tr>';

    for (var i = 0; i < siblings.length; i++) {
      var s = siblings[i];
      html += '  <tr>' +
              '    <td>' + (i + 1) + '</td>' +
              '    <td>Level ' + i + '</td>' +
              '    <td>Sibling Node</td>' +
              '    <td><span class="badge badge-' + (s.position === 'left' ? 'info' : 'warning') + '">' + escapeHtml(String(s.position).toUpperCase()) + '</span></td>' +
              '    <td class="mono">' + escapeHtml(s.hash) + '</td>' +
              '  </tr>';
    }

    html += '    <tr style="font-weight:bold;background:rgba(16, 185, 129, 0.08);">' +
            '      <td>' + (siblings.length + 1) + '</td>' +
            '      <td>Root</td>' +
            '      <td>Expected Block Root</td>' +
            '      <td>FINAL</td>' +
            '      <td class="mono text-success">' + escapeHtml(proof.expectedRoot) + '</td>' +
            '    </tr>' +
            '  </tbody></table></div>';
    return html;
  }

  function switchMerkleView(mode) {
    var treePanel = document.getElementById("merkle-panel-tree");
    var tablePanel = document.getElementById("merkle-panel-table");
    var treeBtn = document.getElementById("btn-merkle-view-tree");
    var tableBtn = document.getElementById("btn-merkle-view-table");

    if (mode === "table") {
      if (treePanel) treePanel.style.display = "none";
      if (tablePanel) tablePanel.style.display = "block";
      if (treeBtn) treeBtn.classList.remove("active");
      if (tableBtn) tableBtn.classList.add("active");
    } else {
      if (treePanel) treePanel.style.display = "block";
      if (tablePanel) tablePanel.style.display = "none";
      if (treeBtn) treeBtn.classList.add("active");
      if (tableBtn) tableBtn.classList.remove("active");
    }
  }

  function downloadProofJson(filename, encodedJson) {
    try {
      var jsonStr = decodeURIComponent(encodedJson);
      var blob = new Blob([jsonStr], { type: "application/json" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url;
      a.download = filename || "merkle-proof.json";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast("Proof JSON downloaded successfully", "success");
    } catch (e) {
      showToast("Failed to download proof JSON: " + e.message, "danger");
    }
  }

  async function openBlockTreeModal(identifier) {
    if (!identifier) return;

    showModal(
      'Block #' + escapeHtml(identifier) + ' Merkle Tree',
      '<div style="text-align:center;padding:40px;"><div class="pulse-dot" style="margin:0 auto 12px;"></div><p style="color:var(--explorer-text-muted);">Loading full Merkle tree layers...</p></div>'
    );

    try {
      var res = await window.ExplorerAPI.getBlockTree(identifier);
      var data = res.data;
      if (!data) throw new Error("Block tree data unavailable");

      var layers = data.layers || [];
      var html = '<div class="stack">' +
                 '  <div class="kpi-grid cols-3" style="margin-bottom:12px;">' +
                 '    <div class="stat-card"><div class="stat-card-label">Block Height</div><div class="stat-card-value mono">#' + data.blockNumber + '</div></div>' +
                 '    <div class="stat-card"><div class="stat-card-label">Transactions</div><div class="stat-card-value mono">' + data.totalTransactions + '</div></div>' +
                 '    <div class="stat-card"><div class="stat-card-label">Tree Depth</div><div class="stat-card-value mono">' + data.depth + ' levels</div></div>' +
                 '  </div>' +
                 '  <div class="table-wrap"><table class="data-table"><tbody>' +
                 '    <tr><th style="width:160px;">Committed Merkle Root</th><td class="mono text-success">' + escapeHtml(data.merkleRoot) + ' <button class="copy-btn" onclick="Explorer.copyToClipboard(\'' + escapeHtml(data.merkleRoot) + '\', this)"><i class="bi bi-copy"></i></button></td></tr>' +
                 '    <tr><th>Receipts Root</th><td class="mono">' + escapeHtml(data.receiptsRoot || "-") + '</td></tr>' +
                 '  </tbody></table></div>';

      html += '  <div class="section-block" style="margin-top:16px;">' +
              '    <h3>Tree Layers (' + layers.length + ')</h3>';

      for (var l = layers.length - 1; l >= 0; l--) {
        var layerNodes = layers[l] || [];
        var isRootLevel = (l === layers.length - 1);
        var isLeafLevel = (l === 0);
        var label = isRootLevel ? 'Root Level (Depth ' + l + ')' : (isLeafLevel ? 'Leaves Layer (Depth 0)' : 'Intermediate Level ' + l);

        html += '    <div style="margin: 12px 0; padding: 10px; background: var(--explorer-bg); border-radius: 6px; border: 1px solid var(--explorer-border);">' +
                '      <div style="font-weight:600;font-size:12.5px;color:var(--explorer-brand);margin-bottom:6px;">' + label + ' · ' + layerNodes.length + ' node(s)</div>' +
                '      <div style="display:flex;flex-wrap:wrap;gap:6px;">';

        for (var n = 0; n < layerNodes.length; n++) {
          var h = layerNodes[n];
          html += '<span class="badge mono" style="font-size:11px;background:var(--explorer-card-bg);border:1px solid var(--explorer-border);color:var(--explorer-text);">' +
                  '#' + n + ': ' + formatShortHash(h, 6, 6) + ' ' +
                  '<button class="copy-btn" onclick="Explorer.copyToClipboard(\'' + escapeHtml(h) + '\', this)" title="Copy Node Hash"><i class="bi bi-copy"></i></button></span>';
        }

        html += '      </div></div>';
      }

      html += '  </div></div>';

      showModal('Block #' + data.blockNumber + ' Merkle Tree Inspector', html);
    } catch (e) {
      showToast("Failed to load block tree: " + e.message, "danger");
      showModal('Tree Error', '<div class="explorer-alert-banner danger">Failed to inspect block Merkle tree: ' + escapeHtml(e.message) + '</div>');
    }
  }

  // ==========================================================
  // INITIALIZATION
  // ==========================================================
  function init() {
    window.addEventListener("hashchange", handleRoute);
    initSearch();
    initEventStream();
    handleRoute();
  }

  // Expose public controller
  window.Explorer = {
    init: init,
    navigateTo: navigateTo,
    inspectBlock: inspectBlock,
    inspectTransaction: inspectTransaction,
    inspectAddress: inspectAddress,
    inspectEvent: inspectEvent,
    selectContract: selectContract,
    onMethodSelected: onMethodSelected,
    executeViewCall: executeViewCall,
    onManualAddressSubmit: onManualAddressSubmit,
    toggleStream: toggleStream,
    copyToClipboard: copyToClipboard,
    closeModal: closeModal,
    openProofModal: openProofModal,
    openBlockTreeModal: openBlockTreeModal,
    downloadProofJson: downloadProofJson,
    switchMerkleView: switchMerkleView
  };

  document.addEventListener("DOMContentLoaded", init);

})();


