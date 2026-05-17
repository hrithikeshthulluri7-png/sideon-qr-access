/**
 * SIDEON QR System - Phase 1 Integration Test Harness
 *
 * This harness validates the full token lifecycle:
 * 1. Server startup
 * 2. Health endpoint
 * 3. Token generation (100 samples)
 * 4. Token verification
 * 5. Duplicate detection
 *
 * Usage: node Integration-Test-Harness.js
 */

const http = require('http');
const path = require('path');

// Test configuration
const BASE_URL = 'http://localhost:3001';
const TEST_TIMEOUT = 10000;
const TOKENS_TO_GENERATE = 100;

// Colors for output
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m',
};

class IntegrationTester {
  constructor() {
    this.passed = 0;
    this.failed = 0;
    this.generatedTokens = [];
    this.results = [];
  }

  log(message, level = 'info') {
    const timestamp = new Date().toISOString();
    const color = {
      pass: colors.green,
      fail: colors.red,
      info: colors.blue,
      warn: colors.yellow,
    }[level] || colors.reset;

    console.log(`${color}[${timestamp}] ${message}${colors.reset}`);
  }

  async makeRequest(method, path, body = null) {
    return new Promise((resolve, reject) => {
      const url = new URL(path, BASE_URL);
      const options = {
        hostname: url.hostname,
        port: url.port,
        path: url.pathname + url.search,
        method: method,
        headers: {
          'Content-Type': 'application/json',
        },
        timeout: TEST_TIMEOUT,
      };

      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          try {
            const jsonData = JSON.parse(data);
            resolve({ status: res.statusCode, body: jsonData, headers: res.headers });
          } catch {
            resolve({ status: res.statusCode, body: data, headers: res.headers });
          }
        });
      });

      req.on('error', reject);
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      if (body) {
        req.write(JSON.stringify(body));
      }
      req.end();
    });
  }

  // TEST 1: Health Check
  async testHealthCheck() {
    this.log('TEST 1: Health Check', 'info');
    try {
      const response = await this.makeRequest('GET', '/health');
      if (response.status === 200 && response.body.status === 'OK') {
        this.log('✓ Health check passed', 'pass');
        this.passed++;
        this.results.push({
          test: 'Health Check',
          status: 'PASS',
          details: `Status: ${response.body.status}, Timestamp: ${response.body.timestamp}`,
        });
        return true;
      } else {
        throw new Error(`Unexpected status: ${response.status}`);
      }
    } catch (error) {
      this.log(`✗ Health check failed: ${error.message}`, 'fail');
      this.failed++;
      this.results.push({
        test: 'Health Check',
        status: 'FAIL',
        details: error.message,
      });
      return false;
    }
  }

  // TEST 2: Token Generation
  async testTokenGeneration() {
    this.log(`TEST 2: Token Generation (${TOKENS_TO_GENERATE} samples)`, 'info');
    try {
      for (let i = 0; i < TOKENS_TO_GENERATE; i++) {
        const memberId = `member-${i}`;
        const memberName = `Test Member ${i}`;

        const response = await this.makeRequest('POST', '/api/tokens/generate', {
          memberId,
          memberName,
        });

        if (response.status === 201 && response.body.token) {
          this.generatedTokens.push({
            token: response.body.token,
            memberId,
            createdAt: response.body.createdAt,
          });

          if (i % 20 === 0) {
            this.log(`  Generated ${i + 1}/${TOKENS_TO_GENERATE} tokens`, 'info');
          }
        } else {
          throw new Error(
            `Token generation failed for ${memberId}: ${response.status} ${JSON.stringify(response.body)}`
          );
        }
      }

      this.log(`✓ Generated ${this.generatedTokens.length} tokens successfully`, 'pass');
      this.passed++;
      this.results.push({
        test: 'Token Generation',
        status: 'PASS',
        details: `Generated ${this.generatedTokens.length} tokens without errors`,
      });
      return true;
    } catch (error) {
      this.log(`✗ Token generation failed: ${error.message}`, 'fail');
      this.failed++;
      this.results.push({
        test: 'Token Generation',
        status: 'FAIL',
        details: error.message,
      });
      return false;
    }
  }

  // TEST 3: Token Verification
  async testTokenVerification() {
    this.log('TEST 3: Token Verification', 'info');
    if (this.generatedTokens.length === 0) {
      this.log('✗ No tokens to verify (generation failed)', 'fail');
      this.failed++;
      this.results.push({
        test: 'Token Verification',
        status: 'SKIP',
        details: 'No tokens generated',
      });
      return false;
    }

    try {
      let successCount = 0;
      for (const tokenData of this.generatedTokens.slice(0, 10)) {
        const response = await this.makeRequest('GET', `/api/tokens/verify/${tokenData.token}`);

        if (response.status === 200 && response.body.memberId === tokenData.memberId) {
          successCount++;
        } else {
          throw new Error(
            `Verification failed for token ${tokenData.token}: ${response.status} ${JSON.stringify(response.body)}`
          );
        }
      }

      this.log(`✓ Verified ${successCount}/10 tokens (sample validation)`, 'pass');
      this.passed++;
      this.results.push({
        test: 'Token Verification',
        status: 'PASS',
        details: `Verified ${successCount}/10 tokens successfully`,
      });
      return true;
    } catch (error) {
      this.log(`✗ Token verification failed: ${error.message}`, 'fail');
      this.failed++;
      this.results.push({
        test: 'Token Verification',
        status: 'FAIL',
        details: error.message,
      });
      return false;
    }
  }

  // TEST 4: Duplicate Detection
  testDuplicateDetection() {
    this.log('TEST 4: Duplicate Detection', 'info');
    if (this.generatedTokens.length === 0) {
      this.log('✗ No tokens to check for duplicates', 'fail');
      this.failed++;
      this.results.push({
        test: 'Duplicate Detection',
        status: 'SKIP',
        details: 'No tokens generated',
      });
      return false;
    }

    try {
      const tokenSet = new Set(this.generatedTokens.map((t) => t.token));
      const duplicateCount = this.generatedTokens.length - tokenSet.size;

      if (duplicateCount === 0) {
        this.log(`✓ All ${this.generatedTokens.length} tokens are unique`, 'pass');
        this.passed++;
        this.results.push({
          test: 'Duplicate Detection',
          status: 'PASS',
          details: `Generated ${this.generatedTokens.length} unique tokens (0 duplicates)`,
        });
        return true;
      } else {
        throw new Error(`Found ${duplicateCount} duplicate tokens`);
      }
    } catch (error) {
      this.log(`✗ Duplicate detection failed: ${error.message}`, 'fail');
      this.failed++;
      this.results.push({
        test: 'Duplicate Detection',
        status: 'FAIL',
        details: error.message,
      });
      return false;
    }
  }

  // TEST 5: Error Handling
  async testErrorHandling() {
    this.log('TEST 5: Error Handling (Invalid Token)', 'info');
    try {
      const response = await this.makeRequest('GET', '/api/tokens/verify/invalid-token-xyz');

      if (response.status === 404) {
        this.log(`✓ Invalid token returns 404 correctly`, 'pass');
        this.passed++;
        this.results.push({
          test: 'Error Handling',
          status: 'PASS',
          details: 'Invalid token correctly returns 404',
        });
        return true;
      } else {
        throw new Error(`Expected 404, got ${response.status}`);
      }
    } catch (error) {
      this.log(`✗ Error handling test failed: ${error.message}`, 'fail');
      this.failed++;
      this.results.push({
        test: 'Error Handling',
        status: 'FAIL',
        details: error.message,
      });
      return false;
    }
  }

  // Run all tests
  async runTests() {
    this.log('═════════════════════════════════════════════════════════', 'info');
    this.log('SIDEON QR System - Phase 1 Integration Test Suite', 'info');
    this.log('═════════════════════════════════════════════════════════', 'info');
    this.log('');

    // Check if server is running
    try {
      await this.makeRequest('GET', '/health');
    } catch (error) {
      this.log(
        `✗ FATAL: Cannot connect to server at ${BASE_URL}. Is the server running?`,
        'fail'
      );
      this.log(`  Start server with: cd qr-access-backend && npm start`, 'warn');
      process.exit(1);
    }

    // Run tests sequentially
    await this.testHealthCheck();
    this.log('');

    await this.testTokenGeneration();
    this.log('');

    await this.testTokenVerification();
    this.log('');

    this.testDuplicateDetection();
    this.log('');

    await this.testErrorHandling();
    this.log('');

    // Print summary
    this.printSummary();
  }

  printSummary() {
    this.log('═════════════════════════════════════════════════════════', 'info');
    this.log('TEST SUMMARY', 'info');
    this.log('═════════════════════════════════════════════════════════', 'info');

    const total = this.passed + this.failed;
    const passPercentage = total > 0 ? Math.round((this.passed / total) * 100) : 0;

    this.log(`Tests Passed: ${this.passed}/${total} (${passPercentage}%)`, 'info');
    this.log('');

    this.results.forEach((result) => {
      const statusColor =
        result.status === 'PASS' ? colors.green : result.status === 'FAIL' ? colors.red : colors.yellow;
      console.log(
        `${statusColor}${result.status}${colors.reset} | ${result.test}`
      );
      if (result.details) {
        console.log(`       ${result.details}`);
      }
    });

    this.log('');
    if (this.failed === 0) {
      this.log(
        `✓ All tests passed! Backend is ready for Phase 2.`,
        'pass'
      );
      process.exit(0);
    } else {
      this.log(
        `✗ ${this.failed} test(s) failed. See details above.`,
        'fail'
      );
      process.exit(1);
    }
  }
}

// Main execution
const tester = new IntegrationTester();
tester.runTests().catch((error) => {
  tester.log(`Fatal error: ${error.message}`, 'fail');
  process.exit(1);
});
