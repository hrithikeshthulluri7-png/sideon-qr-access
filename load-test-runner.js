/**
 * Load Test Runner - Phase 3 Performance Validation
 *
 * A comprehensive Node.js-based load testing tool for QR Access Backend
 * Uses http module for lightweight testing without external dependencies
 *
 * Scenarios:
 * 1. Happy Path: 100 concurrent users for 5 minutes (70% verify, 20% check-in, 10% generate QR)
 * 2. Stress Test: Spike to 500 concurrent users for 1 minute
 * 3. Endurance Test: 50 concurrent users for 15 minutes (memory leak detection)
 */

const http = require('http');
const https = require('https');
const { performance } = require('perf_hooks');
const fs = require('fs');
const path = require('path');

// ============================================================================
// CONFIGURATION
// ============================================================================

const BASE_URL = process.env.BASE_URL || 'http://localhost:3001';
const SCENARIO = process.env.SCENARIO || 'happy-path'; // happy-path, stress, endurance
const OUTPUT_DIR = path.join(__dirname, 'load-test-results');

// Ensure output directory exists
if (!fs.existsSync(OUTPUT_DIR)) {
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
}

// ============================================================================
// METRICS COLLECTOR
// ============================================================================

class MetricsCollector {
  constructor() {
    this.responseTimes = {
      generate_qr: [],
      verify_token: [],
      check_in: [],
      check_in_status: [],
      health_check: []
    };
    this.errors = {
      generate_qr: 0,
      verify_token: 0,
      check_in: 0,
      check_in_status: 0,
      health_check: 0
    };
    this.statusCodes = {};
    this.rateLimitHits = 0;
    this.totalRequests = 0;
    this.startTime = Date.now();
    this.memorySnapshots = [];
    this.cpuSnapshots = [];
  }

  recordRequest(endpoint, duration, statusCode, isError = false) {
    this.totalRequests++;
    this.responseTimes[endpoint].push(duration);

    // Track status codes
    this.statusCodes[statusCode] = (this.statusCodes[statusCode] || 0) + 1;

    // Track rate limit hits
    if (statusCode === 429) {
      this.rateLimitHits++;
    }

    if (isError) {
      this.errors[endpoint]++;
    }
  }

  recordMemory() {
    const mem = process.memoryUsage();
    this.memorySnapshots.push({
      timestamp: Date.now(),
      heapUsed: Math.round(mem.heapUsed / 1024 / 1024), // MB
      heapTotal: Math.round(mem.heapTotal / 1024 / 1024),
      external: Math.round(mem.external / 1024 / 1024),
      rss: Math.round(mem.rss / 1024 / 1024)
    });
  }

  calculateStats() {
    const stats = {};

    for (const [endpoint, times] of Object.entries(this.responseTimes)) {
      if (times.length === 0) {
        stats[endpoint] = { count: 0 };
        continue;
      }

      const sorted = [...times].sort((a, b) => a - b);
      const p50Index = Math.floor(sorted.length * 0.5);
      const p95Index = Math.floor(sorted.length * 0.95);
      const p99Index = Math.floor(sorted.length * 0.99);

      stats[endpoint] = {
        count: times.length,
        min: sorted[0],
        max: sorted[sorted.length - 1],
        avg: Math.round(times.reduce((a, b) => a + b, 0) / times.length),
        p50: sorted[p50Index],
        p95: sorted[p95Index],
        p99: sorted[p99Index],
        errors: this.errors[endpoint],
        errorRate: (this.errors[endpoint] / times.length * 100).toFixed(2) + '%'
      };
    }

    return stats;
  }

  getSummary() {
    const elapsedSeconds = (Date.now() - this.startTime) / 1000;
    const throughput = (this.totalRequests / elapsedSeconds).toFixed(2);
    const totalErrors = Object.values(this.errors).reduce((a, b) => a + b, 0);
    const errorRate = (totalErrors / this.totalRequests * 100).toFixed(2);

    return {
      duration: elapsedSeconds.toFixed(2) + ' seconds',
      totalRequests: this.totalRequests,
      throughput: throughput + ' req/sec',
      totalErrors,
      errorRate: errorRate + '%',
      rateLimitHits: this.rateLimitHits,
      statusCodes: this.statusCodes,
      endpointStats: this.calculateStats(),
      memory: this.memorySnapshots.length > 0 ? {
        initial: this.memorySnapshots[0],
        final: this.memorySnapshots[this.memorySnapshots.length - 1],
        snapshots: this.memorySnapshots
      } : null
    };
  }
}

// ============================================================================
// HTTP REQUEST HELPERS
// ============================================================================

function makeRequest(method, endpoint, body = null) {
  return new Promise((resolve) => {
    const url = new URL(endpoint, BASE_URL);
    const isHttps = url.protocol === 'https:';
    const client = isHttps ? https : http;

    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'LoadTestRunner/1.0'
      },
      timeout: 5000
    };

    const startTime = performance.now();
    let responseData = '';

    const req = client.request(options, (res) => {
      res.on('data', (chunk) => {
        responseData += chunk;
      });

      res.on('end', () => {
        const duration = performance.now() - startTime;
        resolve({
          statusCode: res.statusCode,
          duration: Math.round(duration),
          body: responseData,
          headers: res.headers
        });
      });
    });

    req.on('error', () => {
      const duration = performance.now() - startTime;
      resolve({
        statusCode: 0,
        duration: Math.round(duration),
        body: '',
        error: true
      });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({
        statusCode: 0,
        duration: performance.now() - startTime,
        body: '',
        error: true,
        timeout: true
      });
    });

    if (body) {
      req.write(JSON.stringify(body));
    }

    req.end();
  });
}

// ============================================================================
// TEST DATA GENERATORS
// ============================================================================

function generateMemberId() {
  return `member-${Date.now()}-${Math.random().toString(36).substring(7)}`;
}

function generateToken() {
  return Array.from({ length: 32 }, () =>
    'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[
      Math.floor(Math.random() * 62)
    ]
  ).join('');
}

// ============================================================================
// TEST FUNCTIONS
// ============================================================================

async function testGenerateQR(metrics) {
  const memberId = generateMemberId();
  const payload = {
    member_id: memberId,
    name: `User ${memberId}`,
    email: `user-${memberId}@example.com`,
    mobile: '+1234567890',
    agent: 'LoadTestAgent'
  };

  const response = await makeRequest('POST', '/api/generate-qr', payload);
  const isError = response.statusCode !== 200 && response.statusCode !== 201;

  metrics.recordRequest('generate_qr', response.duration, response.statusCode, isError);

  try {
    const data = JSON.parse(response.body);
    return data.token || null;
  } catch {
    return null;
  }
}

async function testVerifyToken(token, metrics) {
  if (!token) return false;

  const response = await makeRequest('GET', `/api/verify?token=${token}`);
  const isError = response.statusCode !== 200;

  metrics.recordRequest('verify_token', response.duration, response.statusCode, isError);

  return response.statusCode === 200;
}

async function testCheckIn(token, metrics) {
  if (!token) return false;

  const payload = { token };
  const response = await makeRequest('POST', '/api/check-in', payload);
  const isError = response.statusCode !== 200 && response.statusCode !== 201;

  metrics.recordRequest('check_in', response.duration, response.statusCode, isError);

  return response.statusCode === 200 || response.statusCode === 201;
}

async function testCheckInStatus(token, metrics) {
  if (!token) return false;

  const response = await makeRequest('GET', `/api/check-in-status?token=${token}`);
  const isError = response.statusCode !== 200;

  metrics.recordRequest('check_in_status', response.duration, response.statusCode, isError);

  return response.statusCode === 200;
}

async function testHealthCheck(metrics) {
  const response = await makeRequest('GET', '/health');
  const isError = response.statusCode !== 200;

  metrics.recordRequest('health_check', response.duration, response.statusCode, isError);

  return response.statusCode === 200;
}

// ============================================================================
// VIRTUAL USER SIMULATION
// ============================================================================

class VirtualUser {
  constructor(userId, distribution, metrics) {
    this.userId = userId;
    this.distribution = distribution;
    this.metrics = metrics;
    this.isActive = false;
  }

  async run() {
    this.isActive = true;

    while (this.isActive) {
      const random = Math.random();
      let token = null;

      if (random < this.distribution[0]) {
        // Generate QR
        token = await testGenerateQR(this.metrics);
      } else if (random < this.distribution[0] + this.distribution[1]) {
        // Verify Token
        token = generateToken();
        await testVerifyToken(token, this.metrics);
      } else if (random < this.distribution[0] + this.distribution[1] + this.distribution[2]) {
        // Check-In
        token = generateToken();
        await testCheckIn(token, this.metrics);
      } else if (random < this.distribution[0] + this.distribution[1] + this.distribution[2] + this.distribution[3]) {
        // Check-In Status
        token = generateToken();
        await testCheckInStatus(token, this.metrics);
      }

      // Health check occasionally
      if (Math.random() < 0.02) {
        await testHealthCheck(this.metrics);
      }

      // Think time
      await this.sleep(Math.random() * 500);
    }
  }

  stop() {
    this.isActive = false;
  }

  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// ============================================================================
// SCENARIO RUNNERS
// ============================================================================

async function runHappyPathScenario() {
  console.log('\n--- Happy Path Scenario ---');
  console.log('Configuration: 100 concurrent users for 5 minutes');
  console.log('Distribution: 70% verify, 20% check-in, 10% generate QR\n');

  const metrics = new MetricsCollector();
  const users = [];
  const distribution = [0.1, 0.7, 0.2, 0, 0]; // generate, verify, check-in, status, other

  // Ramp up phase: 0-1 minute (0 to 50 VUs)
  console.log('[Phase 1/3] Ramping up: 0-50 VUs over 1 minute...');
  for (let i = 0; i < 50; i++) {
    const user = new VirtualUser(i, distribution, metrics);
    users.push(user);
    user.run().catch(console.error);
    await new Promise(resolve => setTimeout(resolve, 20)); // 50 users in 1 minute
  }

  // Ramp up phase: 1-4 minutes (50 to 100 VUs)
  console.log('[Phase 2/3] Ramping up: 50-100 VUs over 3 minutes...');
  for (let i = 50; i < 100; i++) {
    const user = new VirtualUser(i, distribution, metrics);
    users.push(user);
    user.run().catch(console.error);
    await new Promise(resolve => setTimeout(resolve, 1800)); // 50 users in 3 minutes
  }

  // Steady state: 4-9 minutes (100 VUs for 5 minutes)
  console.log('[Phase 3/3] Steady state: 100 VUs for 5 minutes...');
  await new Promise(resolve => setTimeout(resolve, 5 * 60 * 1000)); // 5 minutes

  // Record memory usage
  metrics.recordMemory();

  // Ramp down
  console.log('[Phase 4/4] Ramping down...');
  users.forEach(user => user.stop());
  await new Promise(resolve => setTimeout(resolve, 1000));

  return metrics;
}

async function runStressScenario() {
  console.log('\n--- Stress Test Scenario ---');
  console.log('Configuration: Spike to 500 concurrent users for 1 minute');
  console.log('Distribution: 40% verify, 40% check-in, 20% generate QR\n');

  const metrics = new MetricsCollector();
  const users = [];
  const distribution = [0.2, 0.4, 0.4, 0, 0]; // generate, verify, check-in, status, other

  // Ramp up phase: 0-30 seconds (0 to 100 VUs)
  console.log('[Phase 1/3] Ramping up: 0-100 VUs over 30 seconds...');
  for (let i = 0; i < 100; i++) {
    const user = new VirtualUser(i, distribution, metrics);
    users.push(user);
    user.run().catch(console.error);
    await new Promise(resolve => setTimeout(resolve, 10)); // 100 users in 30 seconds (3000ms / 100 = 30ms per user)
  }

  // Spike phase: 30-90 seconds (100 to 500 VUs)
  console.log('[Phase 2/3] Spiking: 100-500 VUs over 60 seconds...');
  for (let i = 100; i < 500; i++) {
    const user = new VirtualUser(i, distribution, metrics);
    users.push(user);
    user.run().catch(console.error);

    // Add 8 users per second over 60 seconds
    await new Promise(resolve => setTimeout(resolve, 125)); // 500-100=400 users, 125ms per user = ~60 seconds
  }

  // Steady state: 90-150 seconds (500 VUs for 1 minute)
  console.log('[Phase 3/3] Spike sustained: 500 VUs for 1 minute...');
  await new Promise(resolve => setTimeout(resolve, 60 * 1000)); // 1 minute

  // Record memory usage
  metrics.recordMemory();

  // Ramp down
  console.log('[Phase 4/4] Ramping down...');
  users.forEach(user => user.stop());
  await new Promise(resolve => setTimeout(resolve, 1000));

  return metrics;
}

async function runEnduranceScenario() {
  console.log('\n--- Endurance Test Scenario ---');
  console.log('Configuration: 50 concurrent users for 15 minutes');
  console.log('Distribution: 15% generate, 50% verify, 30% check-in, 5% status\n');

  const metrics = new MetricsCollector();
  const users = [];
  const distribution = [0.15, 0.5, 0.3, 0.05, 0]; // generate, verify, check-in, status, other

  // Ramp up: 0-1 minute (0 to 50 VUs)
  console.log('[Phase 1/2] Ramping up: 0-50 VUs over 1 minute...');
  for (let i = 0; i < 50; i++) {
    const user = new VirtualUser(i, distribution, metrics);
    users.push(user);
    user.run().catch(console.error);
    await new Promise(resolve => setTimeout(resolve, 20)); // 50 users in 1 minute
  }

  // Steady state: 1-16 minutes (50 VUs for 15 minutes)
  console.log('[Phase 2/2] Steady state: 50 VUs for 15 minutes (memory leak detection)...');
  const startTime = Date.now();

  while (Date.now() - startTime < 15 * 60 * 1000) {
    // Record memory every 30 seconds
    metrics.recordMemory();
    await new Promise(resolve => setTimeout(resolve, 30 * 1000));
  }

  // Ramp down
  console.log('[Phase 3/2] Ramping down...');
  users.forEach(user => user.stop());
  await new Promise(resolve => setTimeout(resolve, 1000));

  return metrics;
}

// ============================================================================
// REPORT GENERATION
// ============================================================================

function generateReport(metrics, scenario) {
  const summary = metrics.getSummary();
  const timestamp = new Date().toISOString();
  const filename = `${scenario}-${Date.now()}.json`;
  const filepath = path.join(OUTPUT_DIR, filename);

  const report = {
    scenario,
    timestamp,
    configuration: {
      baseUrl: BASE_URL,
      scenario: SCENARIO
    },
    results: summary
  };

  // Write JSON report
  fs.writeFileSync(filepath, JSON.stringify(report, null, 2));
  console.log(`\nJSON Report saved: ${filepath}`);

  // Console output
  console.log('\n========================================');
  console.log('         LOAD TEST RESULTS');
  console.log('========================================\n');
  console.log(`Scenario: ${scenario}`);
  console.log(`Duration: ${summary.duration}`);
  console.log(`Total Requests: ${summary.totalRequests}`);
  console.log(`Throughput: ${summary.throughput}`);
  console.log(`Total Errors: ${summary.totalErrors}`);
  console.log(`Error Rate: ${summary.errorRate}`);
  console.log(`Rate Limit Hits (429): ${summary.rateLimitHits}`);
  console.log(`\nStatus Codes:`);
  Object.entries(summary.statusCodes).forEach(([code, count]) => {
    console.log(`  ${code}: ${count}`);
  });

  console.log('\n--- Endpoint Performance ---\n');
  Object.entries(summary.endpointStats).forEach(([endpoint, stats]) => {
    if (stats.count === 0) return;
    console.log(`${endpoint}:`);
    console.log(`  Count: ${stats.count}`);
    console.log(`  Min: ${stats.min}ms`);
    console.log(`  Avg: ${stats.avg}ms`);
    console.log(`  p50: ${stats.p50}ms`);
    console.log(`  p95: ${stats.p95}ms`);
    console.log(`  p99: ${stats.p99}ms`);
    console.log(`  Max: ${stats.max}ms`);
    console.log(`  Errors: ${stats.errors} (${stats.errorRate})`);
    console.log();
  });

  if (summary.memory) {
    console.log('--- Memory Usage ---\n');
    console.log('Initial:');
    console.log(`  Heap Used: ${summary.memory.initial.heapUsed}MB`);
    console.log(`  Heap Total: ${summary.memory.initial.heapTotal}MB`);
    console.log(`  RSS: ${summary.memory.initial.rss}MB`);
    console.log('\nFinal:');
    console.log(`  Heap Used: ${summary.memory.final.heapUsed}MB`);
    console.log(`  Heap Total: ${summary.memory.final.heapTotal}MB`);
    console.log(`  RSS: ${summary.memory.final.rss}MB`);
    console.log(`\nHeap Growth: ${summary.memory.final.heapUsed - summary.memory.initial.heapUsed}MB`);
    console.log();
  }

  console.log('========================================\n');

  return report;
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

async function main() {
  console.log('QR Access Backend - Load Test Runner');
  console.log(`Base URL: ${BASE_URL}`);
  console.log(`Scenario: ${SCENARIO}`);
  console.log(`Started: ${new Date().toISOString()}\n`);

  let metrics;

  try {
    switch (SCENARIO) {
      case 'happy-path':
        metrics = await runHappyPathScenario();
        break;
      case 'stress':
        metrics = await runStressScenario();
        break;
      case 'endurance':
        metrics = await runEnduranceScenario();
        break;
      default:
        console.error(`Unknown scenario: ${SCENARIO}`);
        process.exit(1);
    }

    generateReport(metrics, SCENARIO);

    // Success criteria validation
    const summary = metrics.getSummary();
    const stats = summary.endpointStats;

    console.log('--- Success Criteria Validation ---\n');

    let passed = 0;
    let failed = 0;

    // Check p95 response times
    Object.entries(stats).forEach(([endpoint, stat]) => {
      if (stat.count === 0) return;
      const p95Threshold = 2000;
      if (stat.p95 < p95Threshold) {
        console.log(`✓ ${endpoint} p95 (${stat.p95}ms) < ${p95Threshold}ms`);
        passed++;
      } else {
        console.log(`✗ ${endpoint} p95 (${stat.p95}ms) >= ${p95Threshold}ms`);
        failed++;
      }
    });

    // Check error rate
    const errorRateThreshold = 1;
    const actualErrorRate = parseFloat(summary.errorRate);
    if (actualErrorRate < errorRateThreshold) {
      console.log(`✓ Error rate (${summary.errorRate}) < ${errorRateThreshold}%`);
      passed++;
    } else {
      console.log(`✗ Error rate (${summary.errorRate}) >= ${errorRateThreshold}%`);
      failed++;
    }

    // Check throughput
    const throughputThreshold = 50;
    const actualThroughput = parseFloat(summary.throughput);
    if (actualThroughput > throughputThreshold) {
      console.log(`✓ Throughput (${actualThroughput} req/sec) > ${throughputThreshold} req/sec`);
      passed++;
    } else {
      console.log(`✗ Throughput (${actualThroughput} req/sec) <= ${throughputThreshold} req/sec`);
      failed++;
    }

    console.log(`\nPassed: ${passed}, Failed: ${failed}\n`);

    process.exit(failed > 0 ? 1 : 0);
  } catch (error) {
    console.error('Error during load test:', error);
    process.exit(1);
  }
}

main();
