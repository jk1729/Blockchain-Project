/**
 * PDSChain Explorer API Client (Phase 15)
 * 
 * Standardized data client for the PDSChain Professional Blockchain Explorer:
 * - Unwraps Phase 14 canonical { data, meta, error } envelopes
 * - Injects X-Request-ID and X-Correlation-ID
 * - Implements in-memory TTL caching for finalized blocks & ABIs
 * - Handles rate-limit headers (429 Retry-After)
 * - Safe error normalization
 */

(function () {
  "use strict";

  var cache = new Map();
  var DEFAULT_CACHE_TTL_MS = 15000; // 15 seconds

  function getBaseUrl() {
    if (window.PDSCHAIN_EXPLORER_API_URL) {
      return window.PDSCHAIN_EXPLORER_API_URL;
    }
    // If hosted on same origin, use relative /api/v1
    if (window.location && window.location.origin && window.location.origin.startsWith("http")) {
      return window.location.origin + "/api/v1";
    }
    return "http://localhost:3000/api/v1";
  }

  function generateRequestId() {
    return "req_" + Date.now().toString(36) + "_" + Math.random().toString(36).substring(2, 8);
  }

  async function request(endpoint, options) {
    options = options || {};
    var baseUrl = getBaseUrl();
    var fullUrl = endpoint.startsWith("http") ? endpoint : baseUrl + (endpoint.startsWith("/") ? endpoint : "/" + endpoint);
    var method = (options.method || "GET").toUpperCase();

    // Cache lookup for idempotent GET requests
    var cacheKey = method + ":" + fullUrl;
    if (options.cache !== false && method === "GET") {
      var cached = cache.get(cacheKey);
      if (cached && (Date.now() - cached.timestamp < (options.ttl || DEFAULT_CACHE_TTL_MS))) {
        return cached.value;
      }
    }

    var headers = Object.assign({
      "Accept": "application/json",
      "X-Request-ID": generateRequestId(),
      "X-API-Version": "1.0.0"
    }, options.headers || {});

    if (options.body && method !== "GET") {
      headers["Content-Type"] = "application/json";
    }

    var config = {
      method: method,
      headers: headers
    };

    if (options.body && method !== "GET") {
      config.body = typeof options.body === "string" ? options.body : JSON.stringify(options.body);
    }

    var response;
    try {
      response = await fetch(fullUrl, config);
    } catch (netErr) {
      var errObj = new Error("Network connection failure: " + netErr.message);
      errObj.code = "NETWORK_ERROR";
      errObj.status = 0;
      throw errObj;
    }

    var payload = null;
    try {
      payload = await response.json();
    } catch (parseErr) {
      payload = { error: { message: "Invalid JSON response from server (" + response.status + ")" } };
    }

    // Handle Rate Limiting (HTTP 429)
    if (response.status === 429) {
      var retryAfter = response.headers ? response.headers.get("Retry-After") : null;
      var rateLimitErr = new Error((payload && payload.error && payload.error.message) || "Rate limit exceeded. Please retry later.");
      rateLimitErr.code = "RATE_LIMIT_EXCEEDED";
      rateLimitErr.status = 429;
      rateLimitErr.retryAfter = retryAfter ? parseInt(retryAfter, 10) : 60;
      throw rateLimitErr;
    }

    // Envelope unwrapping
    if (!response.ok) {
      var msg = (payload && payload.error && payload.error.message) ? payload.error.message : "Request failed with HTTP " + response.status;
      var apiErr = new Error(msg);
      apiErr.status = response.status;
      apiErr.code = (payload && payload.error && payload.error.code) || "HTTP_" + response.status;
      apiErr.details = (payload && payload.error && payload.error.details) || null;
      throw apiErr;
    }

    // Successful envelope { data, meta, error: null }
    var result = {
      data: payload ? (payload.data !== undefined ? payload.data : payload) : null,
      meta: (payload && payload.meta) || {}
    };

    // Store in cache
    if (options.cache !== false && method === "GET") {
      cache.set(cacheKey, {
        timestamp: Date.now(),
        value: result
      });
    }

    return result;
  }

  function invalidateCache() {
    cache.clear();
  }

  window.ExplorerAPI = {
    getBaseUrl: getBaseUrl,
    request: request,
    invalidateCache: invalidateCache,

    // Overview & Dashboard
    getOverview: function () {
      return request("/explorer/overview", { ttl: 5000 });
    },

    // Search Engine
    search: function (query) {
      return request("/explorer/search?q=" + encodeURIComponent(query.trim()), { cache: false });
    },

    // Blocks
    getBlocks: function (options) {
      options = options || {};
      var query = [];
      if (options.cursor) query.push("cursor=" + encodeURIComponent(options.cursor));
      if (options.limit) query.push("limit=" + encodeURIComponent(options.limit));
      var qs = query.length ? "?" + query.join("&") : "";
      return request("/blockchain/blocks" + qs, { ttl: 8000 });
    },

    getBlock: function (identifier) {
      return request("/explorer/block/" + encodeURIComponent(identifier), { ttl: 60000 });
    },

    getBlockConsensus: function (number) {
      return request("/blockchain/blocks/" + encodeURIComponent(number) + "/consensus", { ttl: 60000 });
    },

    // Transactions
    getTransactions: function (options) {
      options = options || {};
      var query = [];
      if (options.cursor) query.push("cursor=" + encodeURIComponent(options.cursor));
      if (options.limit) query.push("limit=" + encodeURIComponent(options.limit));
      var qs = query.length ? "?" + query.join("&") : "";
      return request("/transactions" + qs, { ttl: 8000 });
    },

    getTransaction: function (id) {
      return request("/transactions/" + encodeURIComponent(id), { ttl: 30000 });
    },

    getTransactionReceipt: function (id) {
      return request("/transactions/" + encodeURIComponent(id) + "/receipt", { ttl: 60000 });
    },

    // Address & Accounts
    getAddressDetails: function (address) {
      return request("/explorer/address/" + encodeURIComponent(address), { ttl: 10000 });
    },

    // Smart Contracts
    getContracts: function () {
      return request("/contracts", { ttl: 30000 });
    },

    getContract: function (address) {
      return request("/contracts/" + encodeURIComponent(address), { ttl: 60000 });
    },

    getContractEvents: function (address) {
      return request("/contracts/" + encodeURIComponent(address) + "/events", { ttl: 15000 });
    },

    executeContractCall: function (payload) {
      return request("/contracts/call", {
        method: "POST",
        body: Object.assign({ isView: true }, payload),
        cache: false
      });
    },

    // Events & Logs
    getEvents: function (options) {
      options = options || {};
      var query = [];
      if (options.cursor) query.push("cursor=" + encodeURIComponent(options.cursor));
      if (options.limit) query.push("limit=" + encodeURIComponent(options.limit));
      if (options.category) query.push("category=" + encodeURIComponent(options.category));
      if (options.severity) query.push("severity=" + encodeURIComponent(options.severity));
      if (options.finality) query.push("finality=" + encodeURIComponent(options.finality));
      if (options.contractAddress) query.push("contractAddress=" + encodeURIComponent(options.contractAddress));
      if (options.search) query.push("search=" + encodeURIComponent(options.search));
      var qs = query.length ? "?" + query.join("&") : "";
      return request("/events" + qs, { ttl: 5000 });
    },

    getEvent: function (eventId) {
      return request("/events/" + encodeURIComponent(eventId), { ttl: 60000 });
    },

    // Consensus & Validators
    getConsensusStatus: function () {
      return request("/consensus/status", { ttl: 5000 });
    },

    getQuorum: function () {
      return request("/consensus/quorum", { ttl: 5000 });
    },

    getValidators: function () {
      return request("/validators", { ttl: 15000 });
    },

    // Network & Sync
    getNetworkStatus: function () {
      return request("/network/status", { ttl: 8000 });
    },

    getPeers: function () {
      return request("/network/peers", { ttl: 8000 });
    },

    getTopology: function () {
      return request("/network/topology", { ttl: 30000 });
    },

    getSyncStatus: function () {
      return request("/ledger/status", { ttl: 5000 });
    },

    getHealth: function () {
      return request("/health", { ttl: 5000 });
    },

    // Merkle Proof Subsystem (Phase 16)
    getTransactionProof: function (txHash) {
      return request("/proofs/transactions/" + encodeURIComponent(txHash), { ttl: 30000 });
    },

    getBlockTxProofByIndex: function (height, index) {
      return request("/proofs/blocks/" + encodeURIComponent(height) + "/transactions/" + encodeURIComponent(index), { ttl: 30000 });
    },

    getReceiptProof: function (txHash) {
      return request("/proofs/receipts/" + encodeURIComponent(txHash), { ttl: 30000 });
    },

    getEventProof: function (eventId) {
      return request("/proofs/events/" + encodeURIComponent(eventId), { ttl: 30000 });
    },

    verifyProof: function (proof, leaf, expectedRoot) {
      return request("/proofs/verify", {
        method: "POST",
        body: { proof: proof, leaf: leaf, expectedRoot: expectedRoot }
      });
    },

    getBlockTree: function (identifier) {
      return request("/proofs/blocks/" + encodeURIComponent(identifier) + "/tree", { ttl: 30000 });
    },

    getProofStatus: function () {
      return request("/proofs/status", { ttl: 5000 });
    }
  };

})();

