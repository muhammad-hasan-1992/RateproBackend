// services/payment/StripeGateway.js
// Stripe implementation of PaymentGateway interface

const PaymentGateway = require('./PaymentGateway');
const Stripe = require('stripe');

class StripeGateway extends PaymentGateway {
    constructor() {
        super();
        this.stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
        this.webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    }

    getName() {
        return 'stripe';
    }

    async createCustomer(customerData) {
        try {
            const customer = await this.stripe.customers.create({
                email: customerData.email,
                name: customerData.name,
                phone: customerData.phone,
                metadata: {
                    tenantId: customerData.tenantId,
                    ...customerData.metadata
                }
            });

            return {
                customerId: customer.id,
                raw: customer
            };
        } catch (error) {
            console.error('❌ Stripe createCustomer error:', error.message);
            throw new Error(`Stripe customer creation failed: ${error.message}`);
        }
    }

    async updateCustomer(customerId, updateData) {
        try {
            const customer = await this.stripe.customers.update(customerId, {
                email: updateData.email,
                name: updateData.name,
                phone: updateData.phone,
                metadata: updateData.metadata
            });

            return {
                customerId: customer.id,
                raw: customer
            };
        } catch (error) {
            console.error('❌ Stripe updateCustomer error:', error.message);
            throw new Error(`Stripe customer update failed: ${error.message}`);
        }
    }

    async createSubscription(customerId, priceId, options = {}) {
        try {
            const subscriptionData = {
                customer: customerId,
                items: [{ price: priceId }],
                metadata: options.metadata || {}
            };

            // Add trial period if specified
            if (options.trialDays) {
                subscriptionData.trial_period_days = options.trialDays;
            }

            // Use default payment method if specified
            if (options.paymentMethodId) {
                subscriptionData.default_payment_method = options.paymentMethodId;
            }

            // Expand latest invoice for payment status
            subscriptionData.expand = ['latest_invoice.payment_intent'];

            const subscription = await this.stripe.subscriptions.create(subscriptionData);

            return {
                subscriptionId: subscription.id,
                status: subscription.status,
                currentPeriodStart: new Date(subscription.current_period_start * 1000),
                currentPeriodEnd: new Date(subscription.current_period_end * 1000),
                trialEnd: subscription.trial_end ? new Date(subscription.trial_end * 1000) : null,
                raw: subscription
            };
        } catch (error) {
            console.error('❌ Stripe createSubscription error:', error.message);
            throw new Error(`Stripe subscription creation failed: ${error.message}`);
        }
    }

    async updateSubscription(subscriptionId, updateData) {
        try {
            const updateParams = {};

            if (updateData.priceId) {
                // Get current subscription to find the item to update
                const currentSub = await this.stripe.subscriptions.retrieve(subscriptionId);
                updateParams.items = [{
                    id: currentSub.items.data[0].id,
                    price: updateData.priceId
                }];
                // Prorate by default on upgrades
                updateParams.proration_behavior = updateData.prorationBehavior || 'create_prorations';
            }

            if (typeof updateData.cancelAtPeriodEnd !== 'undefined') {
                updateParams.cancel_at_period_end = updateData.cancelAtPeriodEnd;
            }

            if (updateData.metadata) {
                updateParams.metadata = updateData.metadata;
            }

            const subscription = await this.stripe.subscriptions.update(subscriptionId, updateParams);

            return {
                subscriptionId: subscription.id,
                status: subscription.status,
                currentPeriodEnd: new Date(subscription.current_period_end * 1000),
                cancelAtPeriodEnd: subscription.cancel_at_period_end,
                raw: subscription
            };
        } catch (error) {
            console.error('❌ Stripe updateSubscription error:', error.message);
            throw new Error(`Stripe subscription update failed: ${error.message}`);
        }
    }

    async cancelSubscription(subscriptionId, immediate = false) {
        try {
            let subscription;

            if (immediate) {
                subscription = await this.stripe.subscriptions.cancel(subscriptionId);
            } else {
                subscription = await this.stripe.subscriptions.update(subscriptionId, {
                    cancel_at_period_end: true
                });
            }

            return {
                subscriptionId: subscription.id,
                status: subscription.status,
                canceledAt: subscription.canceled_at ? new Date(subscription.canceled_at * 1000) : null,
                cancelAtPeriodEnd: subscription.cancel_at_period_end,
                raw: subscription
            };
        } catch (error) {
            console.error('❌ Stripe cancelSubscription error:', error.message);
            throw new Error(`Stripe subscription cancellation failed: ${error.message}`);
        }
    }

    async getSubscription(subscriptionId) {
        try {
            const subscription = await this.stripe.subscriptions.retrieve(subscriptionId, {
                expand: ['latest_invoice', 'customer', 'default_payment_method']
            });

            return {
                subscriptionId: subscription.id,
                status: subscription.status,
                customerId: subscription.customer.id || subscription.customer,
                priceId: subscription.items.data[0]?.price.id,
                currentPeriodStart: new Date(subscription.current_period_start * 1000),
                currentPeriodEnd: new Date(subscription.current_period_end * 1000),
                cancelAtPeriodEnd: subscription.cancel_at_period_end,
                raw: subscription
            };
        } catch (error) {
            console.error('❌ Stripe getSubscription error:', error.message);
            throw new Error(`Stripe subscription retrieval failed: ${error.message}`);
        }
    }

    async createCheckoutSession(customerId, priceId, options = {}) {
        try {
            const sessionData = {
                customer: customerId,
                mode: 'subscription',
                line_items: [{
                    price: priceId,
                    quantity: 1
                }],
                success_url: options.successUrl || `${process.env.FRONTEND_URL}/subscription/success?session_id={CHECKOUT_SESSION_ID}`,
                cancel_url: options.cancelUrl || `${process.env.FRONTEND_URL}/subscription/cancel`,
                metadata: options.metadata || {}
            };

            if (options.trialDays) {
                sessionData.subscription_data = {
                    trial_period_days: options.trialDays
                };
            }

            const session = await this.stripe.checkout.sessions.create(sessionData);

            return {
                sessionId: session.id,
                url: session.url,
                raw: session
            };
        } catch (error) {
            console.error('❌ Stripe createCheckoutSession error:', error.message);
            throw new Error(`Stripe checkout session creation failed: ${error.message}`);
        }
    }

    async createBillingPortalSession(customerId, returnUrl) {
        try {
            const session = await this.stripe.billingPortal.sessions.create({
                customer: customerId,
                return_url: returnUrl || `${process.env.FRONTEND_URL}/settings/billing`
            });

            return {
                url: session.url,
                raw: session
            };
        } catch (error) {
            console.error('❌ Stripe createBillingPortalSession error:', error.message);
            throw new Error(`Stripe billing portal session creation failed: ${error.message}`);
        }
    }

    async getPaymentMethods(customerId) {
        try {
            const paymentMethods = await this.stripe.paymentMethods.list({
                customer: customerId,
                type: 'card'
            });

            return paymentMethods.data.map(pm => ({
                id: pm.id,
                type: pm.type,
                brand: pm.card.brand,
                last4: pm.card.last4,
                expMonth: pm.card.exp_month,
                expYear: pm.card.exp_year,
                raw: pm
            }));
        } catch (error) {
            console.error('❌ Stripe getPaymentMethods error:', error.message);
            throw new Error(`Stripe payment methods retrieval failed: ${error.message}`);
        }
    }

    async handleWebhook(payload, signature) {
        try {
            if (!this.webhookSecret) {
                // In development, just parse the event directly
                const event = JSON.parse(payload);
                return this._processWebhookEvent(event);
            }

            // Verify webhook signature
            const event = this.stripe.webhooks.constructEvent(
                payload,
                signature,
                this.webhookSecret
            );

            return this._processWebhookEvent(event);
        } catch (error) {
            console.error('❌ Stripe handleWebhook error:', error.message);
            throw new Error(`Webhook verification failed: ${error.message}`);
        }
    }

    _processWebhookEvent(event) {
        // Map Stripe events to our standardized event types
        const eventTypeMap = {
            'customer.subscription.created': 'subscription.created',
            'customer.subscription.updated': 'subscription.updated',
            'customer.subscription.deleted': 'subscription.cancelled',
            'customer.subscription.trial_will_end': 'subscription.trial_ending',
            'invoice.payment_succeeded': 'payment.succeeded',
            'invoice.payment_failed': 'payment.failed',
            'invoice.upcoming': 'invoice.upcoming',
            'checkout.session.completed': 'checkout.completed',
            'checkout.session.expired': 'checkout.expired'
        };

        return {
            event: event,
            type: eventTypeMap[event.type] || event.type,
            data: event.data.object,
            raw: event
        };
    }

    async refund(paymentIntentId, amount = null) {
        try {
            const refundData = {
                payment_intent: paymentIntentId
            };

            if (amount) {
                refundData.amount = Math.round(amount * 100); // Convert to cents
            }

            const refund = await this.stripe.refunds.create(refundData);

            return {
                refundId: refund.id,
                status: refund.status,
                amount: refund.amount / 100, // Convert back to dollars
                raw: refund
            };
        } catch (error) {
            console.error('❌ Stripe refund error:', error.message);
            throw new Error(`Stripe refund failed: ${error.message}`);
        }
    }

    // Stripe-specific helper: Create a setup intent for saving payment methods
    async createSetupIntent(customerId) {
        try {
            const setupIntent = await this.stripe.setupIntents.create({
                customer: customerId,
                payment_method_types: ['card']
            });

            return {
                clientSecret: setupIntent.client_secret,
                raw: setupIntent
            };
        } catch (error) {
            console.error('❌ Stripe createSetupIntent error:', error.message);
            throw new Error(`Stripe setup intent creation failed: ${error.message}`);
        }
    }

    /**
     * Create a Stripe product (with deduplication via metadata search)
     * If a product with the same planCode already exists, returns the existing one.
     */
    async createProduct(productData) {
        try {
            const { name, description, metadata = {} } = productData;

            // ─── Dedup: Search for existing product by planCode metadata ───
            if (metadata.planCode) {
                try {
                    const existing = await this.stripe.products.search({
                        query: `metadata['planCode']:'${metadata.planCode}'`
                    });

                    if (existing.data.length > 0) {
                        const product = existing.data[0];
                        console.log(`♻️ Reusing existing Stripe product: ${product.id} (planCode: ${metadata.planCode})`);

                        // Re-activate if archived
                        if (!product.active) {
                            await this.stripe.products.update(product.id, {
                                active: true,
                                name,
                                description: description || undefined
                            });
                        }

                        return {
                            productId: product.id,
                            reused: true,
                            raw: product
                        };
                    }
                } catch (searchErr) {
                    // Search API may fail in test mode — proceed to create
                    console.warn('⚠️ Stripe product search failed, proceeding to create:', searchErr.message);
                }
            }

            // ─── Create new product ───
            const product = await this.stripe.products.create({
                name,
                description: description || undefined,
                metadata
            });

            console.log(`✅ Stripe product created: ${product.id} (${name})`);

            return {
                productId: product.id,
                reused: false,
                raw: product
            };
        } catch (error) {
            console.error('❌ Stripe createProduct error:', error.message);
            throw new Error(`Stripe product creation failed: ${error.message}`);
        }
    }

    /**
     * Create a recurring Stripe price for a product
     */
    async createPrice(priceData) {
        try {
            const { productId, unitAmount, currency = 'usd', interval } = priceData;

            if (!['month', 'year'].includes(interval)) {
                throw new Error(`Invalid interval: ${interval}. Must be 'month' or 'year'.`);
            }

            const price = await this.stripe.prices.create({
                product: productId,
                unit_amount: unitAmount,  // In cents
                currency: currency.toLowerCase(),
                recurring: { interval }
            });

            console.log(`✅ Stripe price created: ${price.id} (${unitAmount / 100} ${currency}/${interval})`);

            return {
                priceId: price.id,
                raw: price
            };
        } catch (error) {
            console.error('❌ Stripe createPrice error:', error.message);
            throw new Error(`Stripe price creation failed: ${error.message}`);
        }
    }
}

module.exports = StripeGateway;
