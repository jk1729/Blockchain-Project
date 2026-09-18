const EventEmitter = require('events');

const ConsensusState = {
  IDLE: 'IDLE',
  PROPOSAL: 'PROPOSAL',
  PREVOTE: 'PREVOTE',
  ACCEPTED: 'ACCEPTED',
  CERTIFIED: 'CERTIFIED',
  FINALIZED: 'FINALIZED',
  REJECTED: 'REJECTED',
  TIMEOUT: 'TIMEOUT',
  RECOVERING: 'RECOVERING'
};

const LEGAL_TRANSITIONS = {
  [ConsensusState.IDLE]: [ConsensusState.PROPOSAL, ConsensusState.RECOVERING],
  [ConsensusState.PROPOSAL]: [ConsensusState.PREVOTE, ConsensusState.REJECTED, ConsensusState.TIMEOUT],
  [ConsensusState.PREVOTE]: [ConsensusState.ACCEPTED, ConsensusState.REJECTED, ConsensusState.TIMEOUT],
  [ConsensusState.ACCEPTED]: [ConsensusState.CERTIFIED, ConsensusState.REJECTED, ConsensusState.TIMEOUT],
  [ConsensusState.CERTIFIED]: [ConsensusState.FINALIZED, ConsensusState.REJECTED],
  [ConsensusState.FINALIZED]: [ConsensusState.IDLE],
  [ConsensusState.REJECTED]: [ConsensusState.IDLE, ConsensusState.RECOVERING, ConsensusState.PROPOSAL],
  [ConsensusState.TIMEOUT]: [ConsensusState.RECOVERING, ConsensusState.PROPOSAL, ConsensusState.IDLE],
  [ConsensusState.RECOVERING]: [ConsensusState.IDLE, ConsensusState.PROPOSAL]
};

class ConsensusStateMachine extends EventEmitter {
  /**
   * @param {object} [options]
   * @param {number} [options.initialHeight=0]
   */
  constructor(options = {}) {
    super();
    this.currentState = ConsensusState.IDLE;
    this.currentHeight = parseInt(options.initialHeight, 10) || 0;
    this.currentRound = 0;
    this.currentRoundId = null;
    this.history = [];
    this.finalizedHeights = new Set();
  }

  getState() {
    return this.currentState;
  }

  canTransition(targetState) {
    const allowed = LEGAL_TRANSITIONS[this.currentState] || [];
    return allowed.includes(targetState);
  }

  /**
   * Transition to a new consensus state
   * @param {string} targetState 
   * @param {object} [context] - { height, round, roundId, reason }
   * @returns {{ success: boolean, state: string, error?: string }}
   */
  transition(targetState, context = {}) {
    const fromState = this.currentState;
    const height = context.height !== undefined ? parseInt(context.height, 10) : this.currentHeight;
    const round = context.round !== undefined ? parseInt(context.round, 10) : this.currentRound;
    const roundId = context.roundId || this.currentRoundId;
    const reason = context.reason || '';

    // Guard: once a height is FINALIZED, it can never be altered or re-entered
    if (this.finalizedHeights.has(height) && targetState !== ConsensusState.IDLE) {
      const err = `FINALIZED_HEIGHT_IMMUTABLE: Block height #${height} is already finalized and cannot be re-entered`;
      return { success: false, state: fromState, error: err };
    }

    // Check if transition is legally allowed
    if (!this.canTransition(targetState)) {
      const err = `ILLEGAL_STATE_TRANSITION: Cannot transition from ${fromState} to ${targetState}`;
      return { success: false, state: fromState, error: err };
    }

    // Apply state change
    this.currentState = targetState;
    this.currentHeight = height;
    this.currentRound = round;
    if (roundId) this.currentRoundId = roundId;

    if (targetState === ConsensusState.FINALIZED) {
      this.finalizedHeights.add(height);
    }

    const transitionEvent = {
      from: fromState,
      to: targetState,
      height,
      round,
      roundId,
      reason,
      timestamp: new Date().toISOString()
    };

    this.history.push(transitionEvent);
    if (this.history.length > 200) this.history.shift();

    this.emit('transition', transitionEvent);
    this.emit(`state:${targetState}`, transitionEvent);

    return { success: true, state: targetState };
  }

  isFinalized(height) {
    return this.finalizedHeights.has(parseInt(height, 10));
  }

  resetForNewHeight(newHeight) {
    this.currentHeight = parseInt(newHeight, 10);
    this.currentRound = 0;
    this.currentRoundId = null;
    this.currentState = ConsensusState.IDLE;
  }

  getHistory() {
    return [...this.history];
  }

  toJSON() {
    return {
      state: this.currentState,
      height: this.currentHeight,
      round: this.currentRound,
      roundId: this.currentRoundId,
      finalizedCount: this.finalizedHeights.size,
      historyLength: this.history.length
    };
  }
}

module.exports = {
  ConsensusState,
  ConsensusStateMachine
};
