/**
 * PDSChain Events & Logs Explorer (Phase 13)
 * 
 * Manages REST queries, cursor pagination, and real-time SSE event streaming.
 */

(function () {
  "use strict";

  var currentEvents = [];
  var totalEvents = 0;
  var cursorStack = [];
  var currentCursor = null;
  var nextCursor = null;
  var eventSource = null;
  var isStreamPaused = false;
  var selectedEvent = null;

  function getApiBase() {
    if (window.PDSChainAPI && window.PDSChainAPI.BASE_URL) {
      return window.PDSChainAPI.BASE_URL;
    }
    return window.getPDSChainApiBase ? window.getPDSChainApiBase("api") : "http://localhost:3000/api";
  }

  function escapeHtml(str) {
    if (!str) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function formatDate(isoStr) {
    if (!isoStr) return "-";
    try {
      var d = new Date(isoStr);
      return d.toLocaleTimeString() + " (" + d.toLocaleDateString() + ")";
    } catch (e) {
      return isoStr;
    }
  }

  function truncate(str, maxLen) {
    if (!str) return "-";
    if (str.length <= maxLen) return str;
    return str.substring(0, maxLen) + "...";
  }

  // --- Real-time Streaming (SSE) ---
  function initEventStream() {
    if (eventSource) {
      eventSource.close();
      eventSource = null;
    }

    if (isStreamPaused) {
      updateStreamUI(false);
      return;
    }

    var streamUrl = getApiBase() + "/events/stream";
    try {
      eventSource = new EventSource(streamUrl);

      eventSource.onopen = function () {
        updateStreamUI(true);
      };

      eventSource.onerror = function () {
        updateStreamUI(false);
      };

      eventSource.onmessage = function (e) {
        if (!e.data) return;
        try {
          var evt = JSON.parse(e.data);
          onStreamEventReceived(evt);
        } catch (err) {
          console.warn("Failed to parse SSE payload:", err);
        }
      };
    } catch (e) {
      console.error("EventSource initialization failed:", e);
      updateStreamUI(false);
    }
  }

  function updateStreamUI(isOnline) {
    var dot = document.getElementById("stream-dot");
    var label = document.getElementById("stream-label");
    var btn = document.getElementById("btn-toggle-stream");

    if (dot && label) {
      if (isOnline) {
        dot.className = "stream-status-dot online";
        label.textContent = "SSE Stream Active";
        if (btn) btn.innerHTML = '<i class="bi bi-pause-fill"></i> Pause Stream';
      } else {
        dot.className = "stream-status-dot offline";
        label.textContent = isStreamPaused ? "Stream Paused" : "Stream Disconnected";
        if (btn) btn.innerHTML = '<i class="bi bi-play-fill"></i> Resume Stream';
      }
    }
  }

  function toggleStream() {
    isStreamPaused = !isStreamPaused;
    if (isStreamPaused) {
      if (eventSource) {
        eventSource.close();
        eventSource = null;
      }
      updateStreamUI(false);
    } else {
      initEventStream();
    }
  }

  function onStreamEventReceived(evt) {
    // Update live feed ticker
    var tickerContent = document.getElementById("ticker-content");
    var tickerTime = document.getElementById("ticker-time");
    if (tickerContent) {
      tickerContent.innerHTML = '<span class="badge badge-category badge-cat-' + escapeHtml(evt.category) + '">' +
        escapeHtml(evt.category) + '</span> ' +
        '<strong>' + escapeHtml(evt.type) + '</strong> — ' +
        escapeHtml(evt.eventId);
    }
    if (tickerTime) {
      tickerTime.textContent = new Date().toLocaleTimeString();
    }

    // Increment KPI
    totalEvents++;
    var kpiTotal = document.getElementById("kpi-total-events");
    if (kpiTotal) kpiTotal.textContent = totalEvents;

    if (evt.finalityStatus === "FINALIZED") {
      var kpiFin = document.getElementById("kpi-finalized-events");
      if (kpiFin) kpiFin.textContent = parseInt(kpiFin.textContent || "0", 10) + 1;
    }
    if (evt.category === "CONTRACT") {
      var kpiCont = document.getElementById("kpi-contract-events");
      if (kpiCont) kpiCont.textContent = parseInt(kpiCont.textContent || "0", 10) + 1;
    }
    if (evt.category === "CONSENSUS") {
      var kpiCons = document.getElementById("kpi-consensus-events");
      if (kpiCons) kpiCons.textContent = parseInt(kpiCons.textContent || "0", 10) + 1;
    }

    // If first page and matches current category/severity filter, prepend to table
    var categoryFilter = document.getElementById("filter-category") ? document.getElementById("filter-category").value : "";
    var severityFilter = document.getElementById("filter-severity") ? document.getElementById("filter-severity").value : "";
    if ((!categoryFilter || categoryFilter === evt.category) && (!severityFilter || severityFilter === evt.severity)) {
      currentEvents.unshift(evt);
      var limit = parseInt((document.getElementById("filter-limit") && document.getElementById("filter-limit").value) || "25", 10);
      if (currentEvents.length > limit) currentEvents.pop();
      renderEventsTable(currentEvents);
    }
  }

  // --- REST Query & Pagination ---
  async function loadEvents(resetPagination) {
    if (resetPagination) {
      cursorStack = [];
      currentCursor = null;
      nextCursor = null;
    }

    var tbody = document.getElementById("events-table-body");
    if (tbody && currentEvents.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:40px;color:#94a3b8;"><div class="spinner" style="margin:0 auto 12px;"></div>Loading events...</td></tr>';
    }

    var category = document.getElementById("filter-category") ? document.getElementById("filter-category").value : "";
    var severity = document.getElementById("filter-severity") ? document.getElementById("filter-severity").value : "";
    var finality = document.getElementById("filter-finality") ? document.getElementById("filter-finality").value : "";
    var fromBlock = document.getElementById("filter-from-block") ? document.getElementById("filter-from-block").value : "";
    var toBlock = document.getElementById("filter-to-block") ? document.getElementById("filter-to-block").value : "";
    var limit = document.getElementById("filter-limit") ? document.getElementById("filter-limit").value : "25";
    var queryInput = document.getElementById("top-search-input") ? document.getElementById("top-search-input").value.trim() : "";

    var params = new URLSearchParams();
    if (category) params.set("category", category);
    if (severity) params.set("severity", severity);
    if (finality) params.set("finalityStatus", finality);
    if (fromBlock) params.set("fromBlock", fromBlock);
    if (toBlock) params.set("toBlock", toBlock);
    if (limit) params.set("limit", limit);
    if (currentCursor) params.set("cursor", currentCursor);
    if (queryInput) params.set("q", queryInput);

    try {
      var res = await fetch(getApiBase() + "/events?" + params.toString());
      if (!res.ok) throw new Error("Server responded with HTTP " + res.status);
      var data = await res.json();

      if (data && data.success) {
        currentEvents = data.events || [];
        totalEvents = data.total || 0;
        nextCursor = data.nextCursor || null;

        updateKPIs(data);
        renderEventsTable(currentEvents);
        updatePaginationUI(data);
      } else {
        throw new Error(data.error || "Failed to load events");
      }
    } catch (err) {
      console.error("loadEvents error:", err);
      if (tbody) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:30px;color:#ef4444;"><i class="bi bi-exclamation-triangle"></i> Failed to query events: ' + escapeHtml(err.message) + '</td></tr>';
      }
    }
  }

  function updateKPIs(data) {
    var kpiTotal = document.getElementById("kpi-total-events");
    var kpiFin = document.getElementById("kpi-finalized-events");
    var kpiCont = document.getElementById("kpi-contract-events");
    var kpiCons = document.getElementById("kpi-consensus-events");

    if (kpiTotal) kpiTotal.textContent = data.total || 0;

    // Approximate breakdown from metrics if available or counted from loaded
    if (data.events) {
      var finCount = data.events.filter(function (e) { return e.finalityStatus === "FINALIZED"; }).length;
      var contCount = data.events.filter(function (e) { return e.category === "CONTRACT"; }).length;
      var consCount = data.events.filter(function (e) { return e.category === "CONSENSUS"; }).length;
      if (kpiFin && !kpiFin.dataset.set) kpiFin.textContent = finCount;
      if (kpiCont && !kpiCont.dataset.set) kpiCont.textContent = contCount;
      if (kpiCons && !kpiCons.dataset.set) kpiCons.textContent = consCount;
    }
  }

  function renderEventsTable(events) {
    var tbody = document.getElementById("events-table-body");
    if (!tbody) return;

    if (!events || events.length === 0) {
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:40px;color:#94a3b8;"><i class="bi bi-inbox" style="font-size:24px;display:block;margin-bottom:8px;"></i>No blockchain events match the selected criteria.</td></tr>';
      return;
    }

    var html = "";
    for (var i = 0; i < events.length; i++) {
      var ev = events[i];
      var refTarget = "-";
      if (ev.blockHeight !== null && ev.blockHeight !== undefined) {
        refTarget = "Block #" + ev.blockHeight;
      } else if (ev.txHash) {
        refTarget = "Tx: " + truncate(ev.txHash, 14);
      } else if (ev.contractAddress) {
        refTarget = "Contract: " + truncate(ev.contractAddress, 14);
      }

      html += '<tr style="border-bottom:1px solid #1e293b;font-size:13px;transition:background 0.2s;" onmouseover="this.style.background=\'rgba(255,255,255,0.02)\'" onmouseout="this.style.background=\'transparent\'">';
      html += '<td style="padding:12px 16px;font-family:\'IBM Plex Mono\',monospace;font-size:12px;color:#38bdf8;">' + escapeHtml(truncate(ev.eventId, 16)) + '</td>';
      html += '<td style="padding:12px 16px;color:#94a3b8;font-size:12px;">' + formatDate(ev.timestamp) + '</td>';
      html += '<td style="padding:12px 16px;"><span class="badge badge-category badge-cat-' + escapeHtml(ev.category) + '">' + escapeHtml(ev.category) + '</span></td>';
      html += '<td style="padding:12px 16px;font-weight:600;color:#f8fafc;">' + escapeHtml(ev.type) + '</td>';
      html += '<td style="padding:12px 16px;"><span class="badge-finality finality-' + escapeHtml(ev.finalityStatus) + '">' + escapeHtml(ev.finalityStatus) + '</span></td>';
      html += '<td style="padding:12px 16px;"><span class="badge-sev-' + escapeHtml(ev.severity) + '">' + escapeHtml(ev.severity) + '</span></td>';
      html += '<td style="padding:12px 16px;font-family:\'IBM Plex Mono\',monospace;font-size:12px;color:#cbd5e1;">' + escapeHtml(refTarget) + '</td>';
      html += '<td style="padding:12px 16px;text-align:right;">';
      html += '<button class="btn btn-secondary btn-sm" onclick="inspectEvent(\'' + escapeHtml(ev.eventId) + '\')" style="padding:4px 8px;font-size:12px;"><i class="bi bi-eye"></i> Inspect</button>';
      html += '</td>';
      html += '</tr>';
    }

    tbody.innerHTML = html;
  }

  function updatePaginationUI(data) {
    var info = document.getElementById("pagination-info");
    var prevBtn = document.getElementById("btn-prev-page");
    var nextBtn = document.getElementById("btn-next-page");

    if (info) {
      info.textContent = "Showing " + currentEvents.length + " of " + (data.total || 0) + " events";
    }

    if (prevBtn) {
      prevBtn.disabled = cursorStack.length === 0;
    }
    if (nextBtn) {
      nextBtn.disabled = !data.hasMore || !data.nextCursor;
    }
  }

  function nextPage() {
    if (nextCursor) {
      cursorStack.push(currentCursor);
      currentCursor = nextCursor;
      loadEvents(false);
    }
  }

  function prevPage() {
    if (cursorStack.length > 0) {
      currentCursor = cursorStack.pop();
      loadEvents(false);
    }
  }

  function resetFilters() {
    if (document.getElementById("filter-category")) document.getElementById("filter-category").value = "";
    if (document.getElementById("filter-severity")) document.getElementById("filter-severity").value = "";
    if (document.getElementById("filter-finality")) document.getElementById("filter-finality").value = "";
    if (document.getElementById("filter-from-block")) document.getElementById("filter-from-block").value = "";
    if (document.getElementById("filter-to-block")) document.getElementById("filter-to-block").value = "";
    if (document.getElementById("top-search-input")) document.getElementById("top-search-input").value = "";
    loadEvents(true);
  }

  // --- Modal Inspector ---
  function inspectEvent(eventId) {
    var found = currentEvents.find(function (e) { return e.eventId === eventId; });
    if (!found) return;

    selectedEvent = found;
    var modal = document.getElementById("event-modal");
    if (!modal) return;

    document.getElementById("modal-event-id").textContent = found.eventId;
    document.getElementById("modal-type").textContent = found.type;
    document.getElementById("modal-category").innerHTML = '<span class="badge badge-category badge-cat-' + escapeHtml(found.category) + '">' + escapeHtml(found.category) + '</span>';
    document.getElementById("modal-finality").innerHTML = '<span class="badge-finality finality-' + escapeHtml(found.finalityStatus) + '">' + escapeHtml(found.finalityStatus) + '</span>';
    document.getElementById("modal-severity").innerHTML = '<span class="badge-sev-' + escapeHtml(found.severity) + '">' + escapeHtml(found.severity) + '</span>';
    document.getElementById("modal-block").textContent = (found.blockHeight !== null && found.blockHeight !== undefined) ? found.blockHeight : "N/A";
    document.getElementById("modal-source").textContent = found.source || "N/A";
    document.getElementById("modal-tx").textContent = found.txHash || "N/A";
    document.getElementById("modal-contract").textContent = found.contractAddress || "N/A";
    document.getElementById("modal-dedup").textContent = found.dedupKey || "N/A";

    var payloadEl = document.getElementById("modal-payload");
    if (payloadEl) {
      try {
        payloadEl.textContent = JSON.stringify(found.payload || {}, null, 2);
      } catch (err) {
        payloadEl.textContent = String(found.payload);
      }
    }

    modal.style.display = "flex";
  }

  function closeModal() {
    var modal = document.getElementById("event-modal");
    if (modal) modal.style.display = "none";
    selectedEvent = null;
  }

  // Global exports for inline HTML onclick handlers
  window.loadEvents = loadEvents;
  window.nextPage = nextPage;
  window.prevPage = prevPage;
  window.resetFilters = resetFilters;
  window.toggleStream = toggleStream;
  window.inspectEvent = inspectEvent;
  window.closeModal = closeModal;

  // Initialize on DOM load
  document.addEventListener("DOMContentLoaded", function () {
    loadEvents(true);
    initEventStream();

    var searchInput = document.getElementById("top-search-input");
    if (searchInput) {
      var debounceTimer;
      searchInput.addEventListener("input", function () {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(function () {
          loadEvents(true);
        }, 300);
      });
    }

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") {
        closeModal();
      }
    });
  });
})();
