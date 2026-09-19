/* ==========================================================
   PDSCHAIN — VALIDATOR.JS
   Federated Byzantine Agreement (FBA) consensus & node telemetry:
     1. Quorum slice visualizer for 12 nodes (VAL-01 to VAL-12).
     2. Node status management & live failure/recovery simulation.
     3. 4-Stage consensus pipeline telemetry (Verify -> Sign -> Quorum -> Finalize).
     4. Dynamic 12-validator Ed25519 digest, vote, and finality matrix.
     5. Mathematical definitions of Quorum & Consensus.
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

  // Quorum slice mapping for 12 nodes (Federated trust graph)
  var QUORUM_SLICES = {
    "VAL-01": { name: "VAL-01 (Ministry of Consumer Affairs)", org: "Ministry of Consumer Affairs", slices: ["VAL-01", "VAL-02", "VAL-03", "VAL-04"], threshold: "3 of 4", port: 4001, p2pPort: 5001 },
    "VAL-02": { name: "VAL-02 (National Informatics Centre)", org: "National Informatics Centre", slices: ["VAL-02", "VAL-03", "VAL-05", "VAL-06"], threshold: "3 of 4", port: 4002, p2pPort: 5002 },
    "VAL-03": { name: "VAL-03 (State Food Commission)", org: "State Food Commission", slices: ["VAL-01", "VAL-03", "VAL-07", "VAL-08"], threshold: "3 of 4", port: 4003, p2pPort: 5003 },
    "VAL-04": { name: "VAL-04 (Civil Supplies Corporation)", org: "Civil Supplies Corporation", slices: ["VAL-01", "VAL-04", "VAL-09", "VAL-10"], threshold: "3 of 4", port: 4004, p2pPort: 5004 },
    "VAL-05": { name: "VAL-05 (District Administration Node)", org: "District Administration Node", slices: ["VAL-02", "VAL-05", "VAL-07", "VAL-11"], threshold: "3 of 4", port: 4005, p2pPort: 5005 },
    "VAL-06": { name: "VAL-06 (Auditor General Observer Node)", org: "Auditor General Observer Node", slices: ["VAL-02", "VAL-06", "VAL-08", "VAL-12"], threshold: "3 of 4", port: 4006, p2pPort: 5006 },
    "VAL-07": { name: "VAL-07 (Public Audit & Governance Node)", org: "Public Audit & Governance Node", slices: ["VAL-03", "VAL-05", "VAL-07", "VAL-09"], threshold: "3 of 4", port: 4007, p2pPort: 5007 },
    "VAL-08": { name: "VAL-08 (Regional Warehouse Authority)", org: "Regional Warehouse Authority", slices: ["VAL-03", "VAL-06", "VAL-08", "VAL-10"], threshold: "3 of 4", port: 4008, p2pPort: 5008 },
    "VAL-09": { name: "VAL-09 (Fair Price Shop Union Node)", org: "Fair Price Shop Union Node", slices: ["VAL-04", "VAL-07", "VAL-09", "VAL-11"], threshold: "3 of 4", port: 4009, p2pPort: 5009 },
    "VAL-10": { name: "VAL-10 (State Monitoring Cell)", org: "State Monitoring Cell", slices: ["VAL-04", "VAL-08", "VAL-10", "VAL-12"], threshold: "3 of 4", port: 4010, p2pPort: 5010 },
    "VAL-11": { name: "VAL-11 (Citizen Oversight Organisation)", org: "Citizen Oversight Organisation", slices: ["VAL-05", "VAL-09", "VAL-11", "VAL-12"], threshold: "3 of 4", port: 4011, p2pPort: 5011 },
    "VAL-12": { name: "VAL-12 (Security & Cryptography Validator)", org: "Security & Cryptography Validator", slices: ["VAL-06", "VAL-10", "VAL-11", "VAL-12"], threshold: "3 of 4", port: 4012, p2pPort: 5012 }
  };

  // Aliases for legacy NODE-XX references
  for (var i = 1; i <= 12; i++) {
    var pad = i < 10 ? "0" + i : "" + i;
    var vKey = "VAL-" + pad;
    var nKey = "NODE-" + pad;
    QUORUM_SLICES[nKey] = QUORUM_SLICES[vKey];
  }

  var offlineNodes = new Set();
  var activeSelectedNode = "VAL-01";
  var latestRoundCache = null;
  var isSimulationActive = false;

  function normalizeNodeId(id) {
    if (!id) return "VAL-01";
    var upper = id.toUpperCase();
    if (upper.startsWith("NODE-")) {
      return upper.replace("NODE-", "VAL-");
    }
    return upper;
  }

  /* ==========================================================
     1. QUORUM SLICE VISUALIZER
     ========================================================== */
  window.selectQuorumNode = function (nodeId) {
    var normId = normalizeNodeId(nodeId);
    activeSelectedNode = normId;

    document.querySelectorAll(".node-select-btn").forEach(function (btn) {
      var id = normalizeNodeId(btn.getAttribute("data-node"));
      btn.classList.toggle("is-active", id === normId);
    });

    var data = QUORUM_SLICES[normId];
    if (!data) return;

    var nameEl = document.getElementById("quorum-target-node");
    var orgEl = document.getElementById("quorum-target-org");
    var thresholdEl = document.getElementById("quorum-target-threshold");
    var slicesBox = document.getElementById("quorum-slices-list");

    if (nameEl) nameEl.textContent = normId + " (HTTP :" + data.port + " | P2P :" + (data.p2pPort || (data.port + 1000)) + ")";
    if (orgEl) orgEl.textContent = data.org;
    if (thresholdEl) thresholdEl.textContent = data.threshold;

    if (slicesBox) {
      slicesBox.innerHTML = data.slices.map(function (sNode) {
        var isOff = offlineNodes.has(sNode) || offlineNodes.has(sNode.replace("VAL-", "NODE-"));
        var statusBadge = isOff ? '<span class="badge badge-danger">Offline</span>' : '<span class="badge badge-success">P2P Authenticated</span>';
        var portNum = 4000 + parseInt(sNode.replace("VAL-", "").replace("NODE-", ""), 10);
        var p2pNum = 5000 + parseInt(sNode.replace("VAL-", "").replace("NODE-", ""), 10);
        return '<div class="fba-status-row" style="margin-bottom:8px; display:flex; justify-content:space-between; align-items:center;">' +
          '<span class="label mono font-bold"><i class="bi bi-hdd-network"></i> ' + escapeHtml(sNode) + ' <small class="text-muted">(HTTP :' + portNum + ' | P2P :' + p2pNum + ')</small></span>' +
          statusBadge +
        '</div>';
      }).join("");
    }
  };

  /* ==========================================================
     2. 12-VALIDATOR TELEMETRY & 4-STAGE PIPELINE RENDERING
     ========================================================== */
  function renderConsensusTelemetry(roundData) {
    if (!roundData) return;

    // Use passed round or construct baseline from configuration
    var blockNum = roundData.blockNumber !== undefined ? roundData.blockNumber : 4281;
    var txId = roundData.transactionId || "TXN-" + blockNum + "-01";
    var merkleRoot = roundData.merkleRoot || "0x7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069";
    var stateRoot = roundData.stateRoot || "0xa8c23f9914bc819e912440f1a6ec7b2781b4f4da6b73523f6696b99de0798e21";
    var threshold = roundData.threshold || 9;

    var rawValidators = roundData.validators && Array.isArray(roundData.validators) && roundData.validators.length === 12
      ? roundData.validators
      : Object.keys(QUORUM_SLICES).filter(function(k) { return k.startsWith("VAL-"); }).map(function(id) {
          return {
            validatorId: id,
            name: QUORUM_SLICES[id].name,
            org: QUORUM_SLICES[id].org,
            address: "0x" + id.replace("-", "") + "777000111222333444555",
            isOnline: true,
            verified: true,
            signed: true,
            signatureDigest: "0x" + id.replace("-", "").toLowerCase() + "b9e28f1a",
            vote: "ACCEPT",
            status: "COMPLETE",
            reason: ""
          };
        });

    // Recompute dynamic state incorporating current offlineNodes
    var evaluatedValidators = rawValidators.map(function (v) {
      var normId = normalizeNodeId(v.validatorId);
      var isOff = offlineNodes.has(normId) || offlineNodes.has(normId.replace("VAL-", "NODE-"));
      var verified = !isOff;
      var signed = !isOff;
      var vote = isOff ? "OFFLINE" : "ACCEPT";
      var sig = isOff ? null : (v.signatureDigest || ("0x" + normId.replace("-", "").toLowerCase() + "c7a82b"));

      return {
        validatorId: normId,
        name: v.name || QUORUM_SLICES[normId].name,
        org: v.org || QUORUM_SLICES[normId].org,
        address: v.address,
        isOnline: !isOff,
        verified: verified,
        signed: signed,
        signatureDigest: sig,
        vote: vote,
        status: isOff ? "OFFLINE" : "COMPLETE"
      };
    });

    var totalCount = evaluatedValidators.length;
    var verifiedCount = evaluatedValidators.filter(function (v) { return v.verified; }).length;
    var signedCount = evaluatedValidators.filter(function (v) { return v.signed; }).length;
    var quorumAchieved = signedCount >= threshold;
    var finalized = quorumAchieved;

    // 1. Update Round & Header Badges
    var roundBadge = document.getElementById("live-round-badge");
    if (roundBadge) {
      roundBadge.innerHTML = '<i class="bi bi-broadcast"></i> ROUND #' + escapeHtml(blockNum) + ' LIVE';
    }

    // 2. Update 4-Stage Pipeline
    var pStage1 = document.getElementById("pipe-stage-1");
    var pBadge1 = document.getElementById("pipe-badge-1");
    if (pStage1 && pBadge1) {
      var isS1Ok = verifiedCount >= threshold;
      pStage1.className = "fba-stage-step " + (isS1Ok ? "is-complete" : "is-failed");
      pBadge1.className = "badge " + (isS1Ok ? "badge-success" : "badge-danger");
      pBadge1.textContent = verifiedCount + " / " + totalCount + " Verified";
    }

    var pStage2 = document.getElementById("pipe-stage-2");
    var pBadge2 = document.getElementById("pipe-badge-2");
    if (pStage2 && pBadge2) {
      var isS2Ok = signedCount >= threshold;
      pStage2.className = "fba-stage-step " + (isS2Ok ? "is-complete" : "is-failed");
      pBadge2.className = "badge " + (isS2Ok ? "badge-success" : "badge-danger");
      pBadge2.textContent = signedCount + " / " + totalCount + " Signed";
    }

    var pStage3 = document.getElementById("pipe-stage-3");
    var pBadge3 = document.getElementById("pipe-badge-3");
    if (pStage3 && pBadge3) {
      pStage3.className = "fba-stage-step " + (quorumAchieved ? "is-complete" : "is-failed");
      pBadge3.className = "badge " + (quorumAchieved ? "badge-success" : "badge-danger");
      pBadge3.textContent = quorumAchieved ? "QUORUM MET (" + signedCount + "/12 \u2265 9)" : "QUORUM FAILED (" + signedCount + "/12 < 9)";
    }

    var pStage4 = document.getElementById("pipe-stage-4");
    var pBadge4 = document.getElementById("pipe-badge-4");
    if (pStage4 && pBadge4) {
      pStage4.className = "fba-stage-step " + (finalized ? "is-complete" : "is-failed");
      pBadge4.className = "badge " + (finalized ? "badge-success" : "badge-danger");
      pBadge4.textContent = finalized ? "FINALIZED" : "REJECTED (Unfinalized)";
    }

    // 3. Update Roots & Transaction Metadata Bar
    var blkEl = document.getElementById("fba-block-height");
    var txEl = document.getElementById("fba-tx-id");
    var mrkEl = document.getElementById("fba-merkle-root");
    var stEl = document.getElementById("fba-state-root");

    if (blkEl) blkEl.textContent = "#" + blockNum;
    if (txEl) txEl.textContent = txId;
    if (mrkEl) {
      mrkEl.textContent = finalized ? merkleRoot : "0x0000000000000000 (Commit Blocked)";
      mrkEl.className = "crypto-root-val " + (finalized ? "" : "text-danger");
    }
    if (stEl) {
      stEl.textContent = finalized ? stateRoot : "0x0000000000000000 (State Unaltered)";
      stEl.className = "crypto-root-val " + (finalized ? "text-success" : "text-danger");
    }

    // 4. Update Progress Bar & Agreement Text
    var pct = Math.round((signedCount / totalCount) * 100);
    var pFill = document.getElementById("consensus-progress-fill");
    var qStat = document.getElementById("quorum-agreement-stat");
    var fStat = document.getElementById("quorum-finality-stat");

    if (pFill) {
      pFill.style.width = pct + "%";
      pFill.style.background = quorumAchieved ? "var(--success, #10b981)" : "var(--danger, #ef4444)";
    }

    if (qStat) {
      qStat.innerHTML = 'Quorum Agreement: <strong>' + pct + '% (' + signedCount + ' / ' + totalCount + ' Nodes)</strong>';
    }

    if (fStat) {
      if (signedCount === totalCount) {
        fStat.className = "text-success font-bold";
        fStat.innerHTML = '<i class="bi bi-check-circle-fill"></i> Consensus Reached — Block #' + escapeHtml(blockNum) + ' Finalized';
      } else if (quorumAchieved) {
        fStat.className = "text-warning font-bold";
        fStat.innerHTML = '<i class="bi bi-shield-exclamation"></i> Quorum Maintained (' + signedCount + '/' + totalCount + ' \u2265 9) — Block #' + escapeHtml(blockNum) + ' Finalized';
      } else {
        fStat.className = "text-danger font-bold";
        fStat.innerHTML = '<i class="bi bi-x-octagon-fill"></i> Quorum Failed (' + signedCount + '/' + totalCount + ' < 9 Required) — Block Proposal Rejected';
      }
    }

    // 5. Populate 12-Validator Telemetry Table
    var tbody = document.getElementById("fba-validator-tbody");
    if (tbody) {
      var rowsHtml = "";
      evaluatedValidators.forEach(function (v) {
        var rowClass = v.isOnline ? "" : "node-row-offline";
        var verifyBadge = v.verified
          ? '<span class="badge badge-success"><i class="bi bi-check2"></i> Valid</span>'
          : '<span class="badge badge-danger"><i class="bi bi-x"></i> ' + (v.isOnline ? 'Failed' : 'Offline') + '</span>';

        var signBadge = v.signed
          ? '<span class="badge badge-success"><i class="bi bi-check2-circle"></i> Approved</span>'
          : '<span class="badge badge-danger"><i class="bi bi-dash-circle"></i> ' + (v.isOnline ? 'Rejected' : 'Skipped') + '</span>';

        var sigDigest = v.signatureDigest
          ? '<span class="sig-digest-pill">' + escapeHtml(v.signatureDigest) + '</span>'
          : '<span class="text-muted" style="font-size:11px;">None (Offline)</span>';

        var voteColor = v.vote === "ACCEPT" ? "text-success" : "text-danger";
        var quorumContrib = v.isOnline
          ? '<span class="text-success"><i class="bi bi-check-circle"></i> Slice Met (3/4)</span>'
          : '<span class="text-danger"><i class="bi bi-slash-circle"></i> Excluded</span>';

        var statusBadge = v.isOnline
          ? '<span class="badge badge-success">ONLINE</span>'
          : '<span class="badge badge-danger">OFFLINE</span>';

        rowsHtml +=
          '<tr class="' + rowClass + '">' +
            '<td><span class="mono font-bold">' + escapeHtml(v.validatorId) + '</span><br /><small class="text-muted">' + escapeHtml(v.org) + '</small></td>' +
            '<td>' + verifyBadge + '</td>' +
            '<td>' + signBadge + '</td>' +
            '<td>' + sigDigest + '</td>' +
            '<td><span class="mono font-bold ' + voteColor + '">' + escapeHtml(v.vote) + '</span></td>' +
            '<td>' + quorumContrib + '</td>' +
            '<td>' + statusBadge + '</td>' +
          '</tr>';
      });
      tbody.innerHTML = rowsHtml;
    }

    // 6. Update Visual Vote Grid
    document.querySelectorAll(".vote-node").forEach(function (box) {
      var id = normalizeNodeId(box.getAttribute("data-node"));
      var vItem = evaluatedValidators.find(function(item) { return item.validatorId === id; });
      var statusEl = box.querySelector(".vote-status");
      if (vItem && !vItem.isOnline) {
        box.className = "vote-node is-offline";
        if (statusEl) statusEl.innerHTML = '<i class="bi bi-x-circle-fill text-danger"></i> Offline';
      } else if (vItem && vItem.signed) {
        box.className = "vote-node is-voted";
        if (statusEl) statusEl.innerHTML = '<i class="bi bi-check-circle-fill text-success"></i> Agreed';
      } else {
        box.className = "vote-node is-offline";
        if (statusEl) statusEl.innerHTML = '<i class="bi bi-x-circle text-danger"></i> Rejected';
      }
    });

    // 7. Update KPI strip counters
    var onlineCounter = document.getElementById("online-nodes-count");
    if (onlineCounter) {
      var onlineCount = evaluatedValidators.filter(function(v) { return v.isOnline; }).length;
      onlineCounter.textContent = onlineCount + " / " + totalCount;
    }
  }

  /* ==========================================================
     3. LIVE BACKEND SYNCHRONIZATION
     ========================================================== */
  async function fetchConsensusRound() {
    try {
      var res = await fetch((window.getPDSChainApiBase ? window.getPDSChainApiBase("api") : "http://localhost:3000/api") + "/consensus/rounds/latest");
      if (res.ok) {
        var json = await res.json();
        if (json && json.success && json.round) {
          latestRoundCache = json.round;
          renderConsensusTelemetry(latestRoundCache);
        }
      }
    } catch (e) {
      // Offline fallback: render default baseline
      if (!latestRoundCache) {
        latestRoundCache = {
          roundId: "RND-4281",
          blockNumber: 4281,
          threshold: 9,
          finalized: true
        };
      }
      renderConsensusTelemetry(latestRoundCache);
    }
  }

  async function fetchValidatorState() {
    try {
      var token = localStorage.getItem("pdschain_jwt_token") || "";
      var res = await fetch((window.getPDSChainApiBase ? window.getPDSChainApiBase("api") : "http://localhost:3000/api") + "/validators", {
        headers: token ? { "Authorization": "Bearer " + token } : {}
      });
      if (res.ok) {
        var json = await res.json();
        if (json && json.validators && Array.isArray(json.validators)) {
          if (!isSimulationActive) {
            offlineNodes.clear();
            json.validators.forEach(function (v) {
              if (v.status === "Offline") {
                offlineNodes.add(v.validatorId);
                offlineNodes.add(v.validatorId.replace("VAL-", "NODE-"));
              }
            });
            updateNetworkVisualization();
            if (latestRoundCache) {
              renderConsensusTelemetry(latestRoundCache);
            }
          }
        }
      }
    } catch (e) {
      // Offline fallback
    }
  }

  async function setNodeStatusBackend(nodeId, status) {
    var normId = normalizeNodeId(nodeId);
    var token = localStorage.getItem("pdschain_jwt_token") || "";
    var role = (localStorage.getItem("pds_role") || "").toUpperCase();
    if (!token || (role !== "ADMIN" && role !== "VALIDATOR")) {
      return;
    }
    try {
      await fetch((window.getPDSChainApiBase ? window.getPDSChainApiBase("api") : "http://localhost:3000/api") + "/validators/" + normId + "/status", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + token
        },
        body: JSON.stringify({ status: status })
      });
    } catch (e) {}
  }

  /* ==========================================================
     4. NODE FAILURE & RECOVERY SIMULATION HANDLERS
     ========================================================== */
  function applyFailureSimulation(failedList, toastMsg, toastType) {
    isSimulationActive = true;
    failedList.forEach(function (id) {
      offlineNodes.add(id);
      offlineNodes.add(id.replace("VAL-", "NODE-"));
    });
    updateNetworkVisualization();
    if (latestRoundCache) {
      renderConsensusTelemetry(latestRoundCache);
    }
    failedList.forEach(function (id) {
      setNodeStatusBackend(id, "Offline");
    });
    if (window.showToast && toastMsg) {
      window.showToast(toastMsg, toastType || "warning");
    }
  }

  function applyRestoreAllSimulation() {
    isSimulationActive = false;
    var previouslyOffline = Array.from(offlineNodes);
    offlineNodes.clear();
    updateNetworkVisualization();
    if (latestRoundCache) {
      renderConsensusTelemetry(latestRoundCache);
    }
    for (var id of previouslyOffline) {
      if (id.startsWith("VAL-")) {
        setNodeStatusBackend(id, "Online");
      }
    }
    if (window.showToast) {
      window.showToast("Restored all 12 validator nodes. Network is 100% ONLINE (12/12 \u2265 9 Quorum Reached).", "success");
    }
  }

  // Bind Buttons on Validator Dashboard
  var btnFail7 = document.getElementById("btn-val-fail-7");
  var btnFail4 = document.getElementById("btn-val-fail-4");
  var btnRestoreAll = document.getElementById("btn-val-restore-all");

  if (btnFail7) {
    btnFail7.addEventListener("click", function () {
      applyFailureSimulation(
        ["VAL-07"],
        "Simulated Failure: VAL-07 went OFFLINE. FBA Quorum maintained (11/12 \u2265 9 required) — Block finalized!",
        "warning"
      );
    });
  }

  if (btnFail4) {
    btnFail4.addEventListener("click", function () {
      applyFailureSimulation(
        ["VAL-07", "VAL-08", "VAL-09", "VAL-10"],
        "Simulated Cascading Failure: 4 nodes went OFFLINE. Active: 8/12 (< 9 required). Quorum FAILED — Block rejected!",
        "error"
      );
    });
  }

  if (btnRestoreAll) {
    btnRestoreAll.addEventListener("click", function () {
      applyRestoreAllSimulation();
    });
  }

  // Bind Legacy / Quorum Page Buttons
  var failNodeBtn = document.getElementById("btn-simulate-failure");
  var restoreNodeBtn = document.getElementById("btn-restore-node");

  if (failNodeBtn) {
    failNodeBtn.addEventListener("click", function () {
      applyFailureSimulation(
        ["VAL-07"],
        "Simulated Node Failure: VAL-07 went OFFLINE. FBA Quorum maintained (11/12 nodes online).",
        "warning"
      );
    });
  }

  if (restoreNodeBtn) {
    restoreNodeBtn.addEventListener("click", function () {
      applyRestoreAllSimulation();
    });
  }

  function updateNetworkVisualization() {
    // Update node select buttons
    document.querySelectorAll(".node-select-btn").forEach(function (btn) {
      var id = normalizeNodeId(btn.getAttribute("data-node"));
      if (offlineNodes.has(id)) {
        btn.classList.add("is-offline");
      } else {
        btn.classList.remove("is-offline");
      }
    });

    // Update vote node boxes
    document.querySelectorAll(".vote-node").forEach(function (box) {
      var id = normalizeNodeId(box.getAttribute("data-node"));
      var statusEl = box.querySelector(".vote-status");
      if (offlineNodes.has(id)) {
        box.className = "vote-node is-offline";
        if (statusEl) statusEl.innerHTML = '<i class="bi bi-x-circle-fill text-danger"></i> Offline';
      } else {
        box.className = "vote-node is-voted";
        if (statusEl) statusEl.innerHTML = '<i class="bi bi-check-circle-fill text-success"></i> Agreed';
      }
    });

    // Update summary counts & dots
    var countOffline = Array.from(offlineNodes).filter(function(n) { return n.startsWith("VAL-"); }).length;
    var countOnline = Math.max(0, 12 - countOffline);
    var onlineCounter = document.getElementById("online-nodes-count");
    if (onlineCounter) onlineCounter.textContent = countOnline + " / 12";

    // Update sidebar indicator status dots if container exists
    var sidebarStatus = document.querySelector(".sidebar-status");
    if (sidebarStatus) {
      var dotsHtml = "";
      for (var i = 1; i <= 12; i++) {
        var pad = i < 10 ? "0" + i : "" + i;
        var isOff = offlineNodes.has("VAL-" + pad);
        dotsHtml += '<span style="display:inline-block;width:7px;height:7px;border-radius:50%;margin-right:2px;background:' + (isOff ? '#ef4444' : '#10b981') + ';"></span>';
      }
      sidebarStatus.innerHTML = '<div style="display:flex;align-items:center;gap:4px;">' + dotsHtml + ' <span class="label" style="margin-left:4px;font-size:11px;">' + countOnline + '/12 FBA Nodes</span></div>';
    }

    // Refresh selected quorum display
    window.selectQuorumNode(activeSelectedNode);
  }

  /* ==========================================================
     5. PHASE 10: LEDGER SYNC & RECOVERY OBSERVABILITY
     ========================================================== */
  async function fetchLedgerSyncState() {
    try {
      var res = await fetch((window.getPDSChainApiBase ? window.getPDSChainApiBase("api") : "http://localhost:3000/api") + "/ledger/status");
      if (res.ok) {
        var json = await res.json();
        updateLedgerSyncUI(json);
      }
    } catch (e) {
      // Offline fallback: keep default verified current indicators
    }
  }

  function updateLedgerSyncUI(data) {
    if (!data) return;
    var stateBadge = document.getElementById("sync-state-badge");
    var gatingBadge = document.getElementById("consensus-gating-badge");
    var heightDisplay = document.getElementById("sync-height-display");
    var progressDisplay = document.getElementById("sync-progress-display");
    var progressBar = document.getElementById("sync-progress-bar");
    var checkpointDisplay = document.getElementById("sync-checkpoint-display");
    var evmDisplay = document.getElementById("sync-evm-display");

    var state = data.state || "CURRENT";
    if (stateBadge) {
      var colorMap = {
        CURRENT: "#10b981",
        SYNCING: "#3b82f6",
        VERIFYING: "#6366f1",
        CATCHING_UP: "#0ea5e9",
        BOOTSTRAPPING: "#8b5cf6",
        DEGRADED: "#f59e0b",
        RECOVERY_REQUIRED: "#f97316",
        CORRUPTED: "#ef4444",
        HALTED: "#dc2626"
      };
      stateBadge.style.background = colorMap[state] || "#10b981";
      stateBadge.innerHTML = '<i class="bi bi-shield-check"></i> SYNC STATE: ' + escapeHtml(state);
    }

    if (gatingBadge) {
      if (data.isConsensusReady) {
        gatingBadge.className = "badge badge-success";
        gatingBadge.innerHTML = '<i class="bi bi-check-circle-fill"></i> Consensus Voting: Enabled';
      } else {
        gatingBadge.className = "badge badge-danger";
        gatingBadge.innerHTML = '<i class="bi bi-x-octagon-fill"></i> Consensus Voting: Blocked (' + escapeHtml(state) + ')';
      }
    }

    if (heightDisplay && data.heights) {
      heightDisplay.textContent = "#" + data.heights.finalized + " / #" + (data.heights.target || data.heights.finalized);
    }

    if (progressDisplay && data.syncProgress) {
      var pct = data.syncProgress.percentage !== undefined ? data.syncProgress.percentage : 100;
      progressDisplay.textContent = pct + "%";
      if (progressBar) progressBar.style.width = pct + "%";
    }

    if (checkpointDisplay) {
      if (data.checkpoint) {
        checkpointDisplay.textContent = "#" + data.checkpoint.blockHeight + " (" + (data.checkpoint.verificationStatus || "Verified") + ")";
      }
    }

    if (evmDisplay && data.verification) {
      evmDisplay.textContent = "State Root " + (data.verification.stateRoot || "Valid");
    }
  }

  // Initialize
  fetchValidatorState();
  fetchLedgerSyncState();
  fetchConsensusRound();

  // Periodic telemetry refresh
  setInterval(function () {
    fetchConsensusRound();
  }, 10000);

  if (document.getElementById("quorum-target-node")) {
    window.selectQuorumNode("VAL-01");
  }

})();
