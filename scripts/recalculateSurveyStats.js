const mongoose = require("mongoose");
const dotenv = require("dotenv");
const path = require("path");

// Load models directly since we are running standalone
const Survey = require("../models/Survey");
const SurveyResponse = require("../models/SurveyResponse");

// Load env
dotenv.config({ path: path.join(__dirname, "../.env") });

const recalculateStats = async () => {
    try {
        console.log("🚀 Connecting to DB...");
        await mongoose.connect(process.env.MONGO_URI);
        console.log("✅ Connected.");

        const surveys = await Survey.find({});
        console.log(`Found ${surveys.length} surveys to process.`);

        for (const survey of surveys) {
            // 1. Count actual responses (filtering out incomplete/partial if needed)
            // Assuming 'submitted' status or just existing responses count
            const count = await SurveyResponse.countDocuments({ survey: survey._id });

            // 2. Find latest response
            const lastResponse = await SurveyResponse.findOne({ survey: survey._id })
                .sort({ createdAt: -1 })
                .select("createdAt");

            // 3. Update survey
            survey.totalResponses = count;
            survey.lastResponseAt = lastResponse ? lastResponse.createdAt : null;

            await survey.save();
            console.log(`Updated Survey: "${survey.title}" -> Responses: ${count}, Last: ${lastResponse?.createdAt || "None"}`);
        }

        console.log("🎉 All surveys updated successfully!");
        process.exit(0);

    } catch (error) {
        console.error("❌ Error:", error);
        process.exit(1);
    }
};

recalculateStats();
