const { signJWT, verifyJWT, decodeJWT, isJWTExpired } = require('../utils/jwtService');
const jwt = require('jsonwebtoken');

describe('Phase 3: JWT Authentication', () => {
  describe('signJWT', () => {
    it('should sign a JWT token with member_id and token_id', () => {
      const token = signJWT('M00147', 'token-123-uuid');
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
    });

    it('should create a valid JWT with correct payload', () => {
      const token = signJWT('M00147', 'token-123-uuid');
      const decoded = jwt.decode(token);

      expect(decoded.member_id).toBe('M00147');
      expect(decoded.token_id).toBe('token-123-uuid');
      expect(decoded.iss).toBe('sideon-qr-access');
      expect(decoded.iat).toBeDefined();
      expect(decoded.exp).toBeDefined();
    });

    it('should set expiration time', () => {
      const token = signJWT('M00147', 'token-123-uuid');
      const decoded = jwt.decode(token);
      const expiresIn = decoded.exp - decoded.iat;

      // Default 1 hour = 3600 seconds (allow 5-second variance)
      expect(expiresIn).toBeGreaterThan(3595);
      expect(expiresIn).toBeLessThan(3605);
    });

    it('should throw error on invalid member_id', () => {
      expect(() => {
        signJWT(null, 'token-123-uuid');
      }).toThrow();
    });
  });

  describe('verifyJWT', () => {
    it('should verify a valid JWT token', () => {
      const token = signJWT('M00147', 'token-123-uuid');
      const decoded = verifyJWT(token);

      expect(decoded.member_id).toBe('M00147');
      expect(decoded.token_id).toBe('token-123-uuid');
      expect(decoded.iss).toBe('sideon-qr-access');
    });

    it('should throw error on invalid JWT', () => {
      expect(() => {
        verifyJWT('invalid.jwt.token');
      }).toThrow('Invalid or expired JWT token');
    });

    it('should throw error on tampered JWT', () => {
      const token = signJWT('M00147', 'token-123-uuid');
      const tampered = token.split('.')[0] + '.invalid.' + token.split('.')[2];

      expect(() => {
        verifyJWT(tampered);
      }).toThrow();
    });

    it('should throw error on modified payload', () => {
      const token = signJWT('M00147', 'token-123-uuid');
      const parts = token.split('.');
      const decoded = jwt.decode(token);
      decoded.member_id = 'M00999'; // Modify payload

      const buffer = Buffer.from(JSON.stringify(decoded));
      const modified = parts[0] + '.' + buffer.toString('base64') + '.' + parts[2];

      expect(() => {
        verifyJWT(modified);
      }).toThrow();
    });
  });

  describe('decodeJWT', () => {
    it('should decode JWT without verification', () => {
      const token = signJWT('M00147', 'token-123-uuid');
      const decoded = decodeJWT(token);

      expect(decoded.member_id).toBe('M00147');
      expect(decoded.token_id).toBe('token-123-uuid');
    });

    it('should return null for invalid token', () => {
      const result = decodeJWT('invalid.token');
      expect(result).toBeNull();
    });
  });

  describe('isJWTExpired', () => {
    it('should return false for valid token', () => {
      const token = signJWT('M00147', 'token-123-uuid');
      const decoded = jwt.decode(token);

      expect(isJWTExpired(decoded)).toBe(false);
    });

    it('should return true for expired token', () => {
      const expiredPayload = {
        exp: Math.floor(Date.now() / 1000) - 3600 // 1 hour ago
      };

      expect(isJWTExpired(expiredPayload)).toBe(true);
    });

    it('should return true for missing exp claim', () => {
      const invalidPayload = { member_id: 'M00147' };
      expect(isJWTExpired(invalidPayload)).toBe(true);
    });

    it('should return true for null payload', () => {
      expect(isJWTExpired(null)).toBe(true);
    });
  });

  describe('JWT Integration', () => {
    it('should complete sign-verify cycle', () => {
      const originalMemberId = 'M00147';
      const originalTokenId = 'uuid-token-123';

      // Sign
      const token = signJWT(originalMemberId, originalTokenId);

      // Verify
      const decoded = verifyJWT(token);

      // Validate
      expect(decoded.member_id).toBe(originalMemberId);
      expect(decoded.token_id).toBe(originalTokenId);
      expect(decoded.iat).toBeDefined();
      expect(decoded.exp).toBeDefined();
      expect(decoded.iss).toBe('sideon-qr-access');
    });

    it('should maintain different tokens for different members', () => {
      const token1 = signJWT('M00001', 'token-1');
      const token2 = signJWT('M00002', 'token-2');

      expect(token1).not.toBe(token2);

      const decoded1 = verifyJWT(token1);
      const decoded2 = verifyJWT(token2);

      expect(decoded1.member_id).toBe('M00001');
      expect(decoded2.member_id).toBe('M00002');
    });

    it('should maintain payload integrity through sign-verify', () => {
      const testCases = [
        { member: 'M00147', token: 'uuid-1' },
        { member: 'M00999', token: 'uuid-2' },
        { member: 'ADMIN', token: 'admin-token' }
      ];

      testCases.forEach(({ member, token }) => {
        const signed = signJWT(member, token);
        const verified = verifyJWT(signed);

        expect(verified.member_id).toBe(member);
        expect(verified.token_id).toBe(token);
      });
    });
  });
});
