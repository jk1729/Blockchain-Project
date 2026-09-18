/**
 * PDSChain Journal Storage & Forensic Reconciliation Manager (Phase 18)
 * 
 * Manages append-only JSONL files (consensus, events, security audit),
 * cryptographic hash-chain verification, journal rotation, and replay into
 * relational derived tables.
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const crypto = require('crypto');
const logger = require('../utils/logger');

class JournalStorageManager {
  constructor(options = {}) {
    this.logger = options.logger || logger;
  }

  /**
   * Verify SHA-256 hash chaining of an append-only audit journal
   * @param {string} journalPath 
   * @returns {Promise<{ valid: boolean, entryCount: number, errors: Array<string> }>}
   */
  async verifyJournalHashChain(journalPath) {
    if (!fs.existsSync(journalPath)) {
      return { valid: true, entryCount: 0, errors: [] };
    }

    const errors = [];
    let entryCount = 0;
    let previousHash = '0'.repeat(64);

    const fileStream = fs.createReadStream(journalPath);
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    for await (const line of rl) {
      if (!line || line.trim() === '') continue;
      entryCount++;

      try {
        const record = JSON.parse(line);

        // 1. Verify previous hash chaining
        if (record.previousEntryHash !== previousHash) {
          errors.push(
            `Line ${entryCount}: broken hash link. Expected previous hash '${previousHash}', found '${record.previousEntryHash}'.`
          );
        }

        // 2. Recompute current entry hash
        const hashPayload = record.previousEntryHash + record.timestamp + record.eventType + JSON.stringify(record.payload || record.details || {});
        const expectedHash = crypto.createHash('sha256').update(hashPayload).digest('hex');

        if (record.entryHash !== expectedHash) {
          errors.push(
            `Line ${entryCount}: hash mismatch. Recorded '${record.entryHash}', calculated '${expectedHash}'.`
          );
        }

        previousHash = record.entryHash;
      } catch (err) {
        errors.push(`Line ${entryCount}: unparseable corrupted JSON (${err.message}).`);
      }
    }

    return {
      valid: errors.length === 0,
      entryCount,
      errors
    };
  }

  /**
   * Quarantine a corrupted journal line to a .corrupt companion file
   * @param {string} line 
   * @param {string} journalPath 
   */
  quarantineCorruptLine(line, journalPath) {
    const corruptPath = `${journalPath}.corrupt`;
    const record = `[${new Date().toISOString()}] ${line}\n`;
    fs.appendFileSync(corruptPath, record, 'utf8');
    this.logger.warn(`[JournalStorageManager] Quarantined corrupted line to ${corruptPath}`);
  }

  /**
   * Rotate a journal file if it exceeds size threshold
   * @param {string} journalPath 
   * @param {number} [maxSizeBytes=10485760] - 10MB default
   * @returns {{ rotated: boolean, newSegmentPath?: string }}
   */
  rotateJournal(journalPath, maxSizeBytes = 10485760) {
    if (!fs.existsSync(journalPath)) {
      return { rotated: false };
    }

    const stats = fs.statSync(journalPath);
    if (stats.size < maxSizeBytes) {
      return { rotated: false };
    }

    const timestamp = Date.now();
    const rotatedPath = `${journalPath}.${timestamp}.bak`;
    fs.renameSync(journalPath, rotatedPath);
    this.logger.info(`[JournalStorageManager] Rotated ${journalPath} to ${rotatedPath}`);

    return {
      rotated: true,
      newSegmentPath: rotatedPath
    };
  }

  /**
   * Replay events from JSONL journal into relational EventRecord table
   * @param {string} journalPath 
   * @param {object} EventRecordModel 
   * @returns {Promise<{ replayed: number, skipped: number }>}
   */
  async replayEventsToDatabase(journalPath, EventRecordModel) {
    if (!fs.existsSync(journalPath)) {
      return { replayed: 0, skipped: 0 };
    }

    let replayed = 0;
    let skipped = 0;

    const fileStream = fs.createReadStream(journalPath);
    const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

    for await (const line of rl) {
      if (!line || line.trim() === '') continue;
      try {
        const ev = JSON.parse(line);
        const eventId = ev.eventId || ev.id;
        if (!eventId) continue;

        const existing = await EventRecordModel.findOne({ where: { eventId } });
        if (existing) {
          skipped++;
          continue;
        }

        await EventRecordModel.create({
          eventId,
          eventType: ev.eventType || ev.type || 'UNKNOWN',
          category: ev.category || 'BLOCKCHAIN',
          severity: ev.severity || 'INFO',
          finalityStatus: ev.finalityStatus || 'FINALIZED',
          blockNumber: ev.blockNumber || null,
          blockHash: ev.blockHash || null,
          transactionHash: ev.transactionHash || null,
          deduplicationKey: ev.deduplicationKey || `${eventId}-${Date.now()}`,
          payload: ev.payload || ev.data || {},
          timestamp: ev.timestamp || new Date().toISOString()
        });
        replayed++;
      } catch (err) {
        this.quarantineCorruptLine(line, journalPath);
      }
    }

    return { replayed, skipped };
  }
}

module.exports = {
  JournalStorageManager
};

