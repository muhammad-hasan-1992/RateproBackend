// seeds/seedPlans.js
// Seed data for plan templates

const mongoose = require('mongoose');
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const PlanTemplate = require('../models/PlanTemplate');

const plans = [
    {
        code: 'free',
        name: 'Free',
        description: 'Perfect for getting started with surveys',
        pricing: {
            monthly: 0,
            yearly: 0,
            currency: 'USD'
        },
        features: [
            { featureCode: 'max_active_surveys', enabled: true, limitValue: 3 },
            { featureCode: 'max_responses_monthly', enabled: true, limitValue: 100 },
            { featureCode: 'max_users', enabled: true, limitValue: 1 },
            { featureCode: 'max_segments', enabled: true, limitValue: 2 },
            { featureCode: 'storage_gb', enabled: true, limitValue: 0.5 },
            { featureCode: 'email_monthly_limit', enabled: true, limitValue: 100 },
            { featureCode: 'sms_monthly_limit', enabled: true, limitValue: 0 },
            { featureCode: 'sms_distribution', enabled: false },
            { featureCode: 'whatsapp_distribution', enabled: false },
            { featureCode: 'ai_survey_generation', enabled: false },
            { featureCode: 'advanced_analytics', enabled: false },
            { featureCode: 'smart_segments', enabled: false },
            { featureCode: 'action_engine', enabled: false },
            { featureCode: 'custom_branding', enabled: false },
            { featureCode: 'api_access', enabled: false },
            { featureCode: 'multi_language', enabled: true },
            { featureCode: 'branding_level', enabled: true, limitValue: 0 }
        ],
        trial: { enabled: false },
        isPublic: true,
        displayOrder: 1
    },
    {
        code: 'starter',
        name: 'Starter',
        description: 'For small teams getting serious about feedback',
        pricing: {
            monthly: 29,
            yearly: 290,
            currency: 'USD'
        },
        features: [
            { featureCode: 'max_active_surveys', enabled: true, limitValue: 10 },
            { featureCode: 'max_responses_monthly', enabled: true, limitValue: 1000 },
            { featureCode: 'max_users', enabled: true, limitValue: 5 },
            { featureCode: 'max_segments', enabled: true, limitValue: 10 },
            { featureCode: 'storage_gb', enabled: true, limitValue: 5 },
            { featureCode: 'email_monthly_limit', enabled: true, limitValue: 5000 },
            { featureCode: 'sms_monthly_limit', enabled: true, limitValue: 500 },
            { featureCode: 'sms_distribution', enabled: true },
            { featureCode: 'whatsapp_distribution', enabled: false },
            { featureCode: 'ai_survey_generation', enabled: true },
            { featureCode: 'advanced_analytics', enabled: false },
            { featureCode: 'smart_segments', enabled: false },
            { featureCode: 'action_engine', enabled: false },
            { featureCode: 'actions_monthly', enabled: true, limitValue: 100 },
            { featureCode: 'custom_branding', enabled: true },
            { featureCode: 'api_access', enabled: false },
            { featureCode: 'multi_language', enabled: true },
            { featureCode: 'branding_level', enabled: true, limitValue: 1 }
        ],
        trial: { enabled: true, days: 14 },
        isPublic: true,
        displayOrder: 2
    },
    {
        code: 'pro',
        name: 'Pro',
        description: 'For growing businesses that need powerful features',
        pricing: {
            monthly: 79,
            yearly: 790,
            currency: 'USD'
        },
        badge: 'Most Popular',
        features: [
            { featureCode: 'max_active_surveys', enabled: true, limitValue: 50 },
            { featureCode: 'max_responses_monthly', enabled: true, limitValue: 10000 },
            { featureCode: 'max_users', enabled: true, limitValue: 20 },
            { featureCode: 'max_segments', enabled: true, limitValue: 50 },
            { featureCode: 'storage_gb', enabled: true, limitValue: 25 },
            { featureCode: 'email_monthly_limit', enabled: true, limitValue: 25000 },
            { featureCode: 'sms_monthly_limit', enabled: true, limitValue: 5000 },
            { featureCode: 'sms_distribution', enabled: true },
            { featureCode: 'whatsapp_distribution', enabled: true },
            { featureCode: 'ai_survey_generation', enabled: true },
            { featureCode: 'advanced_analytics', enabled: true },
            { featureCode: 'smart_segments', enabled: true },
            { featureCode: 'delivery_intelligence', enabled: true },
            { featureCode: 'action_engine', enabled: true },
            { featureCode: 'actions_monthly', enabled: true, limitValue: 1000 },
            { featureCode: 'incentives', enabled: false },
            { featureCode: 'escalation_rules', enabled: true },
            { featureCode: 'custom_branding', enabled: true },
            { featureCode: 'white_label', enabled: false },
            { featureCode: 'api_access', enabled: true },
            { featureCode: 'webhooks', enabled: true },
            { featureCode: 'multi_language', enabled: true },
            { featureCode: 'branding_level', enabled: true, limitValue: 2 }
        ],
        trial: { enabled: true, days: 14 },
        isPublic: true,
        displayOrder: 3
    },
    {
        code: 'enterprise',
        name: 'Enterprise',
        description: 'For large organizations with custom needs',
        pricing: {
            monthly: 299,
            yearly: 2990,
            currency: 'USD'
        },
        badge: 'Best Value',
        features: [
            { featureCode: 'max_active_surveys', enabled: true, limitValue: -1 }, // Unlimited
            { featureCode: 'max_responses_monthly', enabled: true, limitValue: -1 },
            { featureCode: 'max_users', enabled: true, limitValue: -1 },
            { featureCode: 'max_segments', enabled: true, limitValue: -1 },
            { featureCode: 'storage_gb', enabled: true, limitValue: 100 },
            { featureCode: 'email_monthly_limit', enabled: true, limitValue: -1 },
            { featureCode: 'sms_monthly_limit', enabled: true, limitValue: 50000 },
            { featureCode: 'sms_distribution', enabled: true },
            { featureCode: 'whatsapp_distribution', enabled: true },
            { featureCode: 'ai_survey_generation', enabled: true },
            { featureCode: 'advanced_analytics', enabled: true },
            { featureCode: 'smart_segments', enabled: true },
            { featureCode: 'delivery_intelligence', enabled: true },
            { featureCode: 'action_engine', enabled: true },
            { featureCode: 'actions_monthly', enabled: true, limitValue: -1 },
            { featureCode: 'incentives', enabled: true },
            { featureCode: 'escalation_rules', enabled: true },
            { featureCode: 'custom_branding', enabled: true },
            { featureCode: 'white_label', enabled: true },
            { featureCode: 'api_access', enabled: true },
            { featureCode: 'webhooks', enabled: true },
            { featureCode: 'multi_language', enabled: true },
            { featureCode: 'priority_support', enabled: true },
            { featureCode: 'sla_management', enabled: true },
            { featureCode: 'branding_level', enabled: true, limitValue: 3 }
        ],
        trial: { enabled: true, days: 30 },
        isPublic: true,
        displayOrder: 4
    }
];

async function seedPlans() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('✅ Connected to MongoDB');

        // Clear existing plans
        await PlanTemplate.deleteMany({});
        console.log('🗑️ Cleared existing plan templates');

        // Insert new plans
        const result = await PlanTemplate.insertMany(plans);
        console.log(`✅ Seeded ${result.length} plan templates`);

        console.log('\n📋 Plans created:');
        result.forEach(plan => {
            console.log(`   ${plan.code}: $${plan.pricing.monthly}/mo (${plan.features.length} features)`);
        });

        process.exit(0);
    } catch (error) {
        console.error('❌ Seed error:', error.message);
        process.exit(1);
    }
}

if (require.main === module) {
    seedPlans();
}

module.exports = { plans, seedPlans };
