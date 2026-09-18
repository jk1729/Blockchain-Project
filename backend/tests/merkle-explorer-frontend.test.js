/**
 * Merkle Explorer Frontend Integration Test Suite (Phase 16 - Stage L & Q)
 */

const fs = require('fs');
const path = require('path');
const BrowserVerifier = require('../../frontend/js/merkle-verifier');
const { MerkleTree } = require('../src/blockchain/merkle');

describe('Merkle Explorer Frontend & Visualizer Test Suite', () => {
  const htmlPath = path.resolve(__dirname, '../../frontend/html/explorer.html');
  const jsPath = path.resolve(__dirname, '../../frontend/js/explorer.js');
  const cssPath = path.resolve(__dirname, '../../frontend/css/explorer.css');
  const apiJsPath = path.resolve(__dirname, '../../frontend/js/explorer-api.js');

  let htmlContent;
  let jsContent;
  let cssContent;
  let apiJsContent;

  beforeAll(() => {
    htmlContent = fs.readFileSync(htmlPath, 'utf8');
    jsContent = fs.readFileSync(jsPath, 'utf8');
    cssContent = fs.readFileSync(cssPath, 'utf8');
    apiJsContent = fs.readFileSync(apiJsPath, 'utf8');
  });

  describe('1. Frontend Asset Integrations', () => {
    test('explorer.html must include script for merkle-verifier.js', () => {
      expect(htmlContent).toMatch(/<script src="\.\.\/js\/merkle-verifier\.js"><\/script>/);
    });

    test('explorer-api.js must provide proof methods', () => {
      expect(apiJsContent).toContain('getTransactionProof:');
      expect(apiJsContent).toContain('getReceiptProof:');
      expect(apiJsContent).toContain('getEventProof:');
      expect(apiJsContent).toContain('verifyProof:');
      expect(apiJsContent).toContain('getBlockTree:');
      expect(apiJsContent).toContain('getProofStatus:');
    });

    test('explorer.js must expose openProofModal, openBlockTreeModal, and switchMerkleView', () => {
      expect(jsContent).toContain('openProofModal: openProofModal');
      expect(jsContent).toContain('openBlockTreeModal: openBlockTreeModal');
      expect(jsContent).toContain('switchMerkleView: switchMerkleView');
      expect(jsContent).toContain('downloadProofJson: downloadProofJson');
    });

    test('explorer.css must define visualizer, node cards, and view toggles', () => {
      expect(cssContent).toContain('.merkle-tree-visualizer');
      expect(cssContent).toContain('.merkle-level-node');
      expect(cssContent).toContain('.proof-pill.valid');
      expect(cssContent).toContain('.proof-pill.invalid');
      expect(cssContent).toContain('.merkle-view-toggle');
    });
  });

  describe('2. Browser Verifier Execution with Malicious Payloads (XSS Defense)', () => {
    test('should prevent XSS payload execution in proof fields', () => {
      const xssPayload = '<script>alert("pwned")</script>';
      const leaves = [{ transactionId: 'TX-SAFE' }, { transactionId: 'TX-TARGET' }];
      const tree = new MerkleTree(leaves);
      const proof = tree.getProof(1).toJSON();

      // Ensure XSS payload in proof fields cannot bypass verification
      proof.transactionHash = xssPayload;
      proof.requestId = xssPayload;

      const result = BrowserVerifier.verify(proof);
      expect(result.valid).toBe(true);

      // Verify that explorer.js escapes inputs before rendering
      expect(jsContent).toContain('escapeHtml(proof.leafHash)');
      expect(jsContent).toContain('escapeHtml(proof.expectedRoot)');
      expect(jsContent).toContain('escapeHtml(proof.commitmentType)');
    });

    test('should reject invalid proof and flag status in browser verifier', () => {
      const leaves = [{ transactionId: 'TX-1' }, { transactionId: 'TX-2' }];
      const tree = new MerkleTree(leaves);
      const proof = tree.getProof(0).toJSON();
      proof.leafHash = '0'.repeat(64); // Tampered leaf

      const result = BrowserVerifier.verify(proof);
      expect(result.valid).toBe(false);
      expect(result.reason).toBe('ROOT_MISMATCH');
    });
  });
});

