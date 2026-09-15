/**
 * PDSChain Mempool Policy Configuration
 * 
 * Defines capacity limits, per-sender limits, TTL, nonce gap thresholds,
 * and canonical size constraints for the transaction mempool.
 */

class MempoolPolicy {
  constructor(options = {}) {
    this.maxTransactions = options.maxTransactions !== undefined
      ? parseInt(options.maxTransactions, 10)
      : (parseInt(process.env.MEMPOOL_MAX_TRANSACTIONS, 10) || 5000);

    this.maxTransactionsPerSender = options.maxTransactionsPerSender !== undefined
      ? parseInt(options.maxTransactionsPerSender, 10)
      : (parseInt(process.env.MEMPOOL_MAX_PER_SENDER, 10) || 100);

    this.transactionTTL = options.transactionTTL !== undefined
      ? parseInt(options.transactionTTL, 10)
      : (parseInt(process.env.MEMPOOL_TTL_MS, 10) || 3600000); // 1 hour default

    this.maxFutureNonceGap = options.maxFutureNonceGap !== undefined
      ? parseInt(options.maxFutureNonceGap, 10)
      : (parseInt(process.env.MEMPOOL_MAX_FUTURE_NONCE_GAP, 10) || 100);

    this.maxTransactionSizeBytes = options.maxTransactionSizeBytes !== undefined
      ? parseInt(options.maxTransactionSizeBytes, 10)
      : (parseInt(process.env.MEMPOOL_MAX_TX_SIZE_BYTES, 10) || 65536); // 64 KB default
  }

  toJSON() {
    return {
      maxTransactions: this.maxTransactions,
      maxTransactionsPerSender: this.maxTransactionsPerSender,
      transactionTTL: this.transactionTTL,
      maxFutureNonceGap: this.maxFutureNonceGap,
      maxTransactionSizeBytes: this.maxTransactionSizeBytes
    };
  }
}

module.exports = MempoolPolicy;

