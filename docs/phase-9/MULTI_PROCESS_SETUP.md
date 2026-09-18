# PDSChain Phase 9: Multi-Process Validator Setup & Operations

## 1. Process Isolation Model

In Phase 9, validators are no longer simulated as in-memory objects inside a single Node.js process. Each of the 12 validators runs as an independent operating-system process with:

- **Isolated Process ID (PID)**: Each child process has its own isolated OS heap, memory space, and event loop.
- **Dedicated SQLite Database**: Each validator writes to `database/validators/{validatorId}/pdschain.sqlite`.
- **Dedicated Write-Ahead Journal**: Each validator maintains an append-only consensus journal at `database/validators/{validatorId}/consensus_journal.jsonl`.
- **Dedicated P2P Port**: Listen ports `5001` through `5012`.
- **Dedicated HTTP Management Port**: Ports `4001` through `4012`.

---

## 2. Directory Structure

```text
database/
└── validators/
    ├── VAL-01/
    │   ├── pdschain.sqlite
    │   └── consensus_journal.jsonl
    ├── VAL-02/
    │   ├── pdschain.sqlite
    │   └── consensus_journal.jsonl
    ...
    └── VAL-12/
        ├── pdschain.sqlite
        └── consensus_journal.jsonl
```

---

## 3. Starting Validators

### A. Spawning All 12 Validators via CLI:
```bash
cd backend
npm run validators:start
```

### B. Spawning an Individual Validator Daemon Directly:
```bash
cd backend
VALIDATOR_ID=VAL-01 API_PORT=4001 P2P_PORT=5001 node src/validators/validatorProcess.js
```

### C. Programmatic Orchestration via ProcessManager:
```javascript
const ProcessManager = require('./src/validators/processManager');

const pm = new ProcessManager({ autoRestart: true });

// Start all 12 institutional validators
await pm.startAll();

// Check status
console.log(pm.getAllStatuses());

// Stop a single validator for fault-tolerance simulation
await pm.stopValidator('VAL-05');

// Restart the validator
await pm.startValidator('VAL-05');

// Clean shutdown of all processes
await pm.stopAll();
```

---

## 4. Process Supervisor & Crash Recovery

The `ProcessManager` acts as a local cluster supervisor:
1. **Crash Detection**: Detects child process exit events (`child.on('exit')`).
2. **Auto-Restart**: If configured (`autoRestart: true`), automatically respawns unexpectedly terminated nodes with exponential backoff.
3. **IPC Health Checks**: Periodically queries child processes with `GET_STATUS` to confirm responsive event loops and memory utilization.

