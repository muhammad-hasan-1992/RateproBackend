// scripts/migrate-subscription-to-featureflag.js
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const mongoose = require('mongoose');
const Subscription = require('../models/Subscription');
const FeatureFlag = require('../models/FeatureFlag');

async function runMigration() {
  try {
    // 1) DB Connect (CRITICAL)
    await mongoose.connect(process.env.MONGO_URI, {
      serverSelectionTimeoutMS: 5000
    });

    console.log("✅ Connected to DB");

    // 2) Actual migration logic
    const subscriptions = await Subscription.find({ isTemplate: false });

    for (const sub of subscriptions) {
      const existing = await FeatureFlag.findOne({ tenant: sub.tenant });
      if (existing) continue;

      const planMap = {
        Free: 'free',
        Starter: 'starter',
        Pro: 'pro',
        Enterprise: 'enterprise'
      };

      const plan = planMap[sub.name] || 'free';

      await FeatureFlag.create({
        tenant: sub.tenant,
        plan,
        billingCycle: sub.billingCycle,
        status: sub.isActive ? 'active' : 'cancelled',
        flags: {
          smartSegments: plan === 'pro' || plan === 'enterprise',
          actionEngine: plan === 'enterprise',
          incentives: plan === 'enterprise',
          deliveryIntelligence: plan === 'pro' || plan === 'enterprise',
        },
        limits: {},
        createdBy: sub.createdBy
      });
    }

    console.log("🎉 Migration Complete!");
    process.exit(0);
  } catch (err) {
    console.error("❌ Migration Error:", err);
    process.exit(1);
  }
}

if (require.main === module) {
  runMigration();
}

module.exports = runMigration;
