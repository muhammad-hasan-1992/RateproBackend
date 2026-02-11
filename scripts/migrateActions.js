// scripts/migrateActions.js
// ============================================================================
// One-time Migration Script for Existing Actions
//
// Run with: node scripts/migrateActions.js
//
// What it does:
//   1. Flags all existing actions (without legacyAction set) as legacyAction: true
//   2. Backfills problemStatement = description where problemStatement is null
//   3. Reports count of migrated records
//
// Safe to run multiple times — idempotent.
// ============================================================================

require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const Action = require("../models/Action");

async function migrateActions() {
    console.log("=== Action Migration Script ===\n");

    try {
        await connectDB();
        console.log("✅ Connected to database\n");

        // ── Step 1: Flag legacy actions ─────────────────────────────────
        console.log("Step 1: Flagging existing actions as legacyAction...");

        const legacyResult = await Action.updateMany(
            {
                // Only flag actions that haven't been flagged yet
                $or: [
                    { legacyAction: { $exists: false } },
                    { legacyAction: null }
                ]
            },
            {
                $set: { legacyAction: true }
            }
        );

        console.log(`  → ${legacyResult.modifiedCount} actions flagged as legacyAction: true`);

        // ── Step 2: Backfill problemStatement ───────────────────────────
        console.log("\nStep 2: Backfilling problemStatement from description...");

        // Use aggregation to update only where problemStatement is missing
        // but description exists
        const backfillResult = await Action.updateMany(
            {
                $and: [
                    {
                        $or: [
                            { problemStatement: { $exists: false } },
                            { problemStatement: null },
                            { problemStatement: "" }
                        ]
                    },
                    {
                        description: { $exists: true, $ne: null, $ne: "" }
                    }
                ]
            },
            [
                {
                    $set: {
                        problemStatement: "$description"
                    }
                }
            ]
        );

        console.log(`  → ${backfillResult.modifiedCount} actions had problemStatement backfilled from description`);

        // ── Step 3: Initialize missing Phase 1 defaults ─────────────────
        console.log("\nStep 3: Initializing missing Phase 1 field defaults...");

        const defaultsResult = await Action.updateMany(
            {
                $or: [
                    { 'rootCause.category': { $exists: false } },
                    { evidence: { $exists: false } }
                ]
            },
            {
                $set: {
                    'rootCause.category': 'unknown',
                    'affectedAudience.segments': [],
                    'affectedAudience.estimatedCount': 0
                }
            }
        );

        console.log(`  → ${defaultsResult.modifiedCount} actions had Phase 1 defaults initialized`);

        // ── Summary ─────────────────────────────────────────────────────
        const totalActions = await Action.countDocuments();
        const legacyCount = await Action.countDocuments({ legacyAction: true });
        const withProblemStatement = await Action.countDocuments({
            problemStatement: { $exists: true, $ne: null, $ne: "" }
        });

        console.log("\n=== Migration Summary ===");
        console.log(`Total actions in database: ${totalActions}`);
        console.log(`Actions marked as legacy:  ${legacyCount}`);
        console.log(`Actions with problemStatement: ${withProblemStatement}`);
        console.log("\n✅ Migration complete!");

    } catch (err) {
        console.error("\n❌ Migration failed:", err.message);
        console.error(err);
        process.exit(1);
    } finally {
        await mongoose.disconnect();
        console.log("\nDatabase connection closed.");
    }
}

// Run if called directly
if (require.main === module) {
    migrateActions();
}

module.exports = { migrateActions };
