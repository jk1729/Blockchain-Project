const { ethers } = require('ethers');

/**
 * ABI Encoder & Decoder for PDSChain EVM Smart Contracts
 */
class ABIEncoder {
  /**
   * Encode contract method call to hex calldata (0x...)
   * @param {Array|object} abi - Contract ABI or fragment
   * @param {string} methodName - Function name
   * @param {Array} args - Arguments array
   * @returns {string} Hex calldata
   */
  static encodeCall(abi, methodName, args = []) {
    const iface = new ethers.Interface(abi);
    return iface.encodeFunctionData(methodName, args);
  }

  /**
   * Helper to convert BigInts and complex Ethers Result objects to JSON-serializable types
   */
  static sanitizeDecoded(val) {
    if (typeof val === 'bigint') {
      return val <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(val) : val.toString();
    }
    if (Array.isArray(val)) {
      return val.map(item => ABIEncoder.sanitizeDecoded(item));
    }
    if (val && typeof val === 'object' && !(val instanceof Uint8Array)) {
      const entries = Object.entries(val);
      // Filter out numeric index keys from Ethers Result objects if named keys exist
      const namedEntries = entries.filter(([k]) => isNaN(parseInt(k, 10)));
      const source = namedEntries.length > 0 ? namedEntries : entries;
      const obj = {};
      for (const [k, v] of source) {
        obj[k] = ABIEncoder.sanitizeDecoded(v);
      }
      return obj;
    }
    return val;
  }

  /**
   * Decode hex return data from contract method call
   * @param {Array|object} abi 
   * @param {string} methodName 
   * @param {string} returnDataHex 
   * @returns {Array|object} Decoded results
   */
  static decodeReturn(abi, methodName, returnDataHex) {
    if (!returnDataHex || returnDataHex === '0x') return null;
    const iface = new ethers.Interface(abi);
    const decoded = iface.decodeFunctionResult(methodName, returnDataHex);
    const raw = decoded.length === 1 ? decoded[0] : Array.from(decoded);
    return ABIEncoder.sanitizeDecoded(raw);
  }

  /**
   * Decode contract event logs
   * @param {Array|object} abi 
   * @param {Array} rawLogs - Array of raw EVM log objects { topics, data, address }
   * @returns {Array} Array of decoded event objects
   */
  static decodeLogs(abi, rawLogs = []) {
    const iface = new ethers.Interface(abi);
    const decodedEvents = [];

    for (const log of rawLogs) {
      try {
        const rawTopics = Array.isArray(log) ? log[1] : (log.topics || []);
        const rawData = Array.isArray(log) ? log[2] : (log.data !== undefined ? log.data : '0x');
        const parsed = iface.parseLog({
          topics: (rawTopics || []).map(t => typeof t === 'string' ? t : '0x' + Buffer.from(t).toString('hex')),
          data: typeof rawData === 'string' ? rawData : '0x' + Buffer.from(rawData || []).toString('hex')
        });
        if (parsed) {
          let rawArgs = {};
          if (typeof parsed.args.toObject === 'function') {
            rawArgs = parsed.args.toObject();
          } else if (parsed.fragment && parsed.fragment.inputs) {
            parsed.fragment.inputs.forEach((input, idx) => {
              rawArgs[input.name || `arg${idx}`] = parsed.args[idx];
            });
          } else {
            rawArgs = parsed.args;
          }

          decodedEvents.push({
            name: parsed.name,
            signature: parsed.signature,
            args: Object.fromEntries(
              Object.entries(rawArgs)
                .filter(([k]) => isNaN(parseInt(k, 10))) // filter out numeric indices
                .map(([k, v]) => {
                  let val = v;
                  if (typeof v === 'bigint') val = v.toString();
                  else if (v && typeof v === 'object' && v.hash) val = v.hash;
                  return [k, val];
                })
            )
          });
        }
      } catch (e) {
        // Not an event from this ABI or anonymous event; skip
      }
    }

    return decodedEvents;
  }

  /**
   * Decode revert reason from returnData / error data
   * @param {string|Buffer} errorData 
   * @returns {string} Human-readable revert reason
   */
  static decodeRevertReason(errorData) {
    if (!errorData) return 'Transaction reverted without reason';
    const hex = typeof errorData === 'string' ? errorData : '0x' + Buffer.from(errorData).toString('hex');
    
    if (hex.length < 10) return 'Transaction reverted';

    // Standard Error(string) selector: 0x08c379a0
    if (hex.startsWith('0x08c379a0')) {
      try {
        const reason = ethers.AbiCoder.defaultAbiCoder().decode(['string'], '0x' + hex.substring(10))[0];
        return reason;
      } catch (e) {
        return 'Reverted with Error(string)';
      }
    }

    // Panic(uint256) selector: 0x4e487b71
    if (hex.startsWith('0x4e487b71')) {
      try {
        const code = ethers.AbiCoder.defaultAbiCoder().decode(['uint256'], '0x' + hex.substring(10))[0];
        return `Panic code ${code}`;
      } catch (e) {
        return 'Reverted with Panic';
      }
    }

    return `Custom Error: ${hex.substring(0, 10)}`;
  }
}

module.exports = ABIEncoder;
