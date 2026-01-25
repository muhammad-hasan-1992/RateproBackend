// services/subscription/subscriptionManager.js
// Orchestrates payment gateway + feature flag management
// Flow: PaymentGateway -> SubscriptionManager -> FeatureFlagManager

const PaymentGatewayFactory = require('../payment/PaymentGatewayFactory');
const featureFlagManager = require('./featureFlagManager');
const TenantSubscription = require('../../models/TenantSubscription');
const PlanTemplate = require('../../models/PlanTemplate');
const Tenant = require('../../models/Tenant');
const Log = require('../../models/Logs');

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

    // Private helper methods

    async _handleSubscriptionUpdate(data) {
        const subscription = await TenantSubscription.findOne({
            'payment.subscriptionId': data.id
        });

        if (subscription) {
            subscription.billing.status = data.status;
            subscription.billing.currentPeriodEnd = new Date(data.current_period_end * 1000);
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
            await Log.create({
                tenantId,
                action,
                description: `Subscription action: ${action}`,
                status: 'success',
                logLevel: 'INFO',
                functionName: 'SubscriptionManager',
                additionalData: data
            });
        } catch (error) {
            console.error('❌ Failed to log subscription action:', error.message);
        }
    }
}

module.exports = new SubscriptionManager();
