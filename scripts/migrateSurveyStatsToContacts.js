// scripts/migrateSurveyStatsToContacts.js
/**
 * Migration script to populate surveyStats for existing contacts
 * Run with: node scripts/migrateSurveyStatsToContacts.js
 */

require("dotenv").config();
const mongoose = require("mongoose");
const connectDB = require("../config/db");
const Tenant = require("../models/Tenant");
const { recalculateAllContactStats } = require("../services/contact/contactSurveySync.service");

async function migrate() {
  try {
    await connectDB();
    console.log("✅ Connected to database");

    // Get all tenants
    const tenants = await Tenant.find({}).select("_id companyName");
    console.log(`📊 Found ${tenants.length} tenants to process`);

    for (const tenant of tenants) {
      console.log(`\n🔄 Processing tenant: ${tenant.companyName} (${tenant._id})`);

      const result = await recalculateAllContactStats({
        tenantId: tenant._id,
      });

      console.log(`   ✅ Processed: ${result.processed} contacts`);
      if (result.errors.length > 0) {
        console.log(`   ⚠️  Errors: ${result.errors.length}`);
      }
    }

    console.log("\n✅ Migration completed!");
    process.exit(0);
  } catch (err) {
    console.error("❌ Migration failed:", err);
    process.exit(1);
  }
}

migrate();