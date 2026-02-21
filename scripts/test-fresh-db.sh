#!/bin/bash
# Test a fresh database by deleting the existing one and running the app

DB_DIR="$HOME/.local/share/quran.sh"
DB_FILE="$DB_DIR/quran.db"

echo "🗑️  Removing database files..."
rm -f "$DB_FILE" "$DB_FILE-wal" "$DB_FILE-shm"
echo "   Deleted: $DB_FILE"

echo ""
echo "🔄 Rebuilding..."
bun run build

echo ""
echo "🚀 Running: bun ./dist/index.js streak"
bun ./dist/index.js streak

echo ""
echo "✅ Fresh DB test complete"
