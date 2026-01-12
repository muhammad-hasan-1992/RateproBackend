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
    // Get all tenants
    const tenants = await Tenant.find({}).select("_id companyName");

    for (const tenant of tenants) {
      const result = await recalculateAllContactStats({
        tenantId: tenant._id,
      });

      if (result.errors.length > 0) {
        console.log(`   ⚠️  Errors: ${result.errors.length}`);
      }
    }

    process.exit(0);
  } catch (err) {
    console.error("❌ Migration failed:", err);
    process.exit(1);
  }
}

migrate();