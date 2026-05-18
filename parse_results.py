#!/usr/bin/env python3
import json
import sys

def parse_k6_results(json_file):
    """Parse k6 JSON results and extract key metrics"""
    try:
        with open(json_file, 'r') as f:
            data = json.load(f)
    except Exception as e:
        print(f"Error reading {json_file}: {e}")
        return None
    
    metrics = data.get('metrics', {})
    result = {}
    
    # Extract key metrics
    for metric_name, metric_data in metrics.items():
        if 'values' in metric_data:
            result[metric_name] = metric_data['values']
    
    return result

def extract_summary(json_file):
    """Extract summary statistics from k6 results"""
    try:
        with open(json_file, 'r') as f:
            data = json.load(f)
    except Exception as e:
        return None
    
    metrics = data.get('metrics', {})
    summary = {}
    
    # HTTP metrics
    if 'http_req_duration' in metrics:
        vals = metrics['http_req_duration'].get('values', {})
        summary['http_req_duration'] = {
            'mean': vals.get('mean'),
            'p95': vals.get('p(95)'),
            'p99': vals.get('p(99)'),
            'max': vals.get('max')
        }
    
    if 'http_req_failed' in metrics:
        vals = metrics['http_req_failed'].get('values', {})
        summary['http_req_failed'] = vals
    
    # Custom metrics
    for metric in ['check_in_errors', 'verify_token_errors', 'generate_qr_errors']:
        if metric in metrics:
            vals = metrics[metric].get('values', {})
            summary[metric] = vals
    
    if 'http_reqs' in metrics:
        vals = metrics['http_reqs'].get('values', {})
        summary['http_reqs'] = vals
    
    if 'iterations' in metrics:
        vals = metrics['iterations'].get('values', {})
        summary['iterations'] = vals
    
    return summary

if __name__ == '__main__':
    if len(sys.argv) > 1:
        result = extract_summary(sys.argv[1])
        if result:
            print(json.dumps(result, indent=2))
    else:
        print("Usage: parse_results.py <json_file>")
