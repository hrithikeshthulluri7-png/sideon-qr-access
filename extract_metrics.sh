#!/bin/bash
# Extract metrics from k6 console output

SCENARIO=$1
LOGFILE="load-test-results/${SCENARIO}-console.log"

echo "=== SCENARIO: $SCENARIO ==="
echo ""

# Find the summary section
if grep -q "Check.*status is 200" "$LOGFILE"; then
    echo "Checks Summary:"
    grep -E "✓|✗" "$LOGFILE" | grep "status\|response time\|has " | head -20
    echo ""
fi

# Extract custom metrics
echo "Custom Metrics:"
grep -E "check_in_duration|verify_token_duration|generate_qr_duration|health_check_duration" "$LOGFILE" | tail -10
echo ""

# Extract HTTP metrics
echo "HTTP Metrics:"
grep -E "http_req_duration|http_req_failed|http_reqs" "$LOGFILE" | tail -5
echo ""

# Extract execution summary
echo "Execution Summary:"
grep -E "iterations|data_received|data_sent|vus_max" "$LOGFILE" | tail -10
echo ""

# Check for threshold violations
echo "Threshold Violations:"
grep "thresholds on metrics" "$LOGFILE" || echo "No threshold violations found in grep, check log manually"
