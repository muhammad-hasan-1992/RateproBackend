/**
 * Seed Script: Initial Dropdown Options
 * 
 * Seeds the database with global default dropdown options.
 * These are system defaults that all tenants will see.
 * 
 * Run with: node seeds/seedDropdownOptions.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const DropdownOption = require('../models/DropdownOption');

const MONGODB_URI = process.env.MONGODB_URI;

// Industry/Sector Categories (from SurveyTemplates.jsx)
const industryOptions = [
    { key: "corporate", label: "Corporate / HR", color: "#007bff", sortOrder: 1 },
    { key: "education", label: "Education", color: "#28a745", sortOrder: 2 },
    { key: "healthcare", label: "Healthcare", color: "#dc3545", sortOrder: 3 },
    { key: "hospitality", label: "Hospitality & Tourism", color: "#ffc107", sortOrder: 4 },
    { key: "sports", label: "Sports & Entertainment", color: "#17a2b8", sortOrder: 5 },
    { key: "banking", label: "Banking & Financial", color: "#6f42c1", sortOrder: 6 },
    { key: "retail", label: "Retail & E-Commerce", color: "#fd7e14", sortOrder: 7 },
    { key: "government", label: "Government & Public", color: "#20c997", sortOrder: 8 },
    { key: "construction", label: "Construction & Real Estate", color: "#6c757d", sortOrder: 9 },
    { key: "automotive", label: "Automotive & Transport", color: "#e83e8c", sortOrder: 10 },
    { key: "technology", label: "Technology & Digital", color: "#495057", sortOrder: 11 },
];

// Survey Categories
const surveyCategories = [
    { key: "customer_satisfaction", label: "Customer Satisfaction", color: "#28a745", sortOrder: 1 },
    { key: "employee_engagement", label: "Employee Engagement", color: "#007bff", sortOrder: 2 },
    { key: "product_feedback", label: "Product Feedback", color: "#17a2b8", sortOrder: 3 },
    { key: "market_research", label: "Market Research", color: "#6f42c1", sortOrder: 4 },
    { key: "event_feedback", label: "Event Feedback", color: "#ffc107", sortOrder: 5 },
    { key: "nps", label: "Net Promoter Score", color: "#dc3545", sortOrder: 6 },
    { key: "service_quality", label: "Service Quality", color: "#fd7e14", sortOrder: 7 },
    { key: "general", label: "General Purpose", color: "#6c757d", sortOrder: 8 },
];

// Target Audience Types
const targetAudienceOptions = [
    { key: "all", label: "All Contacts", color: "#28a745", sortOrder: 1 },
    { key: "customers", label: "Customers", color: "#007bff", sortOrder: 2 },
    { key: "employees", label: "Employees", color: "#17a2b8", sortOrder: 3 },
    { key: "partners", label: "Partners & Vendors", color: "#6f42c1", sortOrder: 4 },
    { key: "prospects", label: "Prospects", color: "#ffc107", sortOrder: 5 },
    { key: "specific", label: "Specific Contacts", color: "#6c757d", sortOrder: 6 },
];

async function seedDropdowns() {
    console.log("\n═══════════════════════════════════════════════");
    console.log("   SEEDING DROPDOWN OPTIONS");
    console.log("═══════════════════════════════════════════════\n");

    const allOptions = [
        ...industryOptions.map(opt => ({ ...opt, type: "industry" })),
        ...surveyCategories.map(opt => ({ ...opt, type: "survey_category" })),
        ...targetAudienceOptions.map(opt => ({ ...opt, type: "target_audience" })),
    ];

    let created = 0;
    let skipped = 0;

    for (const option of allOptions) {
        try {
            // Check if already exists (system-level, no tenant)
            const existing = await DropdownOption.findOne({
                type: option.type,
                key: option.key,
                active: true,
            });

            if (existing) {
                console.log(`⏭️  Skipping ${option.type}:${option.key} (already exists)`);
                skipped++;
                continue;
            }

            await DropdownOption.create({
                ...option,
                active: true,
            });

            console.log(`✅ Created ${option.type}:${option.key} - "${option.label}"`);
            created++;
        } catch (error) {
            console.error(`❌ Error creating ${option.type}:${option.key}:`, error.message);
        }
    }

    console.log("\n───────────────────────────────────────────────");
    console.log(`📊 Summary: ${created} created, ${skipped} skipped`);
    console.log("───────────────────────────────────────────────\n");
}

async function main() {
    try {
        await mongoose.connect(MONGODB_URI);
        console.log("✅ Connected to MongoDB");

        await seedDropdowns();

    } catch (error) {
        console.error("❌ Error:", error.message);
        process.exit(1);
    } finally {
        await mongoose.disconnect();
        console.log("🔌 Disconnected from MongoDB");
    }
}

main();
