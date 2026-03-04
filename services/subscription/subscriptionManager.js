// services/subscription/subscriptionManager.js
// Orchestrates payment gateway + feature flag management
// Flow: PaymentGateway -> SubscriptionManager -> FeatureFlagManager

const PaymentGatewayFactory = require('../payment/PaymentGatewayFactory');
const featureFlagManager = require('./featureFlagManager');
const TenantSubscription = require('../../models/TenantSubscription');
const PlanTemplate = require('../../models/PlanTemplate');
const Tenant = require('../../models/Tenant');
const User = require('../../models/User');
const Log = require('../../models/Logs');
const mongoose = require('mongoose');

class SubscriptionManager {
    constructor() {
        this.gateway = PaymentGatewayFactory.getDefaultGateway();
    }

    /**
     * Set the payment gateway to use
     * @param {string} gatewayName - 'stripe' or 'tap'
     */
    setGateway(gatewayName) {
        this.gateway = PaymentGatewayFactory.getGateway(gatewayName);
    }

    /**
     * Subscribe a tenant to a plan
     * @param {string} tenantId - Tenant ObjectId
     * @param {string} planCode - Plan code to subscribe to
     * @param {Object} options - { billingCycle, paymentMethodId }
     * @returns {Promise<Object>}
     */
    async subscribeToPlan(tenantId, planCode, options = {}) {
        try {
            // 1. Get the plan template
            const plan = await PlanTemplate.getByCode(planCode);
            if (!plan) {
                throw new Error(`Plan not found: ${planCode}`);
            }

            // 2. Get or create subscription record
            let subscription = await TenantSubscription.findOrCreateForTenant(tenantId);

            // 3. Get or create payment gateway customer
            if (!subscription.payment.customerId) {
                const tenant = await Tenant.findById(tenantId).populate('admin', 'email name');

                const customerResult = await this.gateway.createCustomer({
                    email: tenant.contactEmail || tenant.admin.email,
                    name: tenant.name,
                    tenantId: tenantId.toString()
                });

                subscription.payment.gateway = this.gateway.getName();
                subscription.payment.customerId = customerResult.customerId;
                await subscription.save();
            }

            // 4. Get the correct price ID based on billing cycle
            const billingCycle = options.billingCycle || 'monthly';
            const priceId = billingCycle === 'yearly'
                ? plan.stripe?.yearlyPriceId
                : plan.stripe?.monthlyPriceId;

            if (!priceId) {
                // If no Stripe price configured, just apply features without payment
                console.log('⚠️ No Stripe price ID configured, applying plan without payment');
                await subscription.applyPlanFeatures(plan);
                subscription.billing.status = 'active';
                subscription.billing.cycle = billingCycle;
                await subscription.save();

                return {
                    success: true,
                    subscription,
                    message: 'Plan applied without payment (no price configured)'
                };
            }

            // 5. Create payment gateway subscription
            const subResult = await this.gateway.createSubscription(
                subscription.payment.customerId,
                priceId,
                {
                    trialDays: plan.trial?.enabled ? plan.trial.days : 0,
                    metadata: {
                        tenantId: tenantId.toString(),
                        planCode: planCode
                    }
                }
            );

            // 6. Update subscription record
            subscription.payment.subscriptionId = subResult.subscriptionId;
            subscription.billing.status = subResult.status;
            subscription.billing.cycle = billingCycle;
            subscription.billing.currentPeriodStart = subResult.currentPeriodStart;
            subscription.billing.currentPeriodEnd = subResult.currentPeriodEnd;

            if (subResult.trialEnd) {
                subscription.trial.active = true;
                subscription.trial.endsAt = subResult.trialEnd;
            }

            // 7. Apply plan features instantly
            await subscription.applyPlanFeatures(plan);

            // 8. Log the subscription
            await this._logSubscriptionAction(tenantId, 'SUBSCRIPTION_CREATED', {
                planCode,
                billingCycle,
                status: subResult.status
            });

            return {
                success: true,
                subscription,
                gatewaySubscriptionId: subResult.subscriptionId
            };
        } catch (error) {
            console.error('❌ SubscriptionManager.subscribeToPlan error:', error.message);
            throw error;
        }
    }

    /**
     * Upgrade a tenant to a higher plan (instant feature update)
     * @param {string} tenantId - Tenant ObjectId
     * @param {string} newPlanCode - New plan code
     * @returns {Promise<Object>}
     */
    async upgradePlan(tenantId, newPlanCode) {
        try {
            const subscription = await TenantSubscription.findOne({ tenant: tenantId });
            if (!subscription) {
                throw new Error('Subscription not found');
            }

            const newPlan = await PlanTemplate.getByCode(newPlanCode);
            if (!newPlan) {
                throw new Error(`Plan not found: ${newPlanCode}`);
            }

            // Get current plan for comparison
            const currentPlan = await PlanTemplate.findById(subscription.planTemplate);
            const comparison = await featureFlagManager.comparePlanFeatures(
                currentPlan?.code || 'free',
                newPlanCode
            );

            // Update payment gateway subscription if exists
            if (subscription.payment.subscriptionId) {
                const priceId = subscription.billing.cycle === 'yearly'
                    ? newPlan.stripe?.yearlyPriceId
                    : newPlan.stripe?.monthlyPriceId;

                if (priceId) {
                    await this.gateway.updateSubscription(
                        subscription.payment.subscriptionId,
                        { priceId, prorationBehavior: 'create_prorations' }
                    );
                }
            }

            // Apply new plan features immediately
            await subscription.applyPlanFeatures(newPlan);
            subscription.billing.status = 'active';
            await subscription.save();

            // Log upgrade
            await this._logSubscriptionAction(tenantId, 'SUBSCRIPTION_UPGRADED', {
                fromPlan: currentPlan?.code,
                toPlan: newPlanCode,
                addedFeatures: comparison.added.length,
                changedFeatures: comparison.changed.length
            });

            return {
                success: true,
                subscription,
                featureChanges: comparison
            };
        } catch (error) {
            console.error('❌ SubscriptionManager.upgradePlan error:', error.message);
            throw error;
        }
    }

    /**
     * Downgrade a tenant to a lower plan (takes effect at period end)
     * @param {string} tenantId - Tenant ObjectId
     * @param {string} newPlanCode - New plan code
     * @returns {Promise<Object>}
     */
    async downgradePlan(tenantId, newPlanCode) {
        try {
            const subscription = await TenantSubscription.findOne({ tenant: tenantId });
            if (!subscription) {
                throw new Error('Subscription not found');
            }

            const newPlan = await PlanTemplate.getByCode(newPlanCode);
            if (!newPlan) {
                throw new Error(`Plan not found: ${newPlanCode}`);
            }

            // Schedule downgrade at period end
            subscription.billing.pendingPlanCode = newPlanCode;
            subscription.billing.pendingPlanId = newPlan._id;

            // Update gateway subscription to change at period end
            if (subscription.payment.subscriptionId) {
                const priceId = subscription.billing.cycle === 'yearly'
                    ? newPlan.stripe?.yearlyPriceId
                    : newPlan.stripe?.monthlyPriceId;

                if (priceId) {
                    // Stripe will handle the change at period end
                    await this.gateway.updateSubscription(
                        subscription.payment.subscriptionId,
                        { priceId, prorationBehavior: 'none' }
                    );
                }
            }

            await subscription.save();

            // Log downgrade scheduled
            await this._logSubscriptionAction(tenantId, 'SUBSCRIPTION_DOWNGRADE_SCHEDULED', {
                currentPlan: subscription.planCode,
                newPlan: newPlanCode,
                effectiveDate: subscription.billing.currentPeriodEnd
            });

            return {
                success: true,
                subscription,
                message: `Downgrade to ${newPlanCode} scheduled for ${subscription.billing.currentPeriodEnd}`
            };
        } catch (error) {
            console.error('❌ SubscriptionManager.downgradePlan error:', error.message);
            throw error;
        }
    }

    /**
     * Cancel a subscription
     * @param {string} tenantId - Tenant ObjectId
     * @param {boolean} immediate - Cancel immediately or at period end
     * @returns {Promise<Object>}
     */
    async cancelSubscription(tenantId, immediate = false) {
        try {
            const subscription = await TenantSubscription.findOne({ tenant: tenantId });
            if (!subscription) {
                throw new Error('Subscription not found');
            }

            // Cancel in payment gateway
            if (subscription.payment.subscriptionId) {
                await this.gateway.cancelSubscription(
                    subscription.payment.subscriptionId,
                    immediate
                );
            }

            if (immediate) {
                // Apply free plan immediately
                const freePlan = await PlanTemplate.getByCode('free');
                if (freePlan) {
                    await subscription.applyPlanFeatures(freePlan);
                }
                subscription.billing.status = 'cancelled';
            } else {
                subscription.billing.cancelAtPeriodEnd = true;
            }

            await subscription.save();

            // Log cancellation
            await this._logSubscriptionAction(tenantId, 'SUBSCRIPTION_CANCELLED', {
                immediate,
                effectiveDate: immediate ? new Date() : subscription.billing.currentPeriodEnd
            });

            return {
                success: true,
                subscription,
                message: immediate
                    ? 'Subscription cancelled immediately'
                    : `Subscription will be cancelled on ${subscription.billing.currentPeriodEnd}`
            };
        } catch (error) {
            console.error('❌ SubscriptionManager.cancelSubscription error:', error.message);
            throw error;
        }
    }

    /**
     * Create a checkout session for subscription
     * @param {string} tenantId - Tenant ObjectId
     * @param {string} planCode - Plan code
     * @param {Object} options - { billingCycle, successUrl, cancelUrl }
     * @returns {Promise<Object>}
     */
    async createCheckoutSession(tenantId, planCode, options = {}) {
        try {
            const plan = await PlanTemplate.getByCode(planCode);
            if (!plan) {
                throw new Error(`Plan not found: ${planCode}`);
            }

            let subscription = await TenantSubscription.findOrCreateForTenant(tenantId);

            // Ensure customer exists
            if (!subscription.payment.customerId) {
                const tenant = await Tenant.findById(tenantId).populate('admin', 'email name');

                const customerResult = await this.gateway.createCustomer({
                    email: tenant.contactEmail || tenant.admin.email,
                    name: tenant.name,
                    tenantId: tenantId.toString()
                });

                subscription.payment.gateway = this.gateway.getName();
                subscription.payment.customerId = customerResult.customerId;
                await subscription.save();
            }

            const billingCycle = options.billingCycle || 'monthly';
            const priceId = billingCycle === 'yearly'
                ? plan.stripe?.yearlyPriceId
                : plan.stripe?.monthlyPriceId;

            if (!priceId) {
                throw new Error('Price not configured for this plan');
            }

            const session = await this.gateway.createCheckoutSession(
                subscription.payment.customerId,
                priceId,
                {
                    successUrl: options.successUrl,
                    cancelUrl: options.cancelUrl,
                    trialDays: plan.trial?.enabled ? plan.trial.days : 0,
                    metadata: {
                        tenantId: tenantId.toString(),
                        planCode
                    }
                }
            );

            return {
                success: true,
                sessionId: session.sessionId,
                url: session.url
            };
        } catch (error) {
            console.error('❌ SubscriptionManager.createCheckoutSession error:', error.message);
            throw error;
        }
    }

    /**
     * Create a billing portal session
     * @param {string} tenantId - Tenant ObjectId
     * @param {string} returnUrl - URL to return to after portal
     * @returns {Promise<Object>}
     */
    async createBillingPortalSession(tenantId, returnUrl) {
        try {
            const subscription = await TenantSubscription.findOne({ tenant: tenantId });
            if (!subscription?.payment?.customerId) {
                throw new Error('No billing account found');
            }

            const session = await this.gateway.createBillingPortalSession(
                subscription.payment.customerId,
                returnUrl
            );

            return {
                success: true,
                url: session.url
            };
        } catch (error) {
            console.error('❌ SubscriptionManager.createBillingPortalSession error:', error.message);
            throw error;
        }
    }

    /**
     * Handle webhook events from payment gateway
     * @param {string} gateway - Gateway name
     * @param {Object} payload - Raw webhook payload
     * @param {string} signature - Webhook signature
     * @returns {Promise<Object>}
     */
    async handleWebhook(gateway, payload, signature) {
        try {
            this.setGateway(gateway);
            const event = await this.gateway.handleWebhook(payload, signature);

            switch (event.type) {
                case 'checkout.completed':
                    await this._handleCheckoutCompleted(event.data, event.raw);
                    break;
                case 'checkout.expired':
                    await this._handleCheckoutExpired(event.data);
                    break;
                case 'subscription.created':
                case 'subscription.updated':
                    await this._handleSubscriptionUpdate(event.data);
                    break;
                case 'subscription.cancelled':
                    await this._handleSubscriptionCancelled(event.data);
                    break;
                case 'payment.succeeded':
                    await this._handlePaymentSucceeded(event.data);
                    break;
                case 'payment.failed':
                    await this._handlePaymentFailed(event.data);
                    break;
                case 'subscription.trial_ending':
                    await this._handleTrialEnding(event.data);
                    break;
            }

            return { success: true, handled: event.type };
        } catch (error) {
            console.error('❌ SubscriptionManager.handleWebhook error:', error.message);
            throw error;
        }
    }

    // ============ CHECKOUT LIFECYCLE HANDLERS ============

    /**
     * Handle checkout.session.completed — Enterprise Pattern
     * Creates Tenant + promotes User + creates TenantSubscription atomically
     * This is the ONLY place where tenant provisioning happens for paid plans
     */
    async _handleCheckoutCompleted(data, rawEvent) {
        const metadata = data.metadata || {};
        const { userId, planCode, billingCycle, stripeCustomerId } = metadata;

        if (!userId || !planCode) {
            console.error('❌ checkout.completed missing metadata: userId or planCode');
            return;
        }

        // Validate plan from DB (never trust metadata blindly)
        const plan = await PlanTemplate.getByCode(planCode);
        if (!plan) {
            console.error(`❌ checkout.completed: plan not found: ${planCode}`);
            return;
        }

        const user = await User.findById(userId);
        if (!user) {
            console.error(`❌ checkout.completed: user not found: ${userId}`);
            return;
        }

        // Check if already provisioned (idempotency — Stripe retries for 3 days)
        // Guard 1: User already has active tenant
        if (user.tenant) {
            const existingSub = await TenantSubscription.findOne({ tenant: user.tenant });
            if (existingSub && existingSub.billing.status === 'active') {
                console.log(`⚠️ checkout.completed: user ${userId} already provisioned, skipping`);
                return;
            }
        }

        // Guard 2: Stripe subscriptionId already exists (unique sparse index is DB-level safety net)
        if (data.subscription) {
            const dupeSub = await TenantSubscription.findOne({ 'payment.subscriptionId': data.subscription });
            if (dupeSub) {
                console.log(`⚠️ checkout.completed: subscriptionId ${data.subscription} already exists, skipping`);
                return;
            }
        }

        // ─── Atomic provisioning (MongoDB transaction) ───
        const session = await mongoose.startSession();
        session.startTransaction();

        try {
            // 1. Create Tenant
            const tenantDocs = await Tenant.create([{
                admin: user._id,
                name: `${user.name}'s Organization`,
                contactEmail: user.email
            }], { session });
            const tenant = tenantDocs[0];

            // 2. Promote User to companyAdmin
            user.role = 'companyAdmin';
            user.tenant = tenant._id;
            user.companyProfileUpdated = false;
            user.pendingCheckoutSessionId = null;
            await user.save({ session });

            // 3. Create TenantSubscription
            const subscriptionDocs = await TenantSubscription.create([{
                tenant: tenant._id,
                planTemplate: plan._id,
                planCode: plan.code,
                billing: {
                    cycle: billingCycle || 'monthly',
                    status: 'active',
                    currentPeriodStart: data.subscription ? new Date() : undefined,
                    currentPeriodEnd: data.subscription ? undefined : undefined
                },
                payment: {
                    gateway: 'stripe',
                    customerId: stripeCustomerId || data.customer,
                    subscriptionId: data.subscription
                },
                onboardingStatus: 'awaiting_setup',
                createdBy: user._id
            }], { session });

            // 4. Apply plan features
            const subscription = subscriptionDocs[0];
            await subscription.applyPlanFeatures(plan);

            await session.commitTransaction();

            console.log(`✅ Webhook provisioned: user=${userId} → tenant=${tenant._id} → plan=${planCode}`);

            // 5. Log activation
            await this._logSubscriptionAction(tenant._id, 'SUBSCRIPTION_ACTIVATED_VIA_WEBHOOK', {
                planCode,
                billingCycle,
                stripeSessionId: data.id,
                customerId: stripeCustomerId || data.customer
            });

        } catch (error) {
            await session.abortTransaction();
            console.error('❌ checkout.completed provisioning failed:', error.message);
            throw error;
        } finally {
            session.endSession();
        }
    }

    /**
     * Handle checkout.session.expired — clears pending session so user can retry
     */
    async _handleCheckoutExpired(data) {
        const metadata = data.metadata || {};
        const { userId } = metadata;

        if (!userId) return;

        const user = await User.findById(userId);
        if (user && user.pendingCheckoutSessionId) {
            user.pendingCheckoutSessionId = null;
            await user.save();
            console.log(`⚠️ Checkout expired for user ${userId}, cleared pending session`);
        }
    }

    // ============ SUBSCRIPTION LIFECYCLE HANDLERS ============

    async _handleSubscriptionUpdate(data) {
        const subscription = await TenantSubscription.findOne({
            'payment.subscriptionId': data.id
        });

        if (subscription) {
            // Map Stripe status to our status
            const statusMap = {
                'active': 'active',
                'past_due': 'past_due',
                'canceled': 'cancelled',
                'incomplete': 'incomplete',
                'trialing': 'trialing'
            };
            const newStatus = statusMap[data.status] || data.status;

            // Use state machine validation
            try {
                subscription.validateStatusTransition(newStatus);
                subscription.billing.status = newStatus;
            } catch (err) {
                console.warn(`⚠️ Ignoring invalid transition: ${err.message}`);
            }

            if (data.current_period_end) {
                subscription.billing.currentPeriodEnd = new Date(data.current_period_end * 1000);
            }
            if (data.current_period_start) {
                subscription.billing.currentPeriodStart = new Date(data.current_period_start * 1000);
            }
            if (data.cancel_at_period_end) {
                subscription.billing.cancelAtPeriodEnd = true;
                // Use cancel_pending if set to cancel at period end
                if (subscription.billing.status === 'active') {
                    try {
                        subscription.validateStatusTransition('cancel_pending');
                        subscription.billing.status = 'cancel_pending';
                    } catch (err) {
                        console.warn(`⚠️ cancel_pending transition failed: ${err.message}`);
                    }
                }
            }

            await subscription.save();
        }
    }

    async _handleSubscriptionCancelled(data) {
        const subscription = await TenantSubscription.findOne({
            'payment.subscriptionId': data.id
        });

        if (subscription) {
            subscription.billing.status = 'cancelled';

            // Apply free plan
            const freePlan = await PlanTemplate.getByCode('free');
            if (freePlan) {
                await subscription.applyPlanFeatures(freePlan);
            }

            await subscription.save();
        }
    }

    async _handlePaymentSucceeded(data) {
        // Payment succeeded - subscription continues
        console.log('✅ Payment succeeded:', data.id);
    }

    async _handlePaymentFailed(data) {
        const subscription = await TenantSubscription.findOne({
            'payment.customerId': data.customer
        });

        if (subscription) {
            subscription.billing.status = 'past_due';
            await subscription.save();

            // TODO: Send notification to tenant about failed payment
        }
    }

    async _handleTrialEnding(data) {
        // TODO: Send notification about trial ending
        console.log('⚠️ Trial ending for subscription:', data.id);
    }

    async _logSubscriptionAction(tenantId, action, data) {
        try {
            // Convert SUBSCRIPTION_UPGRADED → subscription:upgraded to match schema enum
            const normalizedAction = action
                .replace('SUBSCRIPTION_', 'subscription:')
                .replace('_VIA_WEBHOOK', '')
                .toLowerCase();

            await Log.create({
                tenantId,
                action: normalizedAction,
                message: `Subscription action: ${action}`,
                level: 'INFO',
                functionName: 'SubscriptionManager',
                context: data
            });
        } catch (error) {
            console.error('❌ Failed to log subscription action:', error.message);
        }
    }
}

module.exports = new SubscriptionManager();
