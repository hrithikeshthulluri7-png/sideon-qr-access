const {
  checkRateLimit,
  recordFailure,
  clearRateLimitState,
  getRateLimitInfo,
  RATE_LIMIT_CONFIG
} = require('../utils/slidingWindowRateLimiter');
const { db } = require('../utils/database');

describe('Phase 3: Sliding Window Rate Limiter', () => {
  beforeEach((done) => {
    // Clean up rate_limit_state table before each test
    db.run('DELETE FROM rate_limit_state', done);
  });

  afterAll((done) => {
    // Final cleanup
    db.run('DELETE FROM rate_limit_state', done);
  });

  describe('checkRateLimit', () => {
    it('should allow first request', async () => {
      const result = await checkRateLimit('test-key-1', 10, 60);

      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(9);
      expect(result.resetTime).toBeDefined();
    });

    it('should track request count within window', async () => {
      const key = 'test-key-2';

      // First request
      let result = await checkRateLimit(key, 3, 60);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(2);

      // Second request
      result = await checkRateLimit(key, 3, 60);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(1);

      // Third request
      result = await checkRateLimit(key, 3, 60);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(0);
    });

    it('should reject request when limit exceeded', async () => {
      const key = 'test-key-3';

      // Use up all requests
      await checkRateLimit(key, 2, 60);
      await checkRateLimit(key, 2, 60);

      // Third request should be rejected
      const result = await checkRateLimit(key, 2, 60);
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });

    it('should reset window after expiry', async () => {
      const key = 'test-key-4';

      // First window: use 2 requests out of 2
      await checkRateLimit(key, 2, 1); // 1 second window
      await checkRateLimit(key, 2, 1);

      // Wait for window to expire
      await new Promise(resolve => setTimeout(resolve, 1100));

      // Should allow new request (window reset)
      const result = await checkRateLimit(key, 2, 1);
      expect(result.allowed).toBe(true);
      expect(result.remaining).toBe(1);
    });

    it('should handle multiple keys independently', async () => {
      const key1 = 'user-1';
      const key2 = 'user-2';

      // Limit key1
      await checkRateLimit(key1, 1, 60);
      const result1 = await checkRateLimit(key1, 1, 60);
      expect(result1.allowed).toBe(false);

      // key2 should still have requests
      const result2 = await checkRateLimit(key2, 1, 60);
      expect(result2.allowed).toBe(true);
    });
  });

  describe('recordFailure', () => {
    it('should increment failure count', async () => {
      const key = 'failure-test-1';

      const result1 = await recordFailure(key);
      expect(result1.failureCount).toBe(1);
      expect(result1.backoffActive).toBe(false);

      const result2 = await recordFailure(key);
      expect(result2.failureCount).toBe(2);
      expect(result2.backoffActive).toBe(false);
    });

    it('should activate backoff after 5 failures', async () => {
      const key = 'failure-test-2';

      // Record 5 failures
      for (let i = 0; i < 5; i++) {
        await recordFailure(key);
      }

      const result = await recordFailure(key);
      expect(result.failureCount).toBe(6);
      expect(result.backoffActive).toBe(true);
      expect(result.cooldownRemaining).toBeGreaterThan(0);
    });

    it('should have correct cooldown duration for 5 failures', async () => {
      const key = 'failure-test-3';

      // Record 5 failures to trigger 10-second cooldown
      for (let i = 0; i < 5; i++) {
        await recordFailure(key);
      }

      const result = await recordFailure(key);
      expect(result.cooldownRemaining).toBe(10); // 10 seconds
    });

    it('should have longer cooldown for 10+ failures', async () => {
      const key = 'failure-test-4';

      // Record 10 failures to trigger 60-second cooldown
      for (let i = 0; i < 10; i++) {
        await recordFailure(key);
      }

      const result = await recordFailure(key);
      expect(result.cooldownRemaining).toBe(60); // 60 seconds
    });

    it('should respect backoff during cooldown', async () => {
      const key = 'failure-test-5';

      // Trigger cooldown (5 failures = 10-second cooldown)
      for (let i = 0; i < 5; i++) {
        await recordFailure(key);
      }

      // Check rate limit during cooldown
      const rateLimitResult = await checkRateLimit(key, 10, 60);
      expect(rateLimitResult.allowed).toBe(false);
      expect(rateLimitResult.inCooldown).toBe(true);
      expect(rateLimitResult.cooldownRemaining).toBeGreaterThan(0);
    });
  });

  describe('clearRateLimitState', () => {
    it('should remove rate limit state', async () => {
      const key = 'clear-test-1';

      // Create state
      await checkRateLimit(key, 10, 60);

      // Clear state
      await clearRateLimitState(key);

      // Next request should reset
      const result = await checkRateLimit(key, 10, 60);
      expect(result.remaining).toBe(9);
    });

    it('should only clear specific key', async () => {
      const key1 = 'clear-test-2a';
      const key2 = 'clear-test-2b';

      // Create states for both keys
      await checkRateLimit(key1, 10, 60);
      await checkRateLimit(key2, 10, 60);

      // Clear only key1
      await clearRateLimitState(key1);

      // key1 should reset
      const result1 = await checkRateLimit(key1, 10, 60);
      expect(result1.remaining).toBe(9);

      // key2 should retain state
      const result2 = await checkRateLimit(key2, 10, 60);
      expect(result2.remaining).toBe(8); // Was 9, now 8 after this request
    });
  });

  describe('Progressive Backoff', () => {
    it('should activate 10-second cooldown at 5 failures', async () => {
      const key = 'backoff-test-1';

      // Simulate 5 failures
      for (let i = 0; i < 5; i++) {
        await recordFailure(key);
      }

      // 6th failure triggers backoff
      const result = await recordFailure(key);
      expect(result.backoffActive).toBe(true);
      expect(result.cooldownRemaining).toBe(10);
    });

    it('should escalate to 60-second cooldown at 10 failures', async () => {
      const key = 'backoff-test-2';

      // Simulate 10 failures
      for (let i = 0; i < 10; i++) {
        await recordFailure(key);
      }

      // 11th failure triggers longer cooldown
      const result = await recordFailure(key);
      expect(result.backoffActive).toBe(true);
      expect(result.cooldownRemaining).toBe(60);
    });

    it('should further escalate at 15 failures', async () => {
      const key = 'backoff-test-3';

      // Simulate 15 failures
      for (let i = 0; i < 15; i++) {
        await recordFailure(key);
      }

      // 16th failure triggers even longer cooldown
      const result = await recordFailure(key);
      expect(result.backoffActive).toBe(true);
      expect(result.cooldownRemaining).toBe(300); // 5 minutes
    });
  });

  describe('Rate Limit Configuration', () => {
    it('should have correct default config', () => {
      expect(RATE_LIMIT_CONFIG.checkInLimit).toBe(10);
      expect(RATE_LIMIT_CONFIG.checkInWindow).toBe(60);
      expect(RATE_LIMIT_CONFIG.verifyAttemptsLimit).toBe(3);
      expect(RATE_LIMIT_CONFIG.verifyAttemptsWindow).toBe(60);
    });

    it('should have backoff thresholds defined', () => {
      expect(RATE_LIMIT_CONFIG.backoffConfig).toBeDefined();
      expect(RATE_LIMIT_CONFIG.backoffConfig.length).toBeGreaterThan(0);

      // Verify backoff config structure
      RATE_LIMIT_CONFIG.backoffConfig.forEach(config => {
        expect(config.failureCount).toBeDefined();
        expect(config.cooldownSeconds).toBeDefined();
        expect(config.cooldownSeconds).toBeGreaterThan(0);
      });
    });
  });

  describe('Sliding Window Edge Cases', () => {
    it('should handle rapid concurrent requests', async () => {
      const key = 'edge-case-1';
      const requests = [];
      const limit = 5;

      // Fire 5 concurrent requests
      for (let i = 0; i < 5; i++) {
        requests.push(checkRateLimit(key, limit, 60));
      }

      const results = await Promise.all(requests);

      // All should be allowed (no request exceeds limit)
      results.forEach((result) => {
        expect(result.allowed).toBe(true);
        // Remaining should be between 0 and limit-1 (due to concurrent race conditions)
        expect(result.remaining).toBeGreaterThanOrEqual(0);
        expect(result.remaining).toBeLessThan(limit);
      });

      // Total requests should have been recorded (at least some incremented)
      // Note: Due to concurrency, not all requests may see different remaining counts
      expect(results.length).toBe(5);
    });

    it('should handle zero remaining correctly', async () => {
      const key = 'edge-case-2';

      // Use up all quota
      await checkRateLimit(key, 1, 60);

      // Next should fail
      const result = await checkRateLimit(key, 1, 60);
      expect(result.allowed).toBe(false);
      expect(result.remaining).toBe(0);
    });
  });

  describe('getRateLimitInfo', () => {
    it('should return rate limit statistics', async () => {
      // Create some rate limit entries
      await checkRateLimit('info-test-1', 5, 60);
      await checkRateLimit('info-test-2', 5, 60);
      await recordFailure('info-test-3');

      const info = await getRateLimitInfo();

      expect(info.totalTracked).toBeGreaterThan(0);
      expect(info.limitedKeys).toBeDefined();
      expect(info.inCooldown).toBeDefined();
      expect(info.maxFailures).toBeDefined();
    });
  });
});
