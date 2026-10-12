/* ==========================================================
   PDSCHAIN — VALIDATOR.JS
   Federated Byzantine Agreement (FBA) consensus & node telemetry:
     1. Quorum slice visualizer for 12 nodes (V1..V12 / VAL-01..VAL-12).
     2. Interactive pending proposal & authenticated 12-validator voting (Cases A, B, C, D).
     3. Node status management & live failure/recovery simulation.
     4. 4-Stage consensus pipeline telemetry (Verify -> Sign -> Quorum -> Finalize).
     5. Dynamic 12-validator Ed25519 digest, vote, OS process PID/Port, and finality matrix.
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
    "VAL-01": { shortId: "V1", name: "VAL-01 (Ministry of Consumer Affairs)", org: "Ministry of Consumer Affairs", slices: ["VAL-01", "VAL-02", "VAL-03", "VAL-04"], threshold: "3 of 4", port: 4001, p2pPort: 5001 },
    "VAL-02": { shortId: "V2", name: "VAL-02 (National Informatics Centre)", org: "National Informatics Centre", slices: ["VAL-02", "VAL-03", "VAL-05", "VAL-06"], threshold: "3 of 4", port: 4002, p2pPort: 5002 },
    "VAL-03": { shortId: "V3", name: "VAL-03 (State Food Commission)", org: "State Food Commission", slices: ["VAL-01", "VAL-03", "VAL-07", "VAL-08"], threshold: "3 of 4", port: 4003, p2pPort: 5003 },
    "VAL-04": { shortId: "V4", name: "VAL-04 (Civil Supplies Corporation)", org: "Civil Supplies Corporation", slices: ["VAL-01", "VAL-04", "VAL-09", "VAL-10"], threshold: "3 of 4", port: 4004, p2pPort: 5004 },
    "VAL-05": { shortId: "V5", name: "VAL-05 (District Administration Node)", org: "District Administration Node", slices: ["VAL-02", "VAL-05", "VAL-07", "VAL-11"], threshold: "3 of 4", port: 4005, p2pPort: 5005 },
    "VAL-06": { shortId: "V6", name: "VAL-06 (Auditor General Observer Node)", org: "Auditor General Observer Node", slices: ["VAL-02", "VAL-06", "VAL-08", "VAL-12"], threshold: "3 of 4", port: 4006, p2pPort: 5006 },
    "VAL-07": { shortId: "V7", name: "VAL-07 (Public Audit & Governance Node)", org: "Public Audit & Governance Node", slices: ["VAL-03", "VAL-05", "VAL-07", "VAL-09"], threshold: "3 of 4", port: 4007, p2pPort: 5007 },
    "VAL-08": { shortId: "V8", name: "VAL-08 (Regional Warehouse Authority)", org: "Regional Warehouse Authority", slices: ["VAL-03", "VAL-06", "VAL-08", "VAL-10"], threshold: "3 of 4", port: 4008, p2pPort: 5008 },
    "VAL-09": { shortId: "V9", name: "VAL-09 (Fair Price Shop Union Node)", org: "Fair Price Shop Union Node", slices: ["VAL-04", "VAL-07", "VAL-09", "VAL-11"], threshold: "3 of 4", port: 4009, p2pPort: 5009 },
    "VAL-10": { shortId: "V10", name: "VAL-10 (State Monitoring Cell)", org: "State Monitoring Cell", slices: ["VAL-04", "VAL-08", "VAL-10", "VAL-12"], threshold: "3 of 4", port: 4010, p2pPort: 5010 },
    "VAL-11": { shortId: "V11", name: "VAL-11 (Citizen Oversight Organisation)", org: "Citizen Oversight Organisation", slices: ["VAL-05", "VAL-09", "VAL-11", "VAL-12"], threshold: "3 of 4", port: 4011, p2pPort: 5011 },
    "VAL-12": { shortId: "V12", name: "VAL-12 (Security & Cryptography Validator)", org: "Security & Cryptography Validator", slices: ["VAL-06", "VAL-10", "VAL-11", "VAL-12"], threshold: "3 of 4", port: 4012, p2pPort: 5012 }
  };

  for (var i = 1; i <= 12; i++) {
    var pad = i < 10 ? "0" + i : "" + i;
    var vKey = "VAL-" + pad;
    var nKey = "NODE-" + pad;
    QUORUM_SLICES[nKey] = QUORUM_SLICES[vKey];
    QUORUM_SLICES["V" + i] = QUORUM_SLICES[vKey];
  }

  var offlineNodes = new Set();
  var validatorDirectoryMap = {};
  var activeSelectedNode = "VAL-01";
  var latestRoundCache = null;
  var activeProposalCache = null;
  var isSimulationActive = false;

  function normalizeNodeId(id) {
    if (!id) return "VAL-01";
    var upper = String(id).trim().toUpperCase();
    if (upper.startsWith("NODE-")) {
      return upper.replace("NODE-", "VAL-");
    }
    var mShort = upper.match(/^V(0?[1-9]|1[0-2])$/);
    if (mShort) {
      var n = parseInt(mShort[1], 10);
      return "VAL-" + (n < 10 ? "0" + n : "" + n);
    }
    return upper;
  }

  function getShortId(valId) {
    var norm = normalizeNodeId(valId);
    return (QUORUM_SLICES[norm] && QUORUM_SLICES[norm].shortId) || norm;
  }

  function getApiBase() {
    return window.getPDSChainApiBase ? window.getPDSChainApiBase("api") : "http://localhost:3000/api";
  }

  function getLoggedInValidatorIdentity() {
    try {
      var userObj = JSON.parse(localStorage.getItem("pdschain_user") || "null");
      var valId = (userObj && (userObj.validatorId || userObj.entityId)) || localStorage.getItem("pds_validator_id") || "";
      var username = (userObj && userObj.username) || localStorage.getItem("pds_username") || "";
      if (!valId && username) {
        var normFromUser = normalizeNodeId(username);
        if (QUORUM_SLICES[normFromUser]) {
          valId = normFromUser;
        }
      }
      var normVal = valId ? normalizeNodeId(valId) : "VAL-07";
      if (!QUORUM_SLICES[normVal]) normVal = "VAL-07";
      var meta = QUORUM_SLICES[normVal];
      return {
        validatorId: normVal,
        shortId: meta.shortId,
        org: meta.org,
        port: meta.port,
        role: (userObj && userObj.role) || localStorage.getItem("pds_role") || "validator",
        username: username || meta.shortId.toLowerCase()
      };
    } catch (e) {
      return {
        validatorId: "VAL-07",
        shortId: "V7",
        org: "Public Audit & Governance Node",
        port: 4007,
        role: "validator",
        username: "v7"
      };
    }
  }

  function updateSessionIdentityUI() {
    var identity = getLoggedInValidatorIdentity();
    var avatarEl = document.getElementById("active-validator-avatar");
    var nameEl = document.getElementById("active-validator-name");
    var roleEl = document.getElementById("active-validator-role");
    var pageTitle = document.getElementById("page-validator-title");
    var pageSub = document.getElementById("page-validator-subtitle");
    var sessionBadge = document.getElementById("session-validator-badge");
    var approveLabel = document.getElementById("btn-vote-approve-label");
    var rejectLabel = document.getElementById("btn-vote-reject-label");
    var kpiPort = document.getElementById("kpi-node-port");

    if (avatarEl) avatarEl.textContent = identity.shortId;
    if (nameEl) nameEl.textContent = identity.shortId + " (" + identity.validatorId + ")";
    if (roleEl) roleEl.textContent = identity.org;
    if (pageTitle) {
      pageTitle.textContent = "Validator " + identity.shortId + " (" + identity.validatorId + ") — FBA Consensus & Telemetry";
    }
    if (pageSub) {
      pageSub.textContent = "Authenticated Validator Session: " + identity.shortId + " (" + identity.validatorId + " · " + identity.org + ") — 9-of-12 FBA Quorum.";
    }
    if (sessionBadge) {
      sessionBadge.innerHTML = '<i class="bi bi-person-check-fill"></i> LOGGED IN AS: ' + escapeHtml(identity.shortId + " (" + identity.validatorId + ")");
    }
    if (approveLabel) {
      approveLabel.textContent = "Approve & Sign as " + identity.shortId;
    }
    if (rejectLabel) {
      rejectLabel.textContent = "Reject as " + identity.shortId;
    }
    if (kpiPort) {
      var procInfo = validatorDirectoryMap[identity.validatorId];
      var pidTxt = (procInfo && procInfo.processPid) ? " · PID " + procInfo.processPid : "";
      kpiPort.innerHTML = '<i class="bi bi-heart-pulse"></i> Process :' + identity.port + escapeHtml(pidTxt);
    }

    document.querySelectorAll(".val-switch-btn").forEach(function (btn) {
      var targetLogin = (btn.getAttribute("data-val-login") || "").toUpperCase();
      var isCurrent = targetLogin === identity.shortId;
      btn.classList.toggle("btn-primary", isCurrent);
      btn.classList.toggle("btn-secondary", !isCurrent);
    });
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

    if (nameEl) nameEl.textContent = data.shortId + " / " + normId + " (HTTP :" + data.port + " | P2P :" + (data.p2pPort || (data.port + 1000)) + ")";
    if (orgEl) orgEl.textContent = data.org;
    if (thresholdEl) thresholdEl.textContent = data.threshold;

    if (slicesBox) {
      slicesBox.innerHTML = data.slices.map(function (sNode) {
        var isOff = offlineNodes.has(sNode) || offlineNodes.has(sNode.replace("VAL-", "NODE-"));
        var statusBadge = isOff ? '<span class="badge badge-danger">Offline</span>' : '<span class="badge badge-success">P2P Authenticated</span>';
        var portNum = 4000 + parseInt(sNode.replace("VAL-", "").replace("NODE-", ""), 10);
        var p2pNum = 5000 + parseInt(sNode.replace("VAL-", "").replace("NODE-", ""), 10);
        var sShort = getShortId(sNode);
        return '<div class="fba-status-row" style="margin-bottom:8px; display:flex; justify-content:space-between; align-items:center;">' +
          '<span class="label mono font-bold"><i class="bi bi-hdd-network"></i> ' + escapeHtml(sShort + " (" + sNode + ")") + ' <small class="text-muted">(HTTP :' + portNum + ' | P2P :' + p2pNum + ')</small></span>' +
          statusBadge +
        '</div>';
      }).join("");
    }
  };

  /* ==========================================================
     2. INTERACTIVE PROPOSAL & AUTHENTICATED VOTING CONSOLE
     ========================================================== */
  function showProposalFeedback(message, type) {
    var box = document.getElementById("prop-action-feedback");
    if (!box) return;
    box.hidden = false;
    var cls = "form-status ";
    var icon = "bi-info-circle-fill";
    if (type === "success") {
      cls += "is-success";
      icon = "bi-check-circle-fill";
    } else if (type === "warning") {
      cls += "is-warning";
      icon = "bi-exclamation-triangle-fill";
    } else if (type === "error") {
      cls += "is-error";
      icon = "bi-x-octagon-fill";
    }
    box.className = cls;
    box.innerHTML = '<i class="bi ' + icon + '"></i> <span>' + escapeHtml(message) + '</span>';
  }

  function renderActiveProposal(proposal) {
    activeProposalCache = proposal || null;
    var identity = getLoggedInValidatorIdentity();

    var heightEl = document.getElementById("prop-height-display");
    var idEl = document.getElementById("prop-id-display");
    var statusBadge = document.getElementById("prop-status-badge");
    var myVoteEl = document.getElementById("prop-my-vote-status");
    var approvedEl = document.getElementById("prop-approved-count");
    var remainingEl = document.getElementById("prop-remaining-count");
    var certEl = document.getElementById("prop-cert-display");
    var proposerEl = document.getElementById("prop-proposer-display");

    if (!proposal) {
      if (heightEl) heightEl.textContent = "No Active Proposal";
      if (idEl) idEl.textContent = "Click 'Create Pending Proposal' to start a 12-validator voting round";
      if (statusBadge) {
        statusBadge.className = "badge badge-warning";
        statusBadge.textContent = "IDLE — NO PENDING PROPOSAL";
      }
      if (myVoteEl) myVoteEl.textContent = "Your Vote (" + identity.shortId + "): Create a proposal to vote";
      if (approvedEl) approvedEl.textContent = "0 / 12 Approved";
      if (remainingEl) remainingEl.textContent = "Requires 9 of 12 approvals for finality";
      if (certEl) certEl.textContent = "None (Unfinalized)";
      if (proposerEl) proposerEl.textContent = "Proposer: —";
      return;
    }

    if (heightEl) heightEl.textContent = "Block #" + proposal.blockNumber;
    if (idEl) idEl.textContent = "Proposal: " + (proposal.proposalId ? proposal.proposalId.slice(0, 22) + "..." : "N/A");

    if (statusBadge) {
      if (proposal.finalized || proposal.status === "FINALIZED") {
        statusBadge.className = "badge badge-success";
        statusBadge.innerHTML = '<i class="bi bi-patch-check-fill"></i> FINALIZED (QUORUM MET ' + proposal.approvedCount + '/12 &ge; 9)';
      } else if (proposal.status === "REJECTED") {
        statusBadge.className = "badge badge-danger";
        statusBadge.innerHTML = '<i class="bi bi-x-octagon-fill"></i> REJECTED (' + proposal.rejectedCount + ' Rejections — Quorum Impossible)';
      } else {
        statusBadge.className = "badge badge-warning";
        statusBadge.innerHTML = '<i class="bi bi-hourglass-split"></i> PENDING / UNFINALIZED (' + proposal.approvedCount + '/12 &lt; 9)';
      }
    }

    var myValidatorEntry = (proposal.validators || []).find(function (v) {
      return normalizeNodeId(v.validatorId) === identity.validatorId;
    });
    if (myVoteEl) {
      if (myValidatorEntry && myValidatorEntry.hasVoted) {
        var vColor = myValidatorEntry.vote === "ACCEPT" ? "#10b981" : "#ef4444";
        myVoteEl.innerHTML = 'Your Vote (<strong>' + escapeHtml(identity.shortId) + '</strong>): <strong style="color:' + vColor + ';">' +
          escapeHtml(myValidatorEntry.vote) + '</strong> (Ed25519 Signed)';
      } else {
        myVoteEl.innerHTML = 'Your Vote (<strong>' + escapeHtml(identity.shortId) + '</strong>): <span class="text-warning font-bold">PENDING (Not Cast Yet)</span>';
      }
    }

    if (approvedEl) {
      approvedEl.textContent = (proposal.approvedCount || 0) + " / " + (proposal.totalValidators || 12) + " Approved";
    }
    if (remainingEl) {
      if (proposal.finalized) {
        remainingEl.style.color = "#10b981";
        remainingEl.textContent = "9-of-12 Quorum Met! (" + (proposal.rejectedCount || 0) + " Rejected, " + (proposal.pendingCount || 0) + " Pending)";
      } else if (proposal.status === "REJECTED") {
        remainingEl.style.color = "#ef4444";
        remainingEl.textContent = "Proposal Failed: " + (proposal.rejectedCount || 0) + " rejections exceed fault tolerance (max 3)";
      } else {
        remainingEl.style.color = "#f59e0b";
        remainingEl.textContent = "Needs " + (proposal.remainingForQuorum || 0) + " more approval(s) for 9-of-12 finality (" + (proposal.rejectedCount || 0) + " Rejected)";
      }
    }

    if (certEl) {
      if (proposal.certificate && proposal.certificate.certificateHash) {
        certEl.className = "stat-card-value mono font-bold text-success";
        certEl.textContent = proposal.certificate.certificateHash.slice(0, 22) + "... (" + (proposal.certificate.validatorApprovals ? proposal.certificate.validatorApprovals.length : proposal.approvedCount) + " Sigs)";
      } else {
        certEl.className = "stat-card-value mono font-bold text-danger";
        certEl.textContent = "None (Unfinalized)";
      }
    }
    if (proposerEl) {
      proposerEl.textContent = "Proposer: " + (proposal.proposerShortId || getShortId(proposal.proposerId)) + " (" + proposal.proposerId + ")";
    }
  }

  async function fetchActiveProposal() {
    try {
      var res = await fetch(getApiBase() + "/consensus/proposals/active");
      if (res.ok) {
        var json = await (window.parsePDSJsonResponse ? window.parsePDSJsonResponse(res) : res.json());
        if (json && json.success) {
          renderActiveProposal(json.proposal);
        }
      }
    } catch (e) {}
  }

  async function handleCreateProposal() {
    var token = localStorage.getItem("pdschain_jwt_token") || "";
    if (!token) {
      showProposalFeedback("Please log in as a Validator (V1..V12) or Admin to create a proposal.", "error");
      return;
    }
    var identity = getLoggedInValidatorIdentity();
    try {
      var res = await fetch(getApiBase() + "/consensus/proposals", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + token
        },
        body: JSON.stringify({
          proposerId: identity.validatorId,
          description: "Candidate Block Proposal initiated by " + identity.shortId + " (" + identity.validatorId + ")"
        })
      });
      var data = await (window.parsePDSJsonResponse ? window.parsePDSJsonResponse(res) : res.json());
      if (!res.ok || !data.success) {
        showProposalFeedback(data.message || "Failed to create proposal.", "error");
        return;
      }
      renderActiveProposal(data.proposal);
      await fetchConsensusRound();
      showProposalFeedback(
        "Created Pending Proposal for Block #" + data.proposal.blockNumber + " (0 / 12 Approved — Unfinalized). Log in as V1..V12 to cast votes!",
        "success"
      );
      if (window.showToast) {
        window.showToast("Created Pending Proposal for Block #" + data.proposal.blockNumber, "success");
      }
    } catch (err) {
      showProposalFeedback(err.message || "Network error creating proposal.", "error");
    }
  }

  async function handleCastVote(decision) {
    var token = localStorage.getItem("pdschain_jwt_token") || "";
    if (!token) {
      showProposalFeedback("Authentication required: Please log in as V1..V12 to cast a validator vote.", "error");
      return;
    }
    var identity = getLoggedInValidatorIdentity();
    var propId = (activeProposalCache && activeProposalCache.proposalId) ? activeProposalCache.proposalId : "active";
    try {
      var res = await fetch(getApiBase() + "/consensus/proposals/" + encodeURIComponent(propId) + "/vote", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + token
        },
        body: JSON.stringify({
          decision: decision,
          reason: decision === "ACCEPT"
            ? "Cryptographically verified and approved by " + identity.shortId + " (" + identity.validatorId + ")"
            : "Rejected by " + identity.shortId + " (" + identity.validatorId + ")"
        })
      });
      var data = await (window.parsePDSJsonResponse ? window.parsePDSJsonResponse(res) : res.json());
      if (!res.ok || !data.success) {
        showProposalFeedback(
          "[" + (data.code || "VOTE_REJECTED") + "] " + (data.message || "Vote rejected by consensus engine."),
          "error"
        );
        if (window.showToast) {
          window.showToast(data.message || "Vote rejected", "error");
        }
        return;
      }

      if (data.proposal) renderActiveProposal(data.proposal);
      if (data.round) {
        latestRoundCache = data.round;
        renderConsensusTelemetry(latestRoundCache);
      } else {
        await fetchConsensusRound();
      }
      await fetchValidatorState();
      await fetchLedgerSyncState();

      var p = data.proposal;
      var msg = "";
      var feedbackType = "success";
      if (p.finalized && p.approvedCount === 9 && decision === "ACCEPT") {
        msg = "9-of-12 FBA QUORUM ACHIEVED! Vote from " + identity.shortId + " (" + identity.validatorId + ") reached 9/12 approvals. ConsensusCertificate generated & Block #" + p.blockNumber + " FINALIZED!";
      } else if (p.finalized && p.approvedCount > 9) {
        msg = "Recorded ratification vote from " + identity.shortId + " (" + identity.validatorId + ") — " + p.approvedCount + "/12 validators have now signed Block #" + p.blockNumber + "!";
      } else if (p.status === "REJECTED") {
        msg = "Proposal REJECTED: " + p.rejectedCount + " validators rejected Block #" + p.blockNumber + " (< 9 approvals possible). Block remains UNFINALIZED.";
        feedbackType = "error";
      } else {
        msg = "Recorded signed " + decision + " vote from " + identity.shortId + " (" + identity.validatorId + ") — Progress: " + p.approvedCount + " / 12 Approved (" + p.remainingForQuorum + " more needed for 9-of-12 finality; Block UNFINALIZED).";
        feedbackType = decision === "ACCEPT" ? "warning" : "error";
      }

      showProposalFeedback(msg, feedbackType);
      if (window.showToast) {
        window.showToast(msg, feedbackType);
      }
    } catch (err) {
      showProposalFeedback(err.message || "Failed to submit vote.", "error");
    }
  }

  async function handleFinalizeProposal() {
    var token = localStorage.getItem("pdschain_jwt_token") || "";
    if (!token) {
      showProposalFeedback("Please log in as a Validator or Admin.", "error");
      return;
    }
    var propId = (activeProposalCache && activeProposalCache.proposalId) ? activeProposalCache.proposalId : "active";
    try {
      var res = await fetch(getApiBase() + "/consensus/proposals/" + encodeURIComponent(propId) + "/finalize", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer " + token
        }
      });
      var data = await (window.parsePDSJsonResponse ? window.parsePDSJsonResponse(res) : res.json());
      if (!res.ok || !data.success) {
        if (data.proposal) renderActiveProposal(data.proposal);
        showProposalFeedback(
          "[" + (data.code || "QUORUM_NOT_MET") + "] " + (data.message || "Finality engine refused to finalize block (< 9 approvals)."),
          "error"
        );
        if (window.showToast) {
          window.showToast(data.message || "Finality refused: Quorum not met", "error");
        }
        return;
      }
      if (data.proposal) renderActiveProposal(data.proposal);
      await fetchConsensusRound();
      await fetchLedgerSyncState();
      showProposalFeedback(
        "Block #" + data.proposal.blockNumber + " verified by FinalityEngine and committed with " + data.proposal.approvedCount + "/12 validator signatures!",
        "success"
      );
    } catch (err) {
      showProposalFeedback(err.message || "Error finalizing proposal.", "error");
    }
  }

  /* ==========================================================
     3. 12-VALIDATOR TELEMETRY & 4-STAGE PIPELINE RENDERING
     ========================================================== */
  function renderConsensusTelemetry(roundData) {
    if (!roundData) return;

    var identity = getLoggedInValidatorIdentity();
    var blockNum = roundData.blockNumber !== undefined && roundData.blockNumber !== null ? roundData.blockNumber : 35;
    var txId = roundData.transactionId || (roundData.proposalId ? roundData.proposalId.slice(0, 16) + "..." : "TXN-" + blockNum);
    var merkleRoot = roundData.merkleRoot || "0x7f83b1657ff1fc53b92dc18148a1d65dfc2d4b1fa3d677284addd200126d9069";
    var stateRoot = roundData.stateRoot || "0xa8c23f9914bc819e912440f1a6ec7b2781b4f4da6b73523f6696b99de0798e21";
    var threshold = roundData.threshold || 9;
    var isInteractive = Boolean(roundData.isInteractiveProposal);

    var rawValidators = roundData.validators && Array.isArray(roundData.validators) && roundData.validators.length === 12
      ? roundData.validators
      : Object.keys(QUORUM_SLICES).filter(function(k) { return k.startsWith("VAL-"); }).map(function(id) {
          return {
            validatorId: id,
            shortId: QUORUM_SLICES[id].shortId,
            name: QUORUM_SLICES[id].name,
            org: QUORUM_SLICES[id].org,
            address: "0x" + id.replace("-", "") + "777000111222333444555",
            isOnline: true,
            hasVoted: true,
            verified: true,
            signed: true,
            signatureDigest: "0x" + id.replace("-", "").toLowerCase() + "b9e28f1a",
            vote: "ACCEPT",
            status: "COMPLETE",
            reason: ""
          };
        });

    // Honor real backend vote states (PENDING, ACCEPT, REJECT, OFFLINE) AND offline simulation state
    var evaluatedValidators = rawValidators.map(function (v) {
      var normId = normalizeNodeId(v.validatorId);
      var meta = QUORUM_SLICES[normId] || {};
      var isOff = !v.isOnline || offlineNodes.has(normId) || offlineNodes.has(normId.replace("VAL-", "NODE-"));
      var rawVote = isOff ? "OFFLINE" : (v.vote || "ACCEPT");
      var isPending = !isOff && (rawVote === "PENDING" || v.status === "PENDING");
      var isAccepted = !isOff && !isPending && (rawVote === "ACCEPT" || rawVote === "AGREE" || v.verified === true);
      var isRejected = !isOff && !isPending && !isAccepted;
      var sig = (isOff || isPending) ? null : (v.signatureDigest || (isAccepted ? ("0x" + normId.replace("-", "").toLowerCase() + "c7a82b") : null));

      return {
        validatorId: normId,
        shortId: v.shortId || meta.shortId || getShortId(normId),
        name: v.name || meta.name || normId,
        org: v.org || meta.org || "",
        port: meta.port || (4000 + parseInt(normId.replace("VAL-", ""), 10)),
        address: v.address,
        isOnline: !isOff,
        isPending: isPending,
        verified: isAccepted,
        signed: Boolean(isAccepted && sig),
        signatureDigest: sig,
        vote: isOff ? "OFFLINE" : (isPending ? "PENDING" : (isAccepted ? "ACCEPT" : "REJECT")),
        status: isOff ? "OFFLINE" : (isPending ? "PENDING" : (isAccepted ? "COMPLETE" : "REJECTED"))
      };
    });

    var totalCount = evaluatedValidators.length;
    var verifiedCount = evaluatedValidators.filter(function (v) { return v.verified; }).length;
    var signedCount = evaluatedValidators.filter(function (v) { return v.signed; }).length;
    var rejectedCount = evaluatedValidators.filter(function (v) { return v.status === "REJECTED"; }).length;
    var pendingCount = evaluatedValidators.filter(function (v) { return v.status === "PENDING"; }).length;
    var quorumAchieved = signedCount >= threshold;
    var finalized = Boolean(quorumAchieved && (roundData.finalized !== false || !isInteractive || signedCount >= threshold));

    // 1. Update Round & Header Badges
    var roundBadge = document.getElementById("live-round-badge");
    if (roundBadge) {
      var statusLabel = finalized ? "FINALIZED" : (roundData.status === "REJECTED" ? "REJECTED" : (isInteractive ? "VOTING IN PROGRESS" : "LIVE"));
      roundBadge.innerHTML = '<i class="bi bi-broadcast"></i> BLOCK #' + escapeHtml(blockNum) + ' · ' + escapeHtml(statusLabel);
    }

    var headerHeightChip = document.getElementById("header-height-chip");
    if (headerHeightChip) {
      headerHeightChip.textContent = "Height #" + blockNum;
    }

    // 2. Update 4-Stage Pipeline
    var pStage1 = document.getElementById("pipe-stage-1");
    var pBadge1 = document.getElementById("pipe-badge-1");
    if (pStage1 && pBadge1) {
      var isS1Ok = verifiedCount >= threshold;
      pStage1.className = "fba-stage-step " + (isS1Ok ? "is-complete" : (pendingCount > 0 && roundData.status !== "REJECTED" ? "" : "is-failed"));
      pBadge1.className = "badge " + (isS1Ok ? "badge-success" : (pendingCount > 0 && roundData.status !== "REJECTED" ? "badge-warning" : "badge-danger"));
      pBadge1.textContent = verifiedCount + " / " + totalCount + " Verified";
    }

    var pStage2 = document.getElementById("pipe-stage-2");
    var pBadge2 = document.getElementById("pipe-stage-2");
    if (pStage2 && pBadge2) {
      var isS2Ok = signedCount >= threshold;
      pStage2.className = "fba-stage-step " + (isS2Ok ? "is-complete" : (pendingCount > 0 && roundData.status !== "REJECTED" ? "" : "is-failed"));
      pBadge2.className = "badge " + (isS2Ok ? "badge-success" : (pendingCount > 0 && roundData.status !== "REJECTED" ? "badge-warning" : "badge-danger"));
      pBadge2.textContent = signedCount + " / " + totalCount + " Signed";
    }

    var pStage3 = document.getElementById("pipe-stage-3");
    var pBadge3 = document.getElementById("pipe-badge-3");
    if (pStage3 && pBadge3) {
      pStage3.className = "fba-stage-step " + (quorumAchieved ? "is-complete" : (pendingCount > 0 && roundData.status !== "REJECTED" ? "" : "is-failed"));
      pBadge3.className = "badge " + (quorumAchieved ? "badge-success" : (pendingCount > 0 && roundData.status !== "REJECTED" ? "badge-warning" : "badge-danger"));
      pBadge3.textContent = quorumAchieved
        ? "QUORUM MET (" + signedCount + "/12 \u2265 9)"
        : (pendingCount > 0 && roundData.status !== "REJECTED"
            ? "AWAITING QUORUM (" + signedCount + "/12 < 9)"
            : "QUORUM FAILED (" + signedCount + "/12 < 9)");
    }

    var pStage4 = document.getElementById("pipe-stage-4");
    var pBadge4 = document.getElementById("pipe-badge-4");
    if (pStage4 && pBadge4) {
      pStage4.className = "fba-stage-step " + (finalized ? "is-complete" : (pendingCount > 0 && roundData.status !== "REJECTED" ? "" : "is-failed"));
      pBadge4.className = "badge " + (finalized ? "badge-success" : (pendingCount > 0 && roundData.status !== "REJECTED" ? "badge-warning" : "badge-danger"));
      pBadge4.textContent = finalized
        ? "FINALIZED"
        : (roundData.status === "REJECTED" ? "REJECTED (Unfinalized)" : "UNFINALIZED (Pending)");
    }

    // 3. Update Roots & Transaction Metadata Bar
    var blkEl = document.getElementById("fba-block-height");
    var txEl = document.getElementById("fba-tx-id");
    var mrkEl = document.getElementById("fba-merkle-root");
    var stEl = document.getElementById("fba-state-root");

    if (blkEl) blkEl.textContent = "#" + blockNum;
    if (txEl) txEl.textContent = txId;
    if (mrkEl) {
      mrkEl.textContent = finalized ? merkleRoot : merkleRoot + " (Pending Finality)";
      mrkEl.className = "crypto-root-val " + (finalized ? "" : "text-warning");
    }
    if (stEl) {
      stEl.textContent = finalized ? stateRoot : stateRoot + " (Uncommitted)";
      stEl.className = "crypto-root-val " + (finalized ? "text-success" : "text-warning");
    }

    // 4. Update Progress Bar & Agreement Text
    var pct = Math.round((signedCount / totalCount) * 100);
    var pFill = document.getElementById("consensus-progress-fill");
    var qStat = document.getElementById("quorum-agreement-stat");
    var fStat = document.getElementById("quorum-finality-stat");

    if (pFill) {
      pFill.style.width = pct + "%";
      pFill.style.background = quorumAchieved
        ? "var(--success, #10b981)"
        : (roundData.status === "REJECTED" ? "var(--danger, #ef4444)" : "#f59e0b");
    }

    if (qStat) {
      qStat.innerHTML = 'Quorum Agreement: <strong>' + pct + '% (' + signedCount + ' / ' + totalCount + ' Approved · ' + rejectedCount + ' Rejected · ' + pendingCount + ' Pending)</strong>';
    }

    if (fStat) {
      if (signedCount === totalCount && finalized) {
        fStat.className = "text-success font-bold";
        fStat.innerHTML = '<i class="bi bi-check-circle-fill"></i> Full 12/12 Consensus Reached — Block #' + escapeHtml(blockNum) + ' Finalized';
      } else if (quorumAchieved && finalized) {
        fStat.className = "text-success font-bold";
        fStat.innerHTML = '<i class="bi bi-patch-check-fill"></i> 9-of-12 Quorum Met (' + signedCount + '/' + totalCount + ' \u2265 9) — Block #' + escapeHtml(blockNum) + ' Finalized';
      } else if (roundData.status === "REJECTED") {
        fStat.className = "text-danger font-bold";
        fStat.innerHTML = '<i class="bi bi-x-octagon-fill"></i> Proposal Rejected (' + rejectedCount + ' Rejections, ' + signedCount + '/12 Approved < 9) — Block Unfinalized';
      } else {
        fStat.className = "text-warning font-bold";
        fStat.innerHTML = '<i class="bi bi-hourglass-split"></i> Quorum Not Reached (' + signedCount + '/' + totalCount + ' < 9 Required) — Block #' + escapeHtml(blockNum) + ' Unfinalized';
      }
    }

    // 5. Populate 12-Validator Telemetry Table
    var tbody = document.getElementById("fba-validator-tbody");
    if (tbody) {
      var rowsHtml = "";
      evaluatedValidators.forEach(function (v) {
        var isCurrentSession = v.validatorId === identity.validatorId;
        var rowClass = v.isOnline ? "" : "node-row-offline";
        var rowStyle = isCurrentSession ? ' style="background:rgba(37, 99, 235, 0.08);"' : "";

        var verifyBadge;
        if (!v.isOnline) {
          verifyBadge = '<span class="badge badge-danger"><i class="bi bi-x"></i> Offline</span>';
        } else if (v.isPending) {
          verifyBadge = '<span class="badge badge-warning"><i class="bi bi-hourglass-split"></i> Awaiting</span>';
        } else if (v.verified) {
          verifyBadge = '<span class="badge badge-success"><i class="bi bi-check2"></i> Verified</span>';
        } else {
          verifyBadge = '<span class="badge badge-danger"><i class="bi bi-x-circle"></i> Rejected</span>';
        }

        var signBadge;
        if (!v.isOnline) {
          signBadge = '<span class="badge badge-danger"><i class="bi bi-dash-circle"></i> Offline</span>';
        } else if (v.isPending) {
          signBadge = '<span class="badge badge-warning"><i class="bi bi-clock"></i> Pending</span>';
        } else if (v.signed) {
          signBadge = '<span class="badge badge-success"><i class="bi bi-check2-circle"></i> Signed</span>';
        } else {
          signBadge = '<span class="badge badge-danger"><i class="bi bi-x-octagon"></i> Rejected</span>';
        }

        var sigDigest = v.signatureDigest
          ? '<span class="sig-digest-pill">' + escapeHtml(v.signatureDigest) + '</span>'
          : '<span class="text-muted" style="font-size:11px;">' + (v.isPending ? "Awaiting Signature" : "None") + '</span>';

        var voteColor = v.vote === "ACCEPT" ? "text-success" : (v.vote === "PENDING" ? "text-warning" : "text-danger");
        var quorumContrib = !v.isOnline
          ? '<span class="text-danger"><i class="bi bi-slash-circle"></i> Offline</span>'
          : (v.verified
              ? '<span class="text-success"><i class="bi bi-check-circle"></i> Slice Active (3/4)</span>'
              : (v.isPending
                  ? '<span class="text-muted"><i class="bi bi-hourglass"></i> Pending Vote</span>'
                  : '<span class="text-danger"><i class="bi bi-x-circle"></i> Dissented</span>'));

        var dirInfo = validatorDirectoryMap[v.validatorId];
        var procLabel = ":" + v.port + (dirInfo && dirInfo.processPid ? " (PID " + dirInfo.processPid + ")" : "");
        var statusBadge = v.isOnline
          ? '<span class="badge badge-success">ONLINE ' + escapeHtml(procLabel) + '</span>'
          : '<span class="badge badge-danger">OFFLINE :' + escapeHtml(v.port) + '</span>';

        var youTag = isCurrentSession ? ' <span class="badge badge-primary" style="font-size:10px;padding:2px 6px;">YOU</span>' : "";

        rowsHtml +=
          '<tr class="' + rowClass + '"' + rowStyle + ' data-validator-row="' + escapeHtml(v.validatorId) + '">' +
            '<td><span class="mono font-bold">' + escapeHtml(v.shortId + " · " + v.validatorId) + '</span>' + youTag + '<br /><small class="text-muted">' + escapeHtml(v.org) + '</small></td>' +
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
      } else if (vItem && vItem.isPending) {
        box.className = "vote-node";
        if (statusEl) statusEl.innerHTML = '<i class="bi bi-hourglass-split text-warning"></i> Pending';
      } else if (vItem && vItem.signed) {
        box.className = "vote-node is-voted";
        if (statusEl) statusEl.innerHTML = '<i class="bi bi-check-circle-fill text-success"></i> Approved';
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
     4. LIVE BACKEND SYNCHRONIZATION
     ========================================================== */
  async function fetchConsensusRound() {
    try {
      var res = await fetch(getApiBase() + "/consensus/rounds/latest");
      if (res.ok) {
        var json = await (window.parsePDSJsonResponse ? window.parsePDSJsonResponse(res) : res.json());
        if (json && json.success && json.round) {
          latestRoundCache = json.round;
          renderConsensusTelemetry(latestRoundCache);
        }
      }
    } catch (e) {
      if (!latestRoundCache) {
        latestRoundCache = {
          roundId: "RND-35",
          blockNumber: 35,
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
      var res = await fetch(getApiBase() + "/validators", {
        headers: token ? { "Authorization": "Bearer " + token } : {}
      });
      if (res.ok) {
        var json = await (window.parsePDSJsonResponse ? window.parsePDSJsonResponse(res) : res.json());
        if (json && json.validators && Array.isArray(json.validators)) {
          json.validators.forEach(function (v) {
            validatorDirectoryMap[v.validatorId] = v;
          });
          var identity = getLoggedInValidatorIdentity();
          var myVal = validatorDirectoryMap[identity.validatorId];
          if (myVal) {
            var kpiHeight = document.getElementById("kpi-block-height");
            var kpiTx = document.getElementById("kpi-tx-validated");
            var kpiStatus = document.getElementById("kpi-node-status");
            if (kpiHeight && myVal.blockHeight !== undefined) kpiHeight.textContent = myVal.blockHeight;
            if (kpiTx && myVal.txValidated !== undefined) kpiTx.textContent = myVal.txValidated;
            if (kpiStatus) {
              kpiStatus.textContent = (myVal.status || "ONLINE").toUpperCase();
              kpiStatus.className = "stat-card-value " + (myVal.status === "Offline" ? "text-danger" : "text-success");
            }
          }
          updateSessionIdentityUI();

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
    } catch (e) {}
  }

  async function setNodeStatusBackend(nodeId, status) {
    var normId = normalizeNodeId(nodeId);
    var token = localStorage.getItem("pdschain_jwt_token") || "";
    var role = (localStorage.getItem("pds_role") || "").toUpperCase();
    if (!token || (role !== "ADMIN" && role !== "VALIDATOR")) {
      return;
    }
    try {
      await fetch(getApiBase() + "/validators/" + normId + "/status", {
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
     5. NODE FAILURE & RECOVERY SIMULATION HANDLERS
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
    for (var i = 1; i <= 12; i++) {
      var pad = i < 10 ? "0" + i : "" + i;
      var vId = "VAL-" + pad;
      if (previouslyOffline.includes(vId) || (validatorDirectoryMap[vId] && validatorDirectoryMap[vId].status === "Offline")) {
        setNodeStatusBackend(vId, "Online");
      }
    }
    if (window.showToast) {
      window.showToast("Restored all 12 validator nodes. Network is 100% ONLINE (12/12 \u2265 9 Quorum Reached).", "success");
    }
  }

  // Bind Interactive Proposal & Voting Console Buttons
  var btnCreateProp = document.getElementById("btn-create-proposal");
  var btnVoteApprove = document.getElementById("btn-vote-approve");
  var btnVoteReject = document.getElementById("btn-vote-reject");
  var btnFinalizeProp = document.getElementById("btn-finalize-proposal");

  if (btnCreateProp) {
    btnCreateProp.addEventListener("click", function () {
      handleCreateProposal();
    });
  }
  if (btnVoteApprove) {
    btnVoteApprove.addEventListener("click", function () {
      handleCastVote("ACCEPT");
    });
  }
  if (btnVoteReject) {
    btnVoteReject.addEventListener("click", function () {
      handleCastVote("REJECT");
    });
  }
  if (btnFinalizeProp) {
    btnFinalizeProp.addEventListener("click", function () {
      handleFinalizeProposal();
    });
  }

  // Bind Quick Validator Switcher Buttons (Clean Logout -> Redirect to Login prefilled with V1..V12)
  document.querySelectorAll(".val-switch-btn").forEach(function (btn) {
    btn.addEventListener("click", async function () {
      var targetLogin = btn.getAttribute("data-val-login") || "v1";
      var token = localStorage.getItem("pdschain_jwt_token") || "";
      if (token) {
        try {
          await fetch(getApiBase() + "/auth/logout", {
            method: "POST",
            headers: { "Authorization": "Bearer " + token }
          });
        } catch (e) {}
      }
      try {
        localStorage.removeItem("pdschain_jwt_token");
        localStorage.removeItem("pds_role");
        localStorage.removeItem("pds_username");
        localStorage.removeItem("pds_validator_id");
        localStorage.removeItem("pds_short_validator_id");
        localStorage.removeItem("pdschain_user");
        sessionStorage.removeItem("pdschain-user");
      } catch (e) {}
      window.location.href = "../login.html?validator=" + encodeURIComponent(targetLogin);
    });
  });

  // Bind Fault Simulation Buttons
  var btnFail7 = document.getElementById("btn-val-fail-7");
  var btnFail4 = document.getElementById("btn-val-fail-4");
  var btnRestoreAll = document.getElementById("btn-val-restore-all");

  if (btnFail7) {
    btnFail7.addEventListener("click", function () {
      applyFailureSimulation(
        ["VAL-07"],
        "Simulated Failure: V7 (VAL-07) went OFFLINE. FBA Quorum maintained (11/12 \u2265 9 required) — Resilient!",
        "warning"
      );
    });
  }

  if (btnFail4) {
    btnFail4.addEventListener("click", function () {
      applyFailureSimulation(
        ["VAL-07", "VAL-08", "VAL-09", "VAL-10"],
        "Simulated Cascading Failure: 4 nodes went OFFLINE. Active: 8/12 (< 9 required). Quorum FAILED — Finality blocked!",
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
        "Simulated Node Failure: V7 (VAL-07) went OFFLINE. FBA Quorum maintained (11/12 nodes online).",
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
    document.querySelectorAll(".node-select-btn").forEach(function (btn) {
      var id = normalizeNodeId(btn.getAttribute("data-node"));
      if (offlineNodes.has(id)) {
        btn.classList.add("is-offline");
      } else {
        btn.classList.remove("is-offline");
      }
    });

    var countOffline = Array.from(offlineNodes).filter(function(n) { return n.startsWith("VAL-"); }).length;
    var countOnline = Math.max(0, 12 - countOffline);
    var onlineCounter = document.getElementById("online-nodes-count");
    if (onlineCounter) onlineCounter.textContent = countOnline + " / 12";

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

    if (document.getElementById("quorum-target-node")) {
      window.selectQuorumNode(activeSelectedNode);
    }
  }

  /* ==========================================================
     6. PHASE 10: LEDGER SYNC & RECOVERY OBSERVABILITY
     ========================================================== */
  async function fetchLedgerSyncState() {
    try {
      var res = await fetch(getApiBase() + "/ledger/status");
      if (res.ok) {
        var json = await (window.parsePDSJsonResponse ? window.parsePDSJsonResponse(res) : res.json());
        updateLedgerSyncUI(json);
      }
    } catch (e) {}
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
  updateSessionIdentityUI();
  fetchValidatorState();
  fetchLedgerSyncState();
  fetchActiveProposal();
  fetchConsensusRound();

  // Periodic telemetry refresh
  setInterval(function () {
    fetchActiveProposal();
    fetchConsensusRound();
  }, 8000);

  if (document.getElementById("quorum-target-node")) {
    window.selectQuorumNode("VAL-01");
  }

})();

