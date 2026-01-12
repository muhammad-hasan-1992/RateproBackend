/**
 * One-time migration script to enable notifications for all tenants
 * Run with: node scripts/enableNotifications.js
 */
const mongoose = require('mongoose');
require('dotenv').config();

const Tenant = require('../models/Tenant');

async function enableNotificationsForAllTenants() {
  try {
    console.log('🔍 Checking tenant notifications feature...');

    // Update all tenants that don't have notifications feature set
    const result = await Tenant.updateMany(
      { 'features.notifications': { $exists: false } },
      { $set: { 'features.notifications': true } }
    );

    console.log(`✅ Updated ${result.modifiedCount} tenants (missing field)`);
    
    // Also update tenants where notifications is explicitly undefined/null
    const result2 = await Tenant.updateMany(
      { 'features.notifications': null },
      { $set: { 'features.notifications': true } }
    );

    console.log(`✅ Fixed ${result2.modifiedCount} additional tenants (null value)`);
    
    const totalUpdated = result.modifiedCount + result2.modifiedCount;
    if (totalUpdated === 0) {
      console.log('ℹ️  All tenants already have notifications enabled');
    }

  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error; // Re-throw to let caller handle
  }
}

// ✅ Export the function
module.exports = { enableNotificationsForAllTenants };

// If running directly (not imported)
if (require.main === module) {
  mongoose.connect(process.env.MONGO_URI)
    .then(() => {
      console.log('Connected to MongoDB');
      return enableNotificationsForAllTenants();
    })
    .then(() => {
      console.log('Done!');
      return mongoose.disconnect();
    })
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Script failed:', error);
      process.exit(1);
    });
}