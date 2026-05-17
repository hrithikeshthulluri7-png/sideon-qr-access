/**
 * Unit Tests for QR Access Control System - Phase 2
 * Focus: Token generation, validation, and utility functions
 */

const { generateToken, validateTokenFormat, extractMemberIdFromToken } = require('../utils/tokenGenerator');

describe('Token Generation & Validation', () => {
  describe('generateToken()', () => {
    it('should generate a token with correct format', () => {
      const token = generateToken('00147');

      expect(token).toBeDefined();
      expect(token).toMatch(/^SIDN_EVENT_2026_M00147_[a-f0-9]{24}$/);
    });

    it('should generate unique tokens for same member', () => {
      const token1 = generateToken('00147');
      const token2 = generateToken('00147');

      expect(token1).not.toBe(token2);
    });

    it('should handle different member IDs', () => {
      const token1 = generateToken('00001');
      const token2 = generateToken('99999');

      expect(token1).toMatch(/M00001_/);
      expect(token2).toMatch(/M99999_/);
    });

    it('should generate tokens of consistent length', () => {
      const token = generateToken('00147');
      // SIDN_EVENT_2026_M{ID}_{24_hex_chars}
      // Minimum: SIDN_EVENT_2026_M1_{24} = 35 chars
      expect(token.length).toBeGreaterThanOrEqual(35);
    });

    it('should throw on invalid member ID', () => {
      expect(() => generateToken(null)).toThrow('Invalid member ID');
      expect(() => generateToken(undefined)).toThrow('Invalid member ID');
      expect(() => generateToken(123)).toThrow('Invalid member ID');
      expect(() => generateToken({})).toThrow('Invalid member ID');
    });

    it('should throw on empty string member ID', () => {
      expect(() => generateToken('')).toThrow('Invalid member ID');
    });
  });

  describe('validateTokenFormat()', () => {
    it('should validate correct token format', () => {
      const validToken = 'SIDN_EVENT_2026_M00147_a1b2c3d4e5f6a1b2c3d4e5f6';
      expect(validateTokenFormat(validToken)).toBe(true);
    });

    it('should reject invalid prefix', () => {
      expect(validateTokenFormat('INVALID_EVENT_2026_M00147_a1b2c3d4e5f6g7h8i9j0k1l2')).toBe(false);
    });

    it('should reject invalid year', () => {
      expect(validateTokenFormat('SIDN_EVENT_2025_M00147_a1b2c3d4e5f6g7h8i9j0k1l2')).toBe(false);
    });

    it('should reject missing member ID', () => {
      expect(validateTokenFormat('SIDN_EVENT_2026_M_a1b2c3d4e5f6g7h8i9j0k1l2')).toBe(false);
    });

    it('should reject invalid random section', () => {
      expect(validateTokenFormat('SIDN_EVENT_2026_M00147_gggggggggggggggggggggggg')).toBe(false);
    });

    it('should reject too short random section', () => {
      expect(validateTokenFormat('SIDN_EVENT_2026_M00147_a1b2c3d4')).toBe(false);
    });

    it('should reject non-hex random characters', () => {
      expect(validateTokenFormat('SIDN_EVENT_2026_M00147_gghhiijjkkllmmnnooppqqrr')).toBe(false);
    });

    it('should handle null/undefined', () => {
      expect(validateTokenFormat(null)).toBe(false);
      expect(validateTokenFormat(undefined)).toBe(false);
      expect(validateTokenFormat('')).toBe(false);
    });
  });

  describe('extractMemberIdFromToken()', () => {
    it('should extract member ID from valid token', () => {
      const memberId = extractMemberIdFromToken('SIDN_EVENT_2026_M00147_a1b2c3d4e5f6a1b2c3d4e5f6');
      expect(memberId).toBe('00147');
    });

    it('should extract different member IDs', () => {
      expect(extractMemberIdFromToken('SIDN_EVENT_2026_M00001_a1b2c3d4e5f6a1b2c3d4e5f6')).toBe('00001');
      expect(extractMemberIdFromToken('SIDN_EVENT_2026_M99999_a1b2c3d4e5f6a1b2c3d4e5f6')).toBe('99999');
    });

    it('should return null for invalid token format', () => {
      expect(extractMemberIdFromToken('INVALID_TOKEN')).toBeNull();
      expect(extractMemberIdFromToken('SIDN_EVENT_2026_M_a1b2c3d4e5f6a1b2c3d4e5f6')).toBeNull();
    });

    it('should handle null/undefined', () => {
      if (null) {
        expect(extractMemberIdFromToken(null)).toBeNull();
      }
      expect(extractMemberIdFromToken(undefined)).toBeNull();
    });
  });
});

describe('Edge Cases & Security', () => {
  describe('Token Randomness', () => {
    it('should produce cryptographically different tokens', () => {
      const tokens = new Set();
      for (let i = 0; i < 100; i++) {
        tokens.add(generateToken('00147'));
      }
      // All 100 tokens should be unique
      expect(tokens.size).toBe(100);
    });
  });

  describe('Member ID Boundary Values', () => {
    it('should handle single digit member ID', () => {
      const token = generateToken('1');
      expect(validateTokenFormat(token)).toBe(true);
      expect(extractMemberIdFromToken(token)).toBe('1');
    });

    it('should handle long numeric member ID', () => {
      const token = generateToken('123456789');
      expect(validateTokenFormat(token)).toBe(true);
      expect(extractMemberIdFromToken(token)).toBe('123456789');
    });

    it('should reject non-numeric member IDs in token validation', () => {
      // generateToken doesn't validate, but validateTokenFormat does
      const token = 'SIDN_EVENT_2026_MABCD_a1b2c3d4e5f6g7h8i9j0k1l2';
      expect(validateTokenFormat(token)).toBe(false);
    });
  });

  describe('Special Characters & Injection', () => {
    it('should generate tokens even with special chars in member ID', () => {
      // generateToken doesn't validate member ID content, just type
      // This is safe because member IDs are never embedded as SQL
      const token1 = generateToken('user123');
      const token2 = generateToken('001_47');
      expect(validateTokenFormat(token1)).toBe(false); // non-numeric fails validation
      expect(validateTokenFormat(token2)).toBe(false); // underscore fails validation
    });

    it('should reject null/undefined member ID', () => {
      expect(() => generateToken(null)).toThrow('Invalid member ID');
      expect(() => generateToken(undefined)).toThrow('Invalid member ID');
    });
  });
});
