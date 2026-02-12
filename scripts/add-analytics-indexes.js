/**
 * Add Analytics Indexes
 * 
 * Creates compound MongoDB indexes for analytics query patterns.
 * Safe to run multiple times — createIndex is idempotent.
 * Indexes are built in background to avoid blocking operations.
 * 
 * Usage: node scripts/add-analytics-indexes.js
 */
const mongoose = require("mongoose");
require("dotenv").config();

const INDEXES = [
    {
        collection: "surveyresponses",
        indexes: [
            { spec: { tenant: 1, createdAt: -1 }, name: "tenant_createdAt_desc" },
            { spec: { tenant: 1, "analysis.sentiment": 1 }, name: "tenant_sentiment" },
            { spec: { tenant: 1, "analysis.npsCategory": 1 }, name: "tenant_npsCategory" },
        ]
    },
    {
        collection: "actions",
        indexes: [
            { spec: { tenant: 1, createdAt: -1 }, name: "tenant_createdAt_desc" },
            { spec: { tenant: 1, status: 1, dueDate: 1 }, name: "tenant_status_dueDate" },
        ]
    },
    {
        collection: "surveys",
        indexes: [
            { spec: { tenant: 1, status: 1 }, name: "tenant_status" },
        ]
    }
];

async function run() {
    const uri = process.env.MONGO_URI || process.env.MONGODB_URI;
    if (!uri) {
        console.error("❌ MONGO_URI not set in environment");
        process.exit(1);
    }

    await mongoose.connect(uri);
    console.log("✅ Connected to MongoDB");
    const db = mongoose.connection.db;

    for (const { collection, indexes } of INDEXES) {
        for (const { spec, name } of indexes) {
            try {
                // createIndex is idempotent — no-ops if index already exists
                await db.collection(collection).createIndex(spec, { background: true, name });
                console.log(`  ✅ ${collection}.${name}`);
            } catch (err) {
                console.error(`  ❌ ${collection}.${name}: ${err.message}`);
            }
        }
    }

    console.log("\n✅ Index creation complete");
    await mongoose.disconnect();
    process.exit(0);
}

run().catch(err => {
    console.error("Fatal error:", err);
    process.exit(1);
});
