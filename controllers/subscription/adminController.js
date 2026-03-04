// controllers/subscription/adminController.js
// Admin-only endpoints for managing plans and features

const FeatureDefinition = require('../../models/FeatureDefinition');
const PlanTemplate = require('../../models/PlanTemplate');
const TenantSubscription = require('../../models/TenantSubscription');
const featureFlagManager = require('../../services/subscription/featureFlagManager');
const subscriptionManager = require('../../services/subscription/subscriptionManager');

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
 * @desc Create a new plan template (auto-creates Stripe product/prices for paid plans)
 * @route POST /api/admin/plans
 * @access Admin only
 */
exports.createPlanTemplate = async (req, res) => {
    let stripeProductId = null;
    let createdPriceIds = [];

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

        const monthlyPrice = planData.pricing?.monthly || 0;
        const yearlyPrice = planData.pricing?.yearly || 0;
        const currency = planData.pricing?.currency || 'USD';
        const isPaid = monthlyPrice > 0 || yearlyPrice > 0;

        // ─── Auto-create Stripe product + prices for paid plans ───
        if (isPaid) {
            try {
                const gateway = subscriptionManager.gateway;

                // Create (or reuse) Stripe product with planCode metadata for deduplication
                const productResult = await gateway.createProduct({
                    name: planData.name,
                    description: planData.description || `${planData.name} subscription plan`,
                    metadata: { planCode: planData.code }
                });
                stripeProductId = productResult.productId;

                // Initialize stripe field
                planData.stripe = { productId: stripeProductId };

                // Create monthly price if applicable
                if (monthlyPrice > 0) {
                    const monthlyResult = await gateway.createPrice({
                        productId: stripeProductId,
                        unitAmount: Math.round(monthlyPrice * 100),
                        currency: currency.toLowerCase(),
                        interval: 'month'
                    });
                    planData.stripe.monthlyPriceId = monthlyResult.priceId;
                    createdPriceIds.push(monthlyResult.priceId);
                }

                // Create yearly price if applicable
                if (yearlyPrice > 0) {
                    const yearlyResult = await gateway.createPrice({
                        productId: stripeProductId,
                        unitAmount: Math.round(yearlyPrice * 100),
                        currency: currency.toLowerCase(),
                        interval: 'year'
                    });
                    planData.stripe.yearlyPriceId = yearlyResult.priceId;
                    createdPriceIds.push(yearlyResult.priceId);
                }

                console.log(`✅ Stripe auto-configured for plan "${planData.code}":`, planData.stripe);
            } catch (stripeError) {
                // ─── ROLLBACK: Archive any created Stripe resources ───
                console.error('❌ Stripe auto-config failed, rolling back:', stripeError.message);
                await _rollbackStripeResources(stripeProductId, createdPriceIds);

                return res.status(500).json({
                    success: false,
                    message: `Stripe configuration failed: ${stripeError.message}`
                });
            }
        }

        // ─── Save to MongoDB ───
        const plan = await PlanTemplate.create(planData);

        res.status(201).json({
            success: true,
            message: isPaid
                ? 'Plan template created with Stripe product/prices'
                : 'Plan template created (free plan, no Stripe config needed)',
            data: plan
        });
    } catch (error) {
        // DB save failed after Stripe success → rollback Stripe
        if (stripeProductId) {
            console.error('❌ DB save failed after Stripe success, rolling back Stripe resources');
            await _rollbackStripeResources(stripeProductId, createdPriceIds);
        }

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
 * @desc Update a plan template (handles Stripe pricing changes)
 * @route PUT /api/admin/plans/:id
 * @access Admin only
 */
exports.updatePlanTemplate = async (req, res) => {
    try {
        const { id } = req.params;
        const updateData = req.body;

        // Fetch current plan to detect pricing changes
        const currentPlan = await PlanTemplate.findById(id);
        if (!currentPlan) {
            return res.status(404).json({
                success: false,
                message: 'Plan template not found'
            });
        }

        const newMonthly = updateData.pricing?.monthly ?? currentPlan.pricing.monthly;
        const newYearly = updateData.pricing?.yearly ?? currentPlan.pricing.yearly;
        const currency = updateData.pricing?.currency || currentPlan.pricing.currency || 'USD';
        const isPaid = newMonthly > 0 || newYearly > 0;
        const wasPaid = (currentPlan.pricing.monthly > 0 || currentPlan.pricing.yearly > 0);
        const pricingChanged = newMonthly !== currentPlan.pricing.monthly || newYearly !== currentPlan.pricing.yearly;
        const nameChanged = updateData.name && updateData.name !== currentPlan.name;

        // ─── Handle Stripe pricing changes ───
        if (isPaid && pricingChanged) {
            try {
                const gateway = subscriptionManager.gateway;
                let productId = currentPlan.stripe?.productId;

                // If plan was free before → create Stripe product
                if (!productId) {
                    const productResult = await gateway.createProduct({
                        name: updateData.name || currentPlan.name,
                        description: updateData.description || currentPlan.description || `${currentPlan.name} subscription plan`,
                        metadata: { planCode: currentPlan.code }
                    });
                    productId = productResult.productId;
                }

                if (!updateData.stripe) updateData.stripe = { ...currentPlan.stripe?.toObject?.() || {} };
                updateData.stripe.productId = productId;

                // Create new monthly price if changed
                if (newMonthly > 0 && newMonthly !== currentPlan.pricing.monthly) {
                    const monthlyResult = await gateway.createPrice({
                        productId,
                        unitAmount: Math.round(newMonthly * 100),
                        currency: currency.toLowerCase(),
                        interval: 'month'
                    });
                    updateData.stripe.monthlyPriceId = monthlyResult.priceId;
                } else if (newMonthly === 0) {
                    updateData.stripe.monthlyPriceId = null;
                }

                // Create new yearly price if changed
                if (newYearly > 0 && newYearly !== currentPlan.pricing.yearly) {
                    const yearlyResult = await gateway.createPrice({
                        productId,
                        unitAmount: Math.round(newYearly * 100),
                        currency: currency.toLowerCase(),
                        interval: 'year'
                    });
                    updateData.stripe.yearlyPriceId = yearlyResult.priceId;
                } else if (newYearly === 0) {
                    updateData.stripe.yearlyPriceId = null;
                }

                console.log(`✅ Stripe prices updated for plan "${currentPlan.code}":`, updateData.stripe);
            } catch (stripeError) {
                console.error('❌ Stripe update failed:', stripeError.message);
                return res.status(500).json({
                    success: false,
                    message: `Stripe price update failed: ${stripeError.message}`
                });
            }
        } else if (!isPaid && wasPaid && currentPlan.stripe?.productId) {
            // Plan changed from paid → free: clear stripe IDs (keep product archived)
            updateData.stripe = { productId: currentPlan.stripe.productId, monthlyPriceId: null, yearlyPriceId: null };
            console.log(`ℹ️ Plan "${currentPlan.code}" changed to free, Stripe prices cleared`);
        }

        const plan = await PlanTemplate.findByIdAndUpdate(id, updateData, { new: true });

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
 * @desc Delete a plan template (archives Stripe product if exists)
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

        // Archive Stripe product if exists (Stripe doesn't allow deleting products)
        if (plan.stripe?.productId) {
            try {
                const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
                await stripe.products.update(plan.stripe.productId, { active: false });
                console.log(`🗄️ Stripe product archived: ${plan.stripe.productId}`);
            } catch (stripeErr) {
                // Non-critical: plan already deleted from DB
                console.warn('⚠️ Failed to archive Stripe product:', stripeErr.message);
            }
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


// ─── Helper: Rollback Stripe resources on failure ───
async function _rollbackStripeResources(productId, priceIds) {
    try {
        const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

        for (const priceId of priceIds) {
            try {
                await stripe.prices.update(priceId, { active: false });
                console.log(`🗄️ Rollback: archived Stripe price ${priceId}`);
            } catch (e) {
                console.warn(`⚠️ Rollback: failed to archive price ${priceId}:`, e.message);
            }
        }

        if (productId) {
            try {
                await stripe.products.update(productId, { active: false });
                console.log(`🗄️ Rollback: archived Stripe product ${productId}`);
            } catch (e) {
                console.warn(`⚠️ Rollback: failed to archive product ${productId}:`, e.message);
            }
        }
    } catch (e) {
        console.error('❌ Rollback helper failed:', e.message);
    }
}

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
