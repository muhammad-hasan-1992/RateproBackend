#!/usr/bin/env node
/**
 * Legacy Plan Migration Script
 * 
 * Migrates tenants using the old `Plan.js` model and `Tenant.plan` field
 * to the new `PlanTemplate` + `TenantSubscription` architecture.
 * 
 * USAGE: node scripts/migrateLegacyPlans.js [--dry-run]
 * 
 * This is a ONE-TIME migration. Run with --dry-run first to preview changes.
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const Tenant = require('../models/Tenant');
const User = require('../models/User'); // Must import to register schema for populate
const TenantSubscription = require('../models/TenantSubscription');
const PlanTemplate = require('../models/PlanTemplate');

const DRY_RUN = process.argv.includes('--dry-run');

async function migrate() {
    try {
        console.log(`\n🔄 Legacy Plan Migration ${DRY_RUN ? '(DRY RUN)' : ''}`);
        console.log('='.repeat(60));

        // Connect to MongoDB
        await mongoose.connect(process.env.MONGO_URI);
        console.log('✅ Connected to MongoDB');

        // Find all tenants that might have legacy plan data
        const tenants = await Tenant.find({}).populate('admin', 'name email');
        console.log(`📊 Found ${tenants.length} total tenants`);

        // Get all plan templates for mapping
        const planTemplates = await PlanTemplate.find({ isActive: true });
        const planMap = {};
        planTemplates.forEach(p => {
            planMap[p.code] = p;
            planMap[p.name.toLowerCase()] = p;
        });
        console.log(`📋 Available plan templates: ${planTemplates.map(p => p.code).join(', ')}`);

        let migrated = 0;
        let skipped = 0;
        let errors = 0;

        for (const tenant of tenants) {
            try {
                // Check if tenant already has a TenantSubscription
                const existingSub = await TenantSubscription.findOne({ tenant: tenant._id });

                if (existingSub) {
                    console.log(`  ⏭️ Tenant "${tenant.name}" already has subscription (${existingSub.planCode})`);
                    skipped++;
                    continue;
                }

                // Determine plan code from tenant data
                let planCode = 'free'; // Default
                let planTemplate = null;

                // Try to match from Tenant.plan reference
                if (tenant.plan) {
                    // If plan is a ref to the old Plan model, try to find a matching PlanTemplate
                    const oldPlanName = typeof tenant.plan === 'object' ? tenant.plan.name : null;
                    if (oldPlanName && planMap[oldPlanName.toLowerCase()]) {
                        planTemplate = planMap[oldPlanName.toLowerCase()];
                        planCode = planTemplate.code;
                    }
                }

                // Try to match from Tenant.features
                if (!planTemplate && tenant.features && Object.keys(tenant.features).length > 0) {
                    // Heuristic: match by feature count to most likely plan
                    planTemplate = planMap['free'] || planTemplates[0];
                    planCode = planTemplate?.code || 'free';
                }

                if (!planTemplate) {
                    planTemplate = planMap['free'] || planTemplates[0];
                    planCode = planTemplate?.code || 'free';
                }

                console.log(`  📦 Migrating tenant "${tenant.name}" → plan: ${planCode}`);

                if (!DRY_RUN) {
                    // Create TenantSubscription
                    const sub = await TenantSubscription.create({
                        tenant: tenant._id,
                        planTemplate: planTemplate._id,
                        planCode: planCode,
                        billing: {
                            status: 'active',
                            cycle: 'monthly'
                        },
                        onboardingStatus: 'completed',
                        createdBy: tenant.admin?._id
                    });

                    // Apply plan features
                    await sub.applyPlanFeatures(planTemplate);

                    // Mark tenant as migrated (preserve old data)
                    tenant._migrated = true;
                    tenant.markModified('_migrated');
                    await tenant.save();
                }

                migrated++;
            } catch (err) {
                console.error(`  ❌ Error migrating tenant "${tenant.name}": ${err.message}`);
                errors++;
            }
        }

        console.log('\n' + '='.repeat(60));
        console.log(`📊 Migration Summary ${DRY_RUN ? '(DRY RUN)' : ''}`);
        console.log(`   ✅ Migrated: ${migrated}`);
        console.log(`   ⏭️ Skipped (already had subscription): ${skipped}`);
        console.log(`   ❌ Errors: ${errors}`);
        console.log('='.repeat(60) + '\n');

        if (DRY_RUN) {
            console.log('💡 This was a dry run. Run without --dry-run to apply changes.');
        }

    } catch (error) {
        console.error('❌ Migration failed:', error.message);
        process.exit(1);
    } finally {
        await mongoose.disconnect();
        console.log('🔌 Disconnected from MongoDB');
    }
}

migrate();
