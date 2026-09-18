/**
 * Phase 18: Database & Append-Only Journals Integration Test Suite
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { JournalStorageManager } = require('../src/database/JournalStorageManager');
const { EventRecord, sequelize } = require('../src/models');

describe('Phase 18: Journal Storage, Hash Chaining & Replay', () => {
  let journalManager;
  let tempDir;
  let journalPath;

  beforeEach(() => {
    journalManager = new JournalStorageManager();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pds-journal-test-'));
    journalPath = path.join(tempDir, 'security_audit.jsonl');
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (e) {
      // Ignore
    }
  });

  describe('1. Cryptographic SHA-256 Hash Chain Verification', () => {
    test('should verify a properly hash-chained audit journal', async () => {
      let prevHash = '0'.repeat(64);
      const lines = [];

      for (let i = 1; i <= 3; i++) {
        const timestamp = new Date().toISOString();
        const eventType = 'AUTH_LOGIN';
        const payload = { userId: `USR-${i}` };
        const hashInput = prevHash + timestamp + eventType + JSON.stringify(payload);
        const entryHash = crypto.createHash('sha256').update(hashInput).digest('hex');

        lines.push(JSON.stringify({
          sequence: i,
          previousEntryHash: prevHash,
          timestamp,
          eventType,
          payload,
          entryHash
        }));
        prevHash = entryHash;
      }

      fs.writeFileSync(journalPath, lines.join('\n') + '\n');

      const result = await journalManager.verifyJournalHashChain(journalPath);
      expect(result.valid).toBe(true);
      expect(result.entryCount).toBe(3);
      expect(result.errors.length).toBe(0);
    });

    test('should catch broken hash chain when an entry is modified', async () => {
      let prevHash = '0'.repeat(64);
      const lines = [];

      for (let i = 1; i <= 2; i++) {
        const timestamp = new Date().toISOString();
        const eventType = 'AUTH_LOGIN';
        const payload = { userId: `USR-${i}` };
        const hashInput = prevHash + timestamp + eventType + JSON.stringify(payload);
        const entryHash = crypto.createHash('sha256').update(hashInput).digest('hex');

        lines.push({
          sequence: i,
          previousEntryHash: prevHash,
          timestamp,
          eventType,
          payload,
          entryHash
        });
        prevHash = entryHash;
      }

      // Tamper line 1 payload
      lines[0].payload.userId = 'USR-TAMPERED';
      const fileContent = lines.map(l => JSON.stringify(l)).join('\n') + '\n';
      fs.writeFileSync(journalPath, fileContent);

      const result = await journalManager.verifyJournalHashChain(journalPath);
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.includes('hash mismatch'))).toBe(true);
    });
  });

  describe('2. Corruption Quarantine & Rotation', () => {
    test('should quarantine corrupt lines to .corrupt file', () => {
      journalManager.quarantineCorruptLine('CORRUPTED_NON_JSON_BYTES', journalPath);

      const corruptPath = `${journalPath}.corrupt`;
      expect(fs.existsSync(corruptPath)).toBe(true);
      const content = fs.readFileSync(corruptPath, 'utf8');
      expect(content).toContain('CORRUPTED_NON_JSON_BYTES');
    });

    test('should rotate journal file exceeding max size', () => {
      // Write 2KB of data
      fs.writeFileSync(journalPath, 'A'.repeat(2048));

      // Rotate with 1KB threshold
      const res = journalManager.rotateJournal(journalPath, 1024);
      expect(res.rotated).toBe(true);
      expect(fs.existsSync(res.newSegmentPath)).toBe(true);
      expect(fs.existsSync(journalPath)).toBe(false);
    });
  });

  describe('3. Event Journal Replay into Relational Tables', () => {
    beforeAll(async () => {
      await sequelize.sync({ alter: false });
    });

    test('should replay valid events into EventRecord model and deduplicate', async () => {
      const evId = 'EV-REPLAY-' + Date.now();
      const events = [
        {
          eventId: evId,
          eventType: 'BLOCK_COMMITTED',
          category: 'BLOCKCHAIN',
          payload: { block: 10 }
        }
      ];

      const evJournalPath = path.join(tempDir, 'events_journal.jsonl');
      fs.writeFileSync(evJournalPath, JSON.stringify(events[0]) + '\n');

      const res1 = await journalManager.replayEventsToDatabase(evJournalPath, EventRecord);
      expect(res1.replayed).toBe(1);

      // Replaying second time should skip duplicate
      const res2 = await journalManager.replayEventsToDatabase(evJournalPath, EventRecord);
      expect(res2.replayed).toBe(0);
      expect(res2.skipped).toBe(1);
    });
  });
});

