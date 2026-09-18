# PDSChain Phase 11: Native Service Deployment Guide

## 1. Scope & Overview

For environments where containerization is not preferred or allowed, PDSChain provides native OS service deployment options:
1. **Linux `systemd`**: Managed background daemon with restart limits, security sandboxing, and journald logging.
2. **Windows Service / Task Scheduler**: Managed background runner via PowerShell automation.

---

## 2. Linux `systemd` Deployment

### Step 1: System User & Directory Setup
```bash
# Create dedicated non-root service user
sudo useradd -r -s /bin/false -d /var/lib/pdschain pdschain

# Create directory hierarchy for VAL-01
sudo mkdir -p /var/lib/pdschain/VAL-01/{database,journal,checkpoints,logs,backups}
sudo chown -R pdschain:pdschain /var/lib/pdschain/VAL-01
sudo chmod -R 700 /var/lib/pdschain/VAL-01
```

### Step 2: Install Unit File
Copy the unit template from the repository:
```bash
sudo cp scripts/service/pdschain-validator.service /etc/systemd/system/pdschain-validator@.service
sudo systemctl daemon-reload
```

### Step 3: Provision Validator Identity
```bash
sudo -u pdschain node backend/src/scripts/provisionIdentity.js \
  --id VAL-01 \
  --out /var/lib/pdschain/VAL-01/identity.json
```

### Step 4: Enable & Start Service
```bash
# Enable on boot and start immediately
sudo systemctl enable --now pdschain-validator@VAL-01

# Check service status and health
sudo systemctl status pdschain-validator@VAL-01

# View logs via journalctl
sudo journalctl -u pdschain-validator@VAL-01 -f
```

---

## 3. Windows Service Deployment

For Windows Server and desktop environments:

```powershell
# Open PowerShell as Administrator
cd "d:\Blockchain Project"

# Execute installation script
.\scripts\service\Install-ValidatorService.ps1 -ValidatorId VAL-01 -DataDir "C:\pdschain\data\VAL-01"

# Start the background task
Start-ScheduledTask -TaskName "PDSChain-Validator-VAL-01"

# Query health probe
curl.exe -s http://127.0.0.1:4001/health/ready
```

---

## 4. Signal Handling & Process Supervision

Both Linux and Windows service definitions enforce:
- Graceful termination on `SIGTERM` / shutdown signal with a 15-second grace window (`TimeoutStopSec=15`).
- Automatic restart on failure with bounded exponential backoff (`Restart=on-failure`, `RestartSec=5s`).
- Bounded restart frequency to avoid tight crash loops (`StartLimitBurst=5` within 120 seconds).
- Single-instance PID locking (`validator.pid`) to eliminate concurrent storage mount conflicts.

