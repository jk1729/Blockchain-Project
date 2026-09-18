/**
 * Phase 17 Test Suite 6: Input Validation, Injection Hardening & Prototype Pollution
 */

const {
  sanitizeInput,
  validateSafePath,
  InputSecurityError
} = require('../src/security/inputValidation');

describe('Phase 17: Input Validation & Injection Hardening', () => {
  describe('1. Prototype Pollution Defense', () => {
    test('should strip __proto__ properties without polluting global Object prototype', () => {
      const maliciousPayload = JSON.parse('{"name":"test","__proto__":{"isAdmin":true}}');
      const clean = sanitizeInput(maliciousPayload);

      expect(clean.name).toBe('test');
      expect(clean.isAdmin).toBeUndefined();
      expect({}.isAdmin).toBeUndefined();
      expect(Object.prototype.isAdmin).toBeUndefined();
    });

    test('should strip constructor and prototype properties', () => {
      const payload = {
        normal: 'ok',
        constructor: { prototype: { evil: true } }
      };
      const clean = sanitizeInput(payload);

      expect(clean.normal).toBe('ok');
      expect(Object.prototype.hasOwnProperty.call(clean, 'constructor')).toBe(false);
      expect({}.evil).toBeUndefined();
    });
  });

  describe('2. Nesting Depth & ReDoS Abuse Guard', () => {
    test('should allow reasonable nested object depth (<= 10)', () => {
      let nested = { value: 'leaf' };
      for (let i = 0; i < 5; i++) {
        nested = { child: nested };
      }
      expect(() => sanitizeInput(nested)).not.toThrow();
    });

    test('should throw InputSecurityError when nesting depth exceeds 10', () => {
      let deeplyNested = { value: 'target' };
      for (let i = 0; i < 15; i++) {
        deeplyNested = { child: deeplyNested };
      }
      expect(() => sanitizeInput(deeplyNested)).toThrow(InputSecurityError);
    });
  });

  describe('3. Path Traversal & Filename Sanitization', () => {
    test('should allow safe alphanumeric relative filenames', () => {
      expect(validateSafePath('checkpoint_100.json')).toBe('checkpoint_100.json');
      expect(validateSafePath('keystore-val-01.json')).toBe('keystore-val-01.json');
    });

    test('should reject path traversal using ../', () => {
      expect(() => validateSafePath('../../etc/passwd')).toThrow(InputSecurityError);
      expect(() => validateSafePath('..\\windows\\system32')).toThrow(InputSecurityError);
    });

    test('should reject null bytes in paths', () => {
      expect(() => validateSafePath('safe.json\0malicious.sh')).toThrow(InputSecurityError);
    });

    test('should reject empty or whitespace path', () => {
      expect(() => validateSafePath('')).toThrow(InputSecurityError);
      expect(() => validateSafePath('   ')).toThrow(InputSecurityError);
    });
  });

  describe('4. String Bounds Protection', () => {
    test('should reject oversized strings exceeding 128KB limit', () => {
      const hugeString = 'A'.repeat(130 * 1024);
      expect(() => sanitizeInput({ data: hugeString })).toThrow(InputSecurityError);
    });
  });
});
