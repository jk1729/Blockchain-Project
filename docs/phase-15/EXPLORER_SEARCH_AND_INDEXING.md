# PDSChain Phase 15: Explorer Search and Indexing Engine

## 1. Universal Search Architecture

The PDSChain Explorer search engine provides an instantaneous, zero-confusion search experience. Rather than executing slow, unindexed, brute-force text scans across the whole database, the engine classifies query syntax before executing targeted index lookups:

```
                          User Search Input
                                 |
                                 v
                     [ Query Pattern Classifier ]
                                 |
    +-------------+-------------+-------------+-------------+-------------+
    |             |             |             |             |             |
    v             v             v             v             v             v
  Numeric     64-Hex Char     "TXN-*"       "VAL-*"       "PDS1*"       "EVT-*"
    |             |             |             |             |             |
    v             v             v             v             v             v
  Block       Block Hash   Transaction    Validator      Address /      Event
  Height     or Tx Hash        ID            ID         Contract       Journal
    |             |             |             |             |             |
    +-------------+-------------+-------------+-------------+-------------+
                                 |
                                 v
               Categorized Matches with Confidence & Routes
                                 |
               +-----------------+-----------------+
               |                                   |
         Exact Match (1)                   Multiple Matches (>1)
               |                                   |
         Direct Navigation                  Disambiguation Modal
      (#block/4, #tx/TXN...)                 (User selects item)
```

---

## 2. Classification Patterns & Routing

| Query Pattern | Example | Classified Entity | Lookup Target | Route |
|---|---|---|---|---|
| `/^\d+$/` | `0`, `4` | `BLOCK` | `blockchainService.getBlockByNumber()` | `#block/:number` |
| `/^(0x)?[0-9a-fA-F]{64}$/i` | `0x8a7f9c2d...` | `BLOCK` or `TRANSACTION` | `blockchainService.getBlockByHash()` & `transactionService.getTransactionById()` | `#block/:number` or `#tx/:hash` |
| `/^TXN-[0-9a-zA-Z_-]+/i` | `TXN-004281` | `TRANSACTION` | `transactionService.getTransactionById()` | `#tx/:id` |
| `/^VAL-[0-9a-zA-Z_-]+/i` | `VAL-01` | `VALIDATOR` | `DEFAULT_12_VALIDATORS` directory | `#validators` |
| `/^PDS1[0-9a-zA-Z]+/i` | `PDS1000...` | `ADDRESS` | `explorerController.getAddressDetails()` | `#address/:addr` |
| `/^0x[0-9a-fA-F]{40}$/i` | `0x1000...` | `CONTRACT` or `ADDRESS` | `contractRegistry.getContractByAddress()` | `#contract/:addr` or `#address/:addr` |
| `/^EVT-[0-9a-zA-Z_-]+/i` | `EVT-01` | `EVENT` | `eventStore.getEventById()` | `#events` |

---

## 3. Database Indexes & Performance Guarantees

1. **Transaction Primary & Unique Keys**:
   - `Transaction.transactionId`: Unique index in SQLite/Postgres.
   - `Transaction.hash`: Indexed column for sub-5ms SHA-256 lookups.
2. **Block Primary Keys**:
   - `Block.blockNumber`: Primary key for instantaneous height resolution.
   - In-memory `chain` array for sub-millisecond block traversal.
3. **Smart Contract Registry**:
   - `contractRegistry`: Map keyed by address for $O(1)$ contract ABI and code lookups.
4. **Safety Against Abuse**:
   - Queries with special characters or SQL wildcards (`'`, `1=1`, `;--`, `<script>`) are safely escaped and return empty matches without throwing database or server exceptions.

