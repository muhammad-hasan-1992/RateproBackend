// scripts/syncSurveyResponseCounts.js
// ============================================================================
// One-time migration script to sync existing surveys with correct response counts
// 
// Run with: node scripts/syncSurveyResponseCounts.js
// ============================================================================

require("dotenv").config();
const mongoose = require("mongoose");
const Survey = require("../models/Survey");
const SurveyResponse = require("../models/SurveyResponse");

async function syncSurveyResponseCounts() {
    console.log("🔄 Starting survey response count sync...\n");

    try {
        // Connect to MongoDB
        await mongoose.connect(process.env.MONGO_URI);
        console.log("✅ Connected to MongoDB\n");

        // Get all surveys
        const surveys = await Survey.find({ deleted: false }).select("_id title totalResponses lastResponseAt");
        console.log(`📋 Found ${surveys.length} surveys to process\n`);

        let updated = 0;
        let skipped = 0;
        let errors = 0;

        for (const survey of surveys) {
            try {
                // Count actual responses from SurveyResponse collection
                const responseCount = await SurveyResponse.countDocuments({
                    survey: survey._id,
                    status: "submitted" // Only count submitted responses
                });

                // Find the most recent response
                const lastResponse = await SurveyResponse.findOne({
                    survey: survey._id,
                    status: "submitted"
                })
                    .sort({ createdAt: -1 })
                    .select("createdAt")
                    .lean();

                const lastResponseAt = lastResponse?.createdAt || null;

                // Check if update is needed
                const needsUpdate =
                    survey.totalResponses !== responseCount ||
                    (lastResponseAt && (!survey.lastResponseAt ||
                        survey.lastResponseAt.getTime() !== lastResponseAt.getTime()));

                if (needsUpdate) {
                    await Survey.findByIdAndUpdate(survey._id, {
                        $set: {
                            totalResponses: responseCount,
                            lastResponseAt: lastResponseAt,
                            // Also update analytics subdoc for consistency
                            "analytics.totalResponses": responseCount,
                            "analytics.lastResponseAt": lastResponseAt
                        }
                    });

                    console.log(`✅ ${survey.title}`);
                    console.log(`   totalResponses: ${survey.totalResponses || 0} → ${responseCount}`);
                    console.log(`   lastResponseAt: ${survey.lastResponseAt || "null"} → ${lastResponseAt || "null"}\n`);
                    updated++;
                } else {
                    skipped++;
                }
            } catch (err) {
                console.error(`❌ Error processing survey ${survey._id}: ${err.message}`);
                errors++;
            }
        }

        console.log("\n" + "=".repeat(60));
        console.log("📊 SYNC COMPLETE");
        console.log("=".repeat(60));
        console.log(`   Updated: ${updated}`);
        console.log(`   Skipped (already correct): ${skipped}`);
        console.log(`   Errors: ${errors}`);
        console.log(`   Total: ${surveys.length}`);

    } catch (err) {
        console.error("❌ Fatal error:", err);
        process.exit(1);
    } finally {
        await mongoose.disconnect();
        console.log("\n✅ Disconnected from MongoDB");
    }
}

// Run the script
syncSurveyResponseCounts();
