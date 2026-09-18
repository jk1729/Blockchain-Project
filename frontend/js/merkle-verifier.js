/**
 * PDSChain Standalone Merkle Verifier (Phase 16 - Stage K)
 * 
 * Browser & Node.js dual-compatible independent Merkle inclusion proof verifier.
 * Operates with ZERO network or database calls.
 */

(function (root, factory) {
  if (typeof define === 'function' && define.amd) {
    define([], factory);
  } else if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.MerkleVerifier = factory();
  }
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var HEX_64_REGEX = /^(0x)?[0-9a-fA-F]{64}$/;

  function cleanHex(h) {
    if (typeof h !== 'string') return '';
    return h.startsWith('0x') ? h.slice(2).toLowerCase() : h.toLowerCase();
  }

  // Pure JavaScript synchronous SHA-256 implementation for standalone zero-dependency verification
  function sha256Sync(ascii) {
    function rightRotate(value, amount) {
      return (value >>> amount) | (value << (32 - amount));
    }

    var mathPow = Math.pow;
    var maxWord = mathPow(2, 32);
    var lengthProperty = 'length';
    var i, j;
    var result = '';

    var words = [];
    var asciiBitLength = ascii[lengthProperty] * 8;

    var hash = [
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
      0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
    ];

    var k = [
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
      0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
      0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
      0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    ];

    var composite = ascii + '\x80';
    while (composite[lengthProperty] % 64 - 56) composite += '\x00';
    for (i = 0; i < composite[lengthProperty]; i++) {
      j = composite.charCodeAt(i);
      words[i >> 2] |= j << ((3 - i % 4) * 8);
    }
    words[words[lengthProperty]] = ((asciiBitLength / maxWord) | 0);
    words[words[lengthProperty]] = (asciiBitLength | 0);

    for (j = 0; j < words[lengthProperty];) {
      var w = words.slice(j, j += 16);
      var oldHash = hash;
      hash = hash.slice(0, 8);

      for (i = 0; i < 64; i++) {
        var w15 = w[i - 15], w2 = w[i - 2];

        var s0 = rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3);
        var s1 = rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10);
        w[i] = (i < 16) ? w[i] : (w[i - 16] + s0 + w[i - 7] + s1) | 0;

        var s1h = rightRotate(hash[4], 6) ^ rightRotate(hash[4], 11) ^ rightRotate(hash[4], 25);
        var ch = (hash[4] & hash[5]) ^ (~hash[4] & hash[6]);
        var temp1 = (hash[7] + s1h + ch + k[i] + w[i]) | 0;
        var s0h = rightRotate(hash[0], 2) ^ rightRotate(hash[0], 13) ^ rightRotate(hash[0], 22);
        var maj = (hash[0] & hash[1]) ^ (hash[0] & hash[2]) ^ (hash[1] & hash[2]);
        var temp2 = (s0h + maj) | 0;

        hash = [(temp1 + temp2) | 0].concat(hash);
        hash[4] = (hash[4] + temp1) | 0;
        hash.pop();
      }

      for (i = 0; i < 8; i++) {
        hash[i] = (hash[i] + oldHash[i]) | 0;
      }
    }

    for (i = 0; i < 8; i++) {
      for (j = 3; j >= 0; j--) {
        var b = (hash[i] >> (8 * j)) & 255;
        result += (b < 16 ? '0' : '') + b.toString(16);
      }
    }

    return result;
  }

  function hashPair(left, right, version) {
    if (version === 2) {
      // In version 2, prefix with 0x01
      return sha256Sync('\x01' + left + right);
    }
    // Version 1: sha256(left + right)
    return sha256Sync(left + right);
  }

  /**
   * Verify a Merkle proof independently
   * @param {object} proof
   * @param {string} [leafDataOrHash]
   * @param {string} [expectedRoot]
   * @returns {{ valid: boolean, reason: string|null, message: string, computedRoot: string, expectedRoot: string, leafIndex: number, treeDepth: number }}
   */
  function verify(proof, leafDataOrHash, expectedRoot) {
    if (!proof || typeof proof !== 'object') {
      return {
        valid: false,
        reason: 'MALFORMED_PROOF',
        message: 'Proof must be a valid non-null object',
        computedRoot: null,
        expectedRoot: null,
        leafIndex: -1,
        treeDepth: -1
      };
    }

    var version = Number(proof.version) || 1;
    var leafHash = cleanHex(proof.leafHash);
    var targetRoot = cleanHex(expectedRoot || proof.expectedRoot);
    var siblings = Array.isArray(proof.siblings) ? proof.siblings : [];
    var treeDepth = proof.treeDepth !== undefined ? Number(proof.treeDepth) : siblings.length;
    var leafIndex = Number(proof.leafIndex);

    if (!HEX_64_REGEX.test(leafHash)) {
      return {
        valid: false,
        reason: 'INVALID_LEAF',
        message: 'Proof leafHash is not a valid 64-character hex string',
        computedRoot: null,
        expectedRoot: targetRoot,
        leafIndex: leafIndex,
        treeDepth: treeDepth
      };
    }

    if (!HEX_64_REGEX.test(targetRoot)) {
      return {
        valid: false,
        reason: 'MALFORMED_PROOF',
        message: 'Target root is not a valid 64-character hex string',
        computedRoot: null,
        expectedRoot: targetRoot,
        leafIndex: leafIndex,
        treeDepth: treeDepth
      };
    }

    if (siblings.length !== treeDepth) {
      return {
        valid: false,
        reason: 'MALFORMED_PROOF',
        message: 'Siblings array length (' + siblings.length + ') does not match treeDepth (' + treeDepth + ')',
        computedRoot: null,
        expectedRoot: targetRoot,
        leafIndex: leafIndex,
        treeDepth: treeDepth
      };
    }

    // Check optional provided leaf hash
    if (leafDataOrHash && typeof leafDataOrHash === 'string' && HEX_64_REGEX.test(leafDataOrHash)) {
      if (cleanHex(leafDataOrHash) !== leafHash) {
        return {
          valid: false,
          reason: 'INVALID_LEAF',
          message: 'Provided leaf hash does not match proof leafHash',
          computedRoot: null,
          expectedRoot: targetRoot,
          leafIndex: leafIndex,
          treeDepth: treeDepth
        };
      }
    }

    var current = leafHash;
    for (var i = 0; i < siblings.length; i++) {
      var sib = siblings[i];
      if (!sib || !sib.hash || !HEX_64_REGEX.test(sib.hash)) {
        return {
          valid: false,
          reason: 'INVALID_SIBLING',
          message: 'Sibling at index ' + i + ' has invalid hash format',
          computedRoot: null,
          expectedRoot: targetRoot,
          leafIndex: leafIndex,
          treeDepth: treeDepth
        };
      }

      var sibHash = cleanHex(sib.hash);
      if (sib.position === 'left') {
        current = hashPair(sibHash, current, version);
      } else if (sib.position === 'right') {
        current = hashPair(current, sibHash, version);
      } else {
        return {
          valid: false,
          reason: 'INVALID_SIBLING',
          message: 'Sibling at index ' + i + ' has invalid position: ' + sib.position,
          computedRoot: null,
          expectedRoot: targetRoot,
          leafIndex: leafIndex,
          treeDepth: treeDepth
        };
      }
    }

    var isValid = current.toLowerCase() === targetRoot.toLowerCase();
    return {
      valid: isValid,
      reason: isValid ? null : 'ROOT_MISMATCH',
      message: isValid ? 'Merkle proof verified successfully' : 'Computed root ' + current + ' does not match expected root ' + targetRoot,
      computedRoot: current,
      expectedRoot: targetRoot,
      leafIndex: leafIndex,
      treeDepth: treeDepth
    };
  }

  return {
    sha256: sha256Sync,
    cleanHex: cleanHex,
    verify: verify
  };
}));

