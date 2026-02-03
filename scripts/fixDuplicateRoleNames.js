/**
 * Migration Script: Fix Duplicate Role Names
 * 
 * Purpose: Rename existing duplicate role names within the same tenant
 * by appending a numeric suffix (e.g., "User Manager (2)").
 * 
 * Run with: node scripts/fixDuplicateRoleNames.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const CustomRole = require('../models/CustomRole');

const MONGODB_URI = process.env.MONGODB_URI;

async function findDuplicates() {
    const duplicates = await CustomRole.aggregate([
        // Group by tenant + name
        {
            $group: {
                _id: { tenant: "$tenant", name: "$name" },
                count: { $sum: 1 },
                roles: { $push: { id: "$_id", createdAt: "$createdAt" } }
            }
        },
        // Filter only duplicates
        { $match: { count: { $gt: 1 } } },
        // Sort for consistent ordering
        { $sort: { "_id.name": 1 } }
    ]);

    return duplicates;
}

async function renameDuplicates(dryRun = true) {
    console.log("\n🔍 Finding duplicate role names...\n");

    const duplicates = await findDuplicates();

    if (duplicates.length === 0) {
        console.log("✅ No duplicate role names found. Database is clean!");
        return { renamed: 0, duplicateGroups: 0 };
    }

    console.log(`⚠️  Found ${duplicates.length} groups of duplicate role names:\n`);

    let totalRenamed = 0;

    for (const group of duplicates) {
        const { tenant, name } = group._id;
        console.log(`\n📁 Role: "${name}" (Tenant: ${tenant})`);
        console.log(`   Duplicate count: ${group.count}`);

        // Sort by createdAt - keep the oldest one unchanged
        const sortedRoles = group.roles.sort((a, b) =>
            new Date(a.createdAt) - new Date(b.createdAt)
        );

        // First role keeps original name, others get suffix
        for (let i = 1; i < sortedRoles.length; i++) {
            const roleId = sortedRoles[i].id;
            const newName = `${name} (${i + 1})`;

            console.log(`   ├─ Renaming role ${roleId} to "${newName}"`);

            if (!dryRun) {
                await CustomRole.findByIdAndUpdate(roleId, { name: newName });
            }

            totalRenamed++;
        }
    }

    if (dryRun) {
        console.log("\n📋 DRY RUN COMPLETE - No changes made");
        console.log("   Run with '--execute' to apply changes\n");
    } else {
        console.log(`\n✅ Migration complete! Renamed ${totalRenamed} roles\n`);
    }

    return { renamed: totalRenamed, duplicateGroups: duplicates.length };
}

async function main() {
    const args = process.argv.slice(2);
    const dryRun = !args.includes('--execute');

    if (dryRun) {
        console.log("═══════════════════════════════════════════════");
        console.log("   FIX DUPLICATE ROLE NAMES - DRY RUN MODE");
        console.log("═══════════════════════════════════════════════");
    } else {
        console.log("═══════════════════════════════════════════════");
        console.log("   FIX DUPLICATE ROLE NAMES - EXECUTING");
        console.log("═══════════════════════════════════════════════");
    }

    try {
        await mongoose.connect(MONGODB_URI);
        console.log("✅ Connected to MongoDB");

        const result = await renameDuplicates(dryRun);

        if (!dryRun && result.renamed > 0) {
            // Now we can safely drop old index and the new one will take effect
            console.log("📌 Index update will take effect on next server restart");
        }

    } catch (error) {
        console.error("❌ Error:", error.message);
        process.exit(1);
    } finally {
        await mongoose.disconnect();
        console.log("🔌 Disconnected from MongoDB");
    }
}

main();
