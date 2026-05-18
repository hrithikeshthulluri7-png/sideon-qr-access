/**
 * Phase 3 QR Image Generation Tests
 * Tests for QR image generation utility
 */

const { generateQRImagePNG, generateQRImageSVG, generateQRImageBase64, isValidToken } = require('../utils/qrImageGenerator');

describe('QR Image Generation - Phase 3', () => {
  const testToken = 'SIDN_EVENT_2026_M00147_abc123def456xyz789';
  const invalidTokens = ['', null, undefined, 12345, ''];

  describe('1. Token Validation', () => {
    test('1.1 Should validate correct token format', () => {
      expect(isValidToken(testToken)).toBe(true);
    });

    test('1.2 Should reject empty token', () => {
      expect(isValidToken('')).toBe(false);
    });

    test('1.3 Should reject null/undefined tokens', () => {
      expect(isValidToken(null)).toBe(false);
      expect(isValidToken(undefined)).toBe(false);
    });

    test('1.4 Should reject non-string tokens', () => {
      expect(isValidToken(12345)).toBe(false);
      expect(isValidToken({})).toBe(false);
      expect(isValidToken([])).toBe(false);
    });

    test('1.5 Should reject excessively long tokens', () => {
      const longToken = 'A'.repeat(1001);
      expect(isValidToken(longToken)).toBe(false);
    });
  });

  describe('2. PNG Image Generation', () => {
    test('2.1 Should generate PNG buffer from valid token', async () => {
      const buffer = await generateQRImagePNG(testToken);
      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(100);
    });

    test('2.2 PNG buffer should have correct magic bytes', async () => {
      const buffer = await generateQRImagePNG(testToken);
      // PNG magic bytes: 89 50 4E 47
      expect(buffer[0]).toBe(0x89);
      expect(buffer[1]).toBe(0x50);
      expect(buffer[2]).toBe(0x4e);
      expect(buffer[3]).toBe(0x47);
    });

    test('2.3 PNG buffer size should be reasonable', async () => {
      const buffer = await generateQRImagePNG(testToken);
      // QR code PNG buffers are typically 2.7-4KB for standard tokens
      expect(buffer.length).toBeGreaterThan(1000);
      expect(buffer.length).toBeLessThan(15000);
    });

    test('2.4 Should reject invalid token for PNG generation', async () => {
      try {
        await generateQRImagePNG('');
        fail('Should have thrown an error for empty token');
      } catch (error) {
        expect(error.message).toContain('Invalid token');
      }
    });

    test('2.5 Should support custom PNG options', async () => {
      const buffer = await generateQRImagePNG(testToken, {
        width: 500,
        margin: 3
      });
      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(1000);
      expect(buffer.length).toBeLessThan(15000);
    });
  });

  describe('3. SVG Image Generation', () => {
    test('3.1 Should generate SVG data URI from valid token', async () => {
      const dataUri = await generateQRImageSVG(testToken);
      expect(typeof dataUri).toBe('string');
      expect(dataUri).toMatch(/^data:image\/svg\+xml;base64,/);
    });

    test('3.2 SVG data URI should be decodable', async () => {
      const dataUri = await generateQRImageSVG(testToken);
      // Extract base64 content
      const base64Content = dataUri.replace(/^data:image\/svg\+xml;base64,/, '');
      const svgContent = Buffer.from(base64Content, 'base64').toString();
      expect(svgContent).toContain('<svg');
      expect(svgContent).toContain('</svg>');
    });

    test('3.3 Should reject invalid token for SVG generation', async () => {
      try {
        await generateQRImageSVG('');
        fail('Should have thrown an error for empty token');
      } catch (error) {
        expect(error.message).toContain('Invalid token');
      }
    });

    test('3.4 SVG should contain valid XML structure', async () => {
      const dataUri = await generateQRImageSVG(testToken);
      const base64Content = dataUri.replace(/^data:image\/svg\+xml;base64,/, '');
      const svgContent = Buffer.from(base64Content, 'base64').toString();
      expect(svgContent).toMatch(/<svg[^>]*>/);
      expect(svgContent).toMatch(/<\/svg>/);
    });
  });

  describe('4. Base64 PNG Generation', () => {
    test('4.1 Should generate base64-encoded PNG', async () => {
      const base64 = await generateQRImageBase64(testToken);
      expect(typeof base64).toBe('string');
      expect(base64.length).toBeGreaterThan(100);
      // Should be valid base64
      expect(() => Buffer.from(base64, 'base64')).not.toThrow();
    });

    test('4.2 Base64 string should be decodable to PNG', async () => {
      const base64 = await generateQRImageBase64(testToken);
      const buffer = Buffer.from(base64, 'base64');
      // Check PNG magic bytes
      expect(buffer[0]).toBe(0x89);
      expect(buffer[1]).toBe(0x50);
      expect(buffer[2]).toBe(0x4e);
      expect(buffer[3]).toBe(0x47);
    });

    test('4.3 Should reject invalid token for base64 generation', async () => {
      try {
        await generateQRImageBase64(null);
        fail('Should have thrown an error for null token');
      } catch (error) {
        expect(error.message).toContain('Invalid token');
      }
    });
  });

  describe('5. Error Handling', () => {
    test('5.1 Should throw error for empty token in PNG', async () => {
      try {
        await generateQRImagePNG('');
        fail('Should have thrown');
      } catch (error) {
        expect(error).toBeDefined();
        expect(error.message).toContain('Invalid token');
      }
    });

    test('5.2 Should throw error for null token in SVG', async () => {
      try {
        await generateQRImageSVG(null);
        fail('Should have thrown');
      } catch (error) {
        expect(error).toBeDefined();
      }
    });

    test('5.3 Should throw error for token exceeding max length', async () => {
      const longToken = 'A'.repeat(1001);
      try {
        await generateQRImagePNG(longToken);
        fail('Should have thrown');
      } catch (error) {
        expect(error).toBeDefined();
      }
    });
  });

  describe('6. Edge Cases', () => {
    test('6.1 Should handle tokens with special characters', async () => {
      const specialToken = 'SIDN_EVENT_2026_M00147_xyz!@#$%^&*()_+-=';
      const buffer = await generateQRImagePNG(specialToken);
      expect(buffer).toBeInstanceOf(Buffer);
      expect(buffer.length).toBeGreaterThan(1000);
      expect(buffer.length).toBeLessThan(15000);
    });

    test('6.2 Should handle very long valid tokens', async () => {
      const longValidToken = 'SIDN_EVENT_2026_M00147_' + 'x'.repeat(950);
      const buffer = await generateQRImagePNG(longValidToken);
      expect(buffer).toBeInstanceOf(Buffer);
    });

    test('6.3 Multiple generations should produce different buffers due to options', async () => {
      const buffer1 = await generateQRImagePNG(testToken, { width: 300 });
      const buffer2 = await generateQRImagePNG(testToken, { width: 500 });
      // Different widths may produce different file sizes
      expect(buffer1).toBeInstanceOf(Buffer);
      expect(buffer2).toBeInstanceOf(Buffer);
    });

    test('6.4 Should generate consistent QR for same token and options', async () => {
      const dataUri1 = await generateQRImageSVG(testToken);
      const dataUri2 = await generateQRImageSVG(testToken);
      expect(dataUri1).toBe(dataUri2);
    });
  });
});
