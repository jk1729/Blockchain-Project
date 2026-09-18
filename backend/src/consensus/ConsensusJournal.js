const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');

class ConsensusJournal {
  /**
   * @param {object} [options]
   * @param {string} [options.filepath]
   * @param {string} [options.journalPath]
   * @param {string} [options.validatorId]
   * @param {boolean} [options.inMemoryOnly=false]
   */
  constructor(options = {}) {
    this.inMemoryOnly = options.inMemoryOnly || false;
    this.validatorId = options.validatorId || 'VAL-01';
    this.filepath = options.filepath || options.journalPath || path.join(__dirname, '../../database/consensus_journal.jsonl');
    this.entries = [];

    // Ensure directory exists if not inMemoryOnly
    if (!this.inMemoryOnly) {
      try {
        const dir = path.dirname(this.filepath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
      } catch (err) {
        // Fallback to in-memory if file system is unwritable
        this.inMemoryOnly = true;
      }
    }
  }

  /**
   * Append a consensus event entry to journal
   * @param {string} eventType 
   * @param {object} data 
   * @returns {object} Journal entry
   */
  append(eventType, data = {}) {
    const entry = {
      sequence: this.entries.length + 1,
      eventType: String(eventType).toUpperCase(),
      timestamp: new Date().toISOString(),
      data
    };

    this.entries.push(entry);

    if (!this.inMemoryOnly && this.filepath) {
      try {
        fs.appendFileSync(this.filepath, JSON.stringify(entry) + '\n', 'utf8');
      } catch (err) {
        // Continue in memory
      }
    }

    return entry;
  }

  /**
   * Recover consensus state from journal with corrupt record quarantine & replay
   * @returns {{
   *   lastHeight: number,
   *   lastRound: number,
   *   finalizedHeights: number[],
   *   activeRoundId: string|null,
   *   entryCount: number,
   *   recordedVoteCount: number,
   *   hasCorruptedRecords: boolean,
   *   quarantinedPath: string|null,
   *   unfinalizedRounds: object[]
   * }}
   */
  recoverState() {
    let validEntries = [];
    let hasCorruptedRecords = false;
    let quarantinedPath = null;

    if (!this.inMemoryOnly && fs.existsSync(this.filepath)) {
      try {
        const raw = fs.readFileSync(this.filepath, 'utf8');
        const rawLines = raw.split('\n');

        for (let i = 0; i < rawLines.length; i++) {
          const line = rawLines[i].trim();
          if (!line) continue;

          try {
            const parsed = JSON.parse(line);
            if (!parsed.eventType || !parsed.timestamp) {
              throw new Error('Malformed journal entry schema');
            }
            validEntries.push(parsed);
          } catch (parseErr) {
            hasCorruptedRecords = true;
            logger.warn(`[ConsensusJournal] Malformed or truncated journal record detected on line ${i + 1}: ${parseErr.message}`);
          }
        }

        // Quarantine corrupted journal file and restore valid prefix
        if (hasCorruptedRecords) {
          quarantinedPath = `${this.filepath}.corrupt.${Date.now()}`;
          try {
            fs.copyFileSync(this.filepath, quarantinedPath);
            // Rewrite journal with valid entries only (safe journal repair)
            const cleanContent = validEntries.map(e => JSON.stringify(e)).join('\n') + (validEntries.length > 0 ? '\n' : '');
            fs.writeFileSync(this.filepath, cleanContent, 'utf8');
            logger.warn(`[ConsensusJournal] Corrupted journal quarantined to '${quarantinedPath}' and repaired with ${validEntries.length} valid records`);
          } catch (qErr) {
            logger.error(`[ConsensusJournal] Failed to quarantine corrupted journal: ${qErr.message}`);
          }
        }
      } catch (err) {
        validEntries = this.entries;
      }
    } else {
      validEntries = this.entries;
    }

    this.entries = validEntries;

    let lastHeight = 0;
    let lastRound = 0;
    let activeRoundId = null;
    const finalizedHeights = new Set();
    const recordedVotes = [];
    const unfinalizedRoundsMap = new Map(); // height -> round details

    for (const entry of validEntries) {
      const data = entry.data || {};
      const height = data.height !== undefined ? data.height : data.blockNumber;
      const round = data.round !== undefined ? data.round : 0;

      if (height !== undefined) lastHeight = Math.max(lastHeight, height);
      if (data.round !== undefined) lastRound = Math.max(lastRound, data.round);
      if (data.roundId) activeRoundId = data.roundId;

      if (entry.eventType === 'BLOCK_FINALIZED' && height !== undefined) {
        finalizedHeights.add(height);
        unfinalizedRoundsMap.delete(height);
      } else if (['VOTE_CAST', 'VOTE_RECORDED', 'ROUND_CHANGE', 'PROPOSAL_RECEIVED'].includes(entry.eventType)) {
        if (height !== undefined && !finalizedHeights.has(height)) {
          unfinalizedRoundsMap.set(height, { height, round, activeRoundId, lastEvent: entry.eventType });
        }
      }

      if (entry.eventType === 'VOTE_RECORDED' && data.vote) {
        recordedVotes.push(data.vote);
      }
    }

    return {
      lastHeight,
      lastRound,
      finalizedHeights: Array.from(finalizedHeights).sort((a, b) => a - b),
      activeRoundId,
      entryCount: validEntries.length,
      recordedVoteCount: recordedVotes.length,
      hasCorruptedRecords,
      quarantinedPath,
      unfinalizedRounds: Array.from(unfinalizedRoundsMap.values())
    };
  }

  getEntries() {
    return [...this.entries];
  }

  clear() {
    this.entries = [];
    if (!this.inMemoryOnly && fs.existsSync(this.filepath)) {
      try {
        fs.writeFileSync(this.filepath, '', 'utf8');
      } catch (err) {}
    }
  }

  close() {
    // No-op for sync append
  }
}

module.exports = ConsensusJournal;
