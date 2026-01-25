// controllers/subscription/adminController.js
// Admin-only endpoints for managing plans and features

const FeatureDefinition = require('../../models/FeatureDefinition');
const PlanTemplate = require('../../models/PlanTemplate');
const TenantSubscription = require('../../models/TenantSubscription');
const featureFlagManager = require('../../services/subscription/featureFlagManager');

// ============ FEATURE DEFINITIONS ============

/**
 * @desc Create a new feature definition
 * @route POST /api/admin/features
 * @access Admin only
 */
exports.createFeatureDefinition = async (req, res) => {
    try {
        const featureData = req.body;

        // Validate required fields
        if (!featureData.code || !featureData.name) {
            return res.status(400).json({
                success: false,
                message: 'Feature code and name are required'
            });
        }

        const feature = await FeatureDefinition.create(featureData);

        res.status(201).json({
            success: true,
            message: 'Feature definition created',
            data: feature
        });
    } catch (error) {
        if (error.code === 11000) {
            return res.status(400).json({
                success: false,
                message: 'Feature code already exists'
            });
        }
        console.error('❌ createFeatureDefinition error:', error.message);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

/**
 * @desc Get all feature definitions
 * @route GET /api/admin/features
 * @access Admin only
 */
exports.getAllFeatureDefinitions = async (req, res) => {
    try {
        const features = await FeatureDefinition.find().sort({ category: 1, displayOrder: 1 });

        res.status(200).json({
            success: true,
            data: features
        });
    } catch (error) {
        console.error('❌ getAllFeatureDefinitions error:', error.message);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

/**
 * @desc Update a feature definition
 * @route PUT /api/admin/features/:id
 * @access Admin only
 */
exports.updateFeatureDefinition = async (req, res) => {
    try {
        const { id } = req.params;
        const updateData = req.body;

        const feature = await FeatureDefinition.findByIdAndUpdate(id, updateData, { new: true });

        if (!feature) {
            return res.status(404).json({
                success: false,
                message: 'Feature definition not found'
            });
        }

        res.status(200).json({
            success: true,
            message: 'Feature definition updated',
            data: feature
        });
    } catch (error) {
        console.error('❌ updateFeatureDefinition error:', error.message);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

/**
 * @desc Delete a feature definition
 * @route DELETE /api/admin/features/:id
 * @access Admin only
 */
exports.deleteFeatureDefinition = async (req, res) => {
    try {
        const { id } = req.params;

        const feature = await FeatureDefinition.findByIdAndDelete(id);

        if (!feature) {
            return res.status(404).json({
                success: false,
                message: 'Feature definition not found'
            });
        }

        res.status(200).json({
            success: true,
            message: 'Feature definition deleted'
        });
    } catch (error) {
        console.error('❌ deleteFeatureDefinition error:', error.message);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// ============ PLAN TEMPLATES ============

/**
 * @desc Create a new plan template
 * @route POST /api/admin/plans
 * @access Admin only
 */
exports.createPlanTemplate = async (req, res) => {
    try {
        const planData = {
            ...req.body,
            createdBy: req.user._id
        };

        if (!planData.code || !planData.name) {
            return res.status(400).json({
                success: false,
                message: 'Plan code and name are required'
            });
        }

        const plan = await PlanTemplate.create(planData);

        res.status(201).json({
            success: true,
            message: 'Plan template created',
            data: plan
        });
    } catch (error) {
        if (error.code === 11000) {
            return res.status(400).json({
                success: false,
                message: 'Plan code already exists'
            });
        }
        console.error('❌ createPlanTemplate error:', error.message);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

/**
 * @desc Get all plan templates
 * @route GET /api/admin/plans
 * @access Admin only
 */
exports.getAllPlanTemplates = async (req, res) => {
    try {
        const plans = await PlanTemplate.find()
            .populate('createdBy', 'name email')
            .sort({ displayOrder: 1 });

        res.status(200).json({
            success: true,
            data: plans
        });
    } catch (error) {
        console.error('❌ getAllPlanTemplates error:', error.message);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

/**
 * @desc Get a single plan template
 * @route GET /api/admin/plans/:id
 * @access Admin only
 */
exports.getPlanTemplate = async (req, res) => {
    try {
        const { id } = req.params;
        const plan = await PlanTemplate.findById(id).populate('createdBy', 'name email');

        if (!plan) {
            return res.status(404).json({
                success: false,
                message: 'Plan template not found'
            });
        }

        res.status(200).json({
            success: true,
            data: plan
        });
    } catch (error) {
        console.error('❌ getPlanTemplate error:', error.message);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

/**
 * @desc Update a plan template
 * @route PUT /api/admin/plans/:id
 * @access Admin only
 */
exports.updatePlanTemplate = async (req, res) => {
    try {
        const { id } = req.params;
        const updateData = req.body;

        const plan = await PlanTemplate.findByIdAndUpdate(id, updateData, { new: true });

        if (!plan) {
            return res.status(404).json({
                success: false,
                message: 'Plan template not found'
            });
        }

        res.status(200).json({
            success: true,
            message: 'Plan template updated',
            data: plan
        });
    } catch (error) {
        console.error('❌ updatePlanTemplate error:', error.message);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

/**
 * @desc Delete a plan template
 * @route DELETE /api/admin/plans/:id
 * @access Admin only
 */
exports.deletePlanTemplate = async (req, res) => {
    try {
        const { id } = req.params;

        // Check if any tenants are using this plan
        const subscriptionsUsingPlan = await TenantSubscription.countDocuments({ planTemplate: id });

        if (subscriptionsUsingPlan > 0) {
            return res.status(400).json({
                success: false,
                message: `Cannot delete plan. ${subscriptionsUsingPlan} tenant(s) are using this plan.`
            });
        }

        const plan = await PlanTemplate.findByIdAndDelete(id);

        if (!plan) {
            return res.status(404).json({
                success: false,
                message: 'Plan template not found'
            });
        }

        res.status(200).json({
            success: true,
            message: 'Plan template deleted'
        });
    } catch (error) {
        console.error('❌ deletePlanTemplate error:', error.message);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

// ============ TENANT MANAGEMENT ============

/**
 * @desc Get all tenant subscriptions
 * @route GET /api/admin/subscriptions
 * @access Admin only
 */
exports.getAllTenantSubscriptions = async (req, res) => {
    try {
        const { page = 1, limit = 20, status, planCode } = req.query;

        const filter = {};
        if (status) filter['billing.status'] = status;
        if (planCode) filter.planCode = planCode;

        const subscriptions = await TenantSubscription.find(filter)
            .populate('tenant', 'name contactEmail')
            .populate('planTemplate', 'code name')
            .sort({ createdAt: -1 })
            .limit(parseInt(limit))
            .skip((parseInt(page) - 1) * parseInt(limit));

        const total = await TenantSubscription.countDocuments(filter);

        res.status(200).json({
            success: true,
            data: {
                subscriptions,
                pagination: {
                    current: parseInt(page),
                    pages: Math.ceil(total / parseInt(limit)),
                    total
                }
            }
        });
    } catch (error) {
        console.error('❌ getAllTenantSubscriptions error:', error.message);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

/**
 * @desc Set custom feature for a tenant
 * @route POST /api/admin/subscriptions/:tenantId/features
 * @access Admin only
 */
exports.setTenantCustomFeature = async (req, res) => {
    try {
        const { tenantId } = req.params;
        const { featureCode, value, expiresAt } = req.body;

        if (!featureCode || value === undefined) {
            return res.status(400).json({
                success: false,
                message: 'Feature code and value are required'
            });
        }

        const subscription = await featureFlagManager.setCustomFeature(
            tenantId,
            featureCode,
            value,
            expiresAt ? new Date(expiresAt) : null
        );

        res.status(200).json({
            success: true,
            message: `Custom feature "${featureCode}" set for tenant`,
            data: subscription
        });
    } catch (error) {
        console.error('❌ setTenantCustomFeature error:', error.message);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};

/**
 * @desc Apply a plan to a tenant
 * @route POST /api/admin/subscriptions/:tenantId/apply-plan
 * @access Admin only
 */
exports.applyPlanToTenant = async (req, res) => {
    try {
        const { tenantId } = req.params;
        const { planCode } = req.body;

        if (!planCode) {
            return res.status(400).json({
                success: false,
                message: 'Plan code is required'
            });
        }

        const subscription = await featureFlagManager.applyPlan(tenantId, planCode);

        res.status(200).json({
            success: true,
            message: `Plan "${planCode}" applied to tenant`,
            data: subscription
        });
    } catch (error) {
        console.error('❌ applyPlanToTenant error:', error.message);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
};
