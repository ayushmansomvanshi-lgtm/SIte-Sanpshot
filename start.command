#!/bin/bash
set -e

# Go to project directory
cd "$(dirname "$0")"

echo "Starting Site Snapshotter..."

# Start Node server
npm start