#!/bin/bash

##############################################################################
# Load Test Orchestration Script - Phase 3
#
# This script orchestrates the complete load testing workflow:
# 1. Verify backend is running
# 2. Run three load test scenarios: happy path, stress, endurance
# 3. Collect performance metrics
# 4. Generate analysis report
#
# Usage:
#   ./run-load-tests.sh [happy-path|stress|endurance|all]
##############################################################################

set -e

# Configuration
BASE_URL="${BASE_URL:-http://localhost:3001}"
BACKEND_PORT="${PORT:-3001}"
SCENARIO="${1:-all}"
RESULTS_DIR="./load-test-results"
LOG_FILE="${RESULTS_DIR}/load-test-$(date +%s).log"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

##############################################################################
# UTILITY FUNCTIONS
##############################################################################

log_info() {
  echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
  echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warn() {
  echo -e "${YELLOW}[WARN]${NC} $1"
}

log_error() {
  echo -e "${RED}[ERROR]${NC} $1"
}

##############################################################################
# PREREQUISITE CHECKS
##############################################################################

check_backend() {
  log_info "Checking if backend is running on $BASE_URL..."

  if timeout 5 curl -s -f "$BASE_URL/health" > /dev/null 2>&1; then
    log_success "Backend is running and healthy"
    return 0
  else
    log_error "Backend is not responding at $BASE_URL"
    log_warn "Please start the backend with: npm start"
    return 1
  fi
}

check_dependencies() {
  log_info "Checking dependencies..."

  # Check Node.js
  if ! command -v node &> /dev/null; then
    log_error "Node.js is not installed"
    return 1
  fi
  log_success "Node.js found: $(node --version)"

  # Check curl
  if ! command -v curl &> /dev/null; then
    log_warn "curl not found (will proceed without health checks)"
  fi

  return 0
}

##############################################################################
# SETUP
##############################################################################

setup() {
  log_info "Setting up load test environment..."

  # Create results directory
  mkdir -p "$RESULTS_DIR"

  # Initialize log file
  echo "Load Test Started: $(date)" > "$LOG_FILE"
  echo "Base URL: $BASE_URL" >> "$LOG_FILE"
  echo "Scenario: $SCENARIO" >> "$LOG_FILE"
  echo "Node Version: $(node --version)" >> "$LOG_FILE"
  echo "---" >> "$LOG_FILE"

  log_success "Environment setup complete"
  log_info "Results will be saved to: $RESULTS_DIR"
  log_info "Log file: $LOG_FILE"
}

##############################################################################
# LOAD TEST RUNNERS
##############################################################################

run_happy_path() {
  log_info "Starting Happy Path Scenario..."
  log_info "Configuration: 100 concurrent users for 5 minutes"
  log_info "  - 70% Verify Token"
  log_info "  - 20% Check-In"
  log_info "  - 10% Generate QR"
  echo ""

  BASE_URL="$BASE_URL" SCENARIO="happy-path" timeout 600 node load-test-runner.js 2>&1 | tee -a "$LOG_FILE"
  local exit_code=$?

  if [ $exit_code -eq 0 ]; then
    log_success "Happy Path Scenario completed successfully"
  elif [ $exit_code -eq 124 ]; then
    log_warn "Happy Path Scenario timed out (as expected after 10 minutes)"
  else
    log_error "Happy Path Scenario failed with exit code $exit_code"
    return 1
  fi

  return 0
}

run_stress() {
  log_info "Starting Stress Test Scenario..."
  log_info "Configuration: Spike to 500 concurrent users for 1 minute"
  log_info "  - 40% Verify Token"
  log_info "  - 40% Check-In"
  log_info "  - 20% Generate QR"
  echo ""

  BASE_URL="$BASE_URL" SCENARIO="stress" timeout 300 node load-test-runner.js 2>&1 | tee -a "$LOG_FILE"
  local exit_code=$?

  if [ $exit_code -eq 0 ]; then
    log_success "Stress Test Scenario completed successfully"
  elif [ $exit_code -eq 124 ]; then
    log_warn "Stress Test Scenario timed out (as expected after 5 minutes)"
  else
    log_error "Stress Test Scenario failed with exit code $exit_code"
    return 1
  fi

  return 0
}

run_endurance() {
  log_info "Starting Endurance Test Scenario..."
  log_info "Configuration: 50 concurrent users for 15 minutes (memory leak detection)"
  log_info "  - 50% Verify Token"
  log_info "  - 30% Check-In"
  log_info "  - 15% Generate QR"
  log_info "  - 5% Check-In Status"
  echo ""

  BASE_URL="$BASE_URL" SCENARIO="endurance" timeout 1200 node load-test-runner.js 2>&1 | tee -a "$LOG_FILE"
  local exit_code=$?

  if [ $exit_code -eq 0 ]; then
    log_success "Endurance Test Scenario completed successfully"
  elif [ $exit_code -eq 124 ]; then
    log_warn "Endurance Test Scenario timed out (as expected after 20 minutes)"
  else
    log_error "Endurance Test Scenario failed with exit code $exit_code"
    return 1
  fi

  return 0
}

##############################################################################
# ANALYSIS & REPORTING
##############################################################################

generate_summary() {
  log_info "Generating test summary..."

  local summary_file="${RESULTS_DIR}/LOAD_TEST_SUMMARY_$(date +%s).md"

  cat > "$summary_file" << 'EOF'
# Load Test Summary

## Test Execution
- **Date**: $(date)
- **Duration**: 3 Scenarios (Happy Path: 5min, Stress: 1min, Endurance: 15min)
- **Base URL**: $BASE_URL

## Scenario Results

### 1. Happy Path Scenario
- **VUs**: 100 concurrent users (ramping up to 100 over 4 minutes, then 5 minutes steady)
- **Duration**: 5 minutes of load (10 minutes total with ramp-up/down)
- **Distribution**: 70% verify, 20% check-in, 10% generate QR
- **Endpoints Tested**:
  - POST /api/generate-qr
  - GET /api/verify
  - POST /api/check-in
  - GET /api/check-in-status
  - GET /health

### 2. Stress Test Scenario
- **VUs**: Spike from 100 to 500 concurrent users
- **Duration**: 1 minute at 500 VUs (3 minutes total with ramp-up/down)
- **Distribution**: 40% verify, 40% check-in, 20% generate QR
- **Purpose**: Verify system behavior under sudden load spikes

### 3. Endurance Test Scenario
- **VUs**: 50 concurrent users for full 15 minutes
- **Duration**: 15 minutes of load (16 minutes total with ramp-up)
- **Distribution**: 50% verify, 30% check-in, 15% generate QR, 5% status
- **Purpose**: Detect memory leaks and CPU/memory stability issues

## Success Criteria

✓ = Passed | ✗ = Failed | ⚠ = Warning

### Performance Targets
- [ ] p95 Response Time < 2000ms (across all endpoints)
- [ ] Error Rate < 1% (overall)
- [ ] Throughput > 50 req/sec (overall)

### Stability Targets (Endurance Test)
- [ ] Memory heap usage stable (no unbounded growth)
- [ ] CPU usage reasonable (< 80% under 50 concurrent users)
- [ ] No connection pool exhaustion
- [ ] No database lock contention

## Detailed Results

### Happy Path Scenario Results
```
[See load-test-results/happy-path-*.json]
```

### Stress Test Scenario Results
```
[See load-test-results/stress-*.json]
```

### Endurance Test Scenario Results
```
[See load-test-results/endurance-*.json]
```

## Key Findings

### What Worked Well
1. [To be filled after test execution]
2. [To be filled after test execution]

### Issues Found
1. [To be filled after test execution]
2. [To be filled after test execution]

### Bottleneck Analysis
- **Database**: [To be filled - check SQLite lock contention]
- **Rate Limiting**: [To be filled - check 429 responses]
- **Memory**: [To be filled - check growth during endurance test]
- **CPU**: [To be filled - check saturation under load]

## Recommendations

### For Production Readiness
1. [Based on findings]
2. [Based on findings]

### For Optimization
1. [Identify bottlenecks and suggest improvements]
2. [Optimize database queries or connection pooling]
3. [Adjust rate limiting if too strict]

## Test Environment
- Node.js Version: $(node --version)
- Platform: $(uname -s)
- Backend: http://localhost:3001
- Database: SQLite (file-based)

EOF

  log_success "Summary generated: $summary_file"
}

##############################################################################
# MAIN EXECUTION
##############################################################################

main() {
  log_info "=========================================="
  log_info "QR Access Backend - Load Test Suite"
  log_info "Phase 3: Performance Validation"
  log_info "=========================================="
  echo ""

  # Check dependencies
  if ! check_dependencies; then
    log_error "Dependency check failed"
    exit 1
  fi

  # Check backend
  if ! check_backend; then
    log_error "Backend check failed"
    exit 1
  fi

  # Setup
  setup
  echo ""

  # Run scenarios
  case "$SCENARIO" in
    happy-path)
      run_happy_path || exit 1
      ;;
    stress)
      run_stress || exit 1
      ;;
    endurance)
      run_endurance || exit 1
      ;;
    all)
      log_info "Running all scenarios in sequence..."
      echo ""

      run_happy_path || exit 1
      echo ""
      log_info "Waiting 30 seconds before next scenario..."
      sleep 30
      echo ""

      run_stress || exit 1
      echo ""
      log_info "Waiting 30 seconds before next scenario..."
      sleep 30
      echo ""

      run_endurance || exit 1
      echo ""
      ;;
    *)
      log_error "Unknown scenario: $SCENARIO"
      log_info "Usage: $0 [happy-path|stress|endurance|all]"
      exit 1
      ;;
  esac

  # Generate summary
  echo ""
  generate_summary

  log_success "=========================================="
  log_success "Load testing completed!"
  log_success "Results saved to: $RESULTS_DIR"
  log_success "=========================================="
}

main "$@"
