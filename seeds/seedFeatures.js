// seeds/seedFeatures.js
// Seed data for feature definitions

const mongoose = require('mongoose');
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const FeatureDefinition = require('../models/FeatureDefinition');

const features = [
    // Core Features
    {
        code: 'max_active_surveys',
        name: 'Active Surveys',
        description: 'Maximum number of active surveys at any time',
        category: 'core',
        type: 'limit',
        defaultValue: 5,
        unit: 'surveys',
        displayOrder: 1
    },
    {
        code: 'max_responses_monthly',
        name: 'Monthly Responses',
        description: 'Maximum survey responses per month',
        category: 'core',
        type: 'limit',
        defaultValue: 500,
        unit: 'responses',
        displayOrder: 2
    },
    {
        code: 'max_users',
        name: 'Team Members',
        description: 'Maximum team members per organization',
        category: 'core',
        type: 'limit',
        defaultValue: 3,
        unit: 'users',
        displayOrder: 3
    },
    {
        code: 'max_segments',
        name: 'Audience Segments',
        description: 'Maximum audience segments',
        category: 'core',
        type: 'limit',
        defaultValue: 5,
        unit: 'segments',
        displayOrder: 4
    },
    {
        code: 'storage_gb',
        name: 'Storage',
        description: 'Storage quota for uploads',
        category: 'core',
        type: 'limit',
        defaultValue: 1,
        unit: 'GB',
        displayOrder: 5
    },

    // Distribution Features
    {
        code: 'email_monthly_limit',
        name: 'Email Invitations',
        description: 'Monthly email invitation limit',
        category: 'distribution',
        type: 'limit',
        defaultValue: 1000,
        unit: 'emails',
        displayOrder: 10
    },
    {
        code: 'sms_monthly_limit',
        name: 'SMS Invitations',
        description: 'Monthly SMS invitation limit',
        category: 'distribution',
        type: 'limit',
        defaultValue: 500,
        unit: 'SMS',
        displayOrder: 11
    },
    {
        code: 'sms_distribution',
        name: 'SMS Distribution',
        description: 'Send surveys via SMS',
        category: 'distribution',
        type: 'boolean',
        defaultValue: true,
        displayOrder: 12
    },
    {
        code: 'whatsapp_distribution',
        name: 'WhatsApp Distribution',
        description: 'Send surveys via WhatsApp',
        category: 'distribution',
        type: 'boolean',
        defaultValue: false,
        displayOrder: 13
    },

    // Analytics Features
    {
        code: 'ai_survey_generation',
        name: 'AI Survey Generation',
        description: 'Generate surveys using AI',
        category: 'analytics',
        type: 'boolean',
        defaultValue: false,
        displayOrder: 20
    },
    {
        code: 'advanced_analytics',
        name: 'Advanced Analytics',
        description: 'Advanced analytics and insights',
        category: 'analytics',
        type: 'boolean',
        defaultValue: false,
        displayOrder: 21
    },
    {
        code: 'smart_segments',
        name: 'Smart Segments',
        description: 'AI-powered audience segmentation',
        category: 'analytics',
        type: 'boolean',
        defaultValue: false,
        displayOrder: 22
    },
    {
        code: 'delivery_intelligence',
        name: 'Delivery Intelligence',
        description: 'Optimal delivery time prediction',
        category: 'analytics',
        type: 'boolean',
        defaultValue: false,
        displayOrder: 23
    },

    // Automation Features
    {
        code: 'action_engine',
        name: 'Action Engine',
        description: 'Automated actions based on survey responses',
        category: 'automation',
        type: 'boolean',
        defaultValue: false,
        displayOrder: 30
    },
    {
        code: 'actions_monthly',
        name: 'Monthly Actions',
        description: 'Maximum automated actions per month',
        category: 'automation',
        type: 'limit',
        defaultValue: 50,
        unit: 'actions',
        displayOrder: 31
    },
    {
        code: 'incentives',
        name: 'Incentive Management',
        description: 'Manage and distribute incentives',
        category: 'automation',
        type: 'boolean',
        defaultValue: false,
        displayOrder: 32
    },
    {
        code: 'escalation_rules',
        name: 'Escalation Rules',
        description: 'Automated ticket escalation',
        category: 'automation',
        type: 'boolean',
        defaultValue: false,
        displayOrder: 33
    },

    // Branding Features
    {
        code: 'custom_branding',
        name: 'Custom Branding',
        description: 'Custom colors, logos, and styling',
        category: 'branding',
        type: 'boolean',
        defaultValue: false,
        displayOrder: 40
    },
    {
        code: 'white_label',
        name: 'White Label',
        description: 'Complete white-labeling with custom domain',
        category: 'branding',
        type: 'boolean',
        defaultValue: false,
        displayOrder: 41
    },
    {
        code: 'branding_level',
        name: 'Branding Level',
        description: '0=none, 1=basic, 2=advanced, 3=white-label',
        category: 'branding',
        type: 'limit',
        defaultValue: 0,
        displayOrder: 42,
        isPublic: false
    },

    // Integration Features
    {
        code: 'api_access',
        name: 'API Access',
        description: 'Access to REST API',
        category: 'integration',
        type: 'boolean',
        defaultValue: false,
        displayOrder: 50
    },
    {
        code: 'webhooks',
        name: 'Webhooks',
        description: 'Real-time webhook notifications',
        category: 'integration',
        type: 'boolean',
        defaultValue: false,
        displayOrder: 51
    },
    {
        code: 'multi_language',
        name: 'Multi-Language',
        description: 'Multi-language survey support',
        category: 'integration',
        type: 'boolean',
        defaultValue: true,
        displayOrder: 52
    },

    // Support Features
    {
        code: 'priority_support',
        name: 'Priority Support',
        description: '24/7 priority support access',
        category: 'support',
        type: 'boolean',
        defaultValue: false,
        displayOrder: 60
    },
    {
        code: 'sla_management',
        name: 'SLA Management',
        description: 'Service level agreement management',
        category: 'support',
        type: 'boolean',
        defaultValue: false,
        displayOrder: 61
    }
];

async function seedFeatures() {
    try {
        await mongoose.connect(process.env.MONGO_URI);
        console.log('✅ Connected to MongoDB');

        // Clear existing features
        await FeatureDefinition.deleteMany({});
        console.log('🗑️ Cleared existing feature definitions');

        // Insert new features
        const result = await FeatureDefinition.insertMany(features);
        console.log(`✅ Seeded ${result.length} feature definitions`);

        console.log('\n📋 Feature categories:');
        const categories = [...new Set(features.map(f => f.category))];
        categories.forEach(cat => {
            const count = features.filter(f => f.category === cat).length;
            console.log(`   ${cat}: ${count} features`);
        });

        process.exit(0);
    } catch (error) {
        console.error('❌ Seed error:', error.message);
        process.exit(1);
    }
}

if (require.main === module) {
    seedFeatures();
}

module.exports = { features, seedFeatures };
