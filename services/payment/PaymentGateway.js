// services/payment/PaymentGateway.js
// Abstract interface for payment gateways
// All payment gateways must implement these methods

class PaymentGateway {
    constructor() {
        if (this.constructor === PaymentGateway) {
            throw new Error('PaymentGateway is an abstract class and cannot be instantiated directly');
        }
    }

    /**
     * Get the gateway name
     * @returns {string} Gateway identifier (e.g., 'stripe', 'tap')
     */
    getName() {
        throw new Error('Method getName() must be implemented');
    }

    /**
     * Create a customer in the payment gateway
     * @param {Object} customerData - { email, name, phone, metadata }
     * @returns {Promise<Object>} - { customerId, raw }
     */
    async createCustomer(customerData) {
        throw new Error('Method createCustomer() must be implemented');
    }

    /**
     * Update a customer in the payment gateway
     * @param {string} customerId - Gateway customer ID
     * @param {Object} updateData - { email, name, phone, metadata }
     * @returns {Promise<Object>} - { customerId, raw }
     */
    async updateCustomer(customerId, updateData) {
        throw new Error('Method updateCustomer() must be implemented');
    }

    /**
     * Create a subscription for a customer
     * @param {string} customerId - Gateway customer ID
     * @param {string} priceId - Gateway price ID
     * @param {Object} options - { trialDays, metadata, paymentMethodId }
     * @returns {Promise<Object>} - { subscriptionId, status, currentPeriodEnd, raw }
     */
    async createSubscription(customerId, priceId, options = {}) {
        throw new Error('Method createSubscription() must be implemented');
    }

    /**
     * Update a subscription
     * @param {string} subscriptionId - Gateway subscription ID
     * @param {Object} updateData - { priceId, cancelAtPeriodEnd }
     * @returns {Promise<Object>} - { subscriptionId, status, raw }
     */
    async updateSubscription(subscriptionId, updateData) {
        throw new Error('Method updateSubscription() must be implemented');
    }

    /**
     * Cancel a subscription
     * @param {string} subscriptionId - Gateway subscription ID
     * @param {boolean} immediate - Cancel immediately or at period end
     * @returns {Promise<Object>} - { subscriptionId, status, raw }
     */
    async cancelSubscription(subscriptionId, immediate = false) {
        throw new Error('Method cancelSubscription() must be implemented');
    }

    /**
     * Get subscription details
     * @param {string} subscriptionId - Gateway subscription ID
     * @returns {Promise<Object>} - Subscription details
     */
    async getSubscription(subscriptionId) {
        throw new Error('Method getSubscription() must be implemented');
    }

    /**
     * Create a checkout session for subscription
     * @param {string} customerId - Gateway customer ID
     * @param {string} priceId - Gateway price ID
     * @param {Object} options - { successUrl, cancelUrl, trialDays, metadata }
     * @returns {Promise<Object>} - { sessionId, url, raw }
     */
    async createCheckoutSession(customerId, priceId, options = {}) {
        throw new Error('Method createCheckoutSession() must be implemented');
    }

    /**
     * Create a billing portal session
     * @param {string} customerId - Gateway customer ID
     * @param {string} returnUrl - URL to return to after portal
     * @returns {Promise<Object>} - { url, raw }
     */
    async createBillingPortalSession(customerId, returnUrl) {
        throw new Error('Method createBillingPortalSession() must be implemented');
    }

    /**
     * Get payment methods for a customer
     * @param {string} customerId - Gateway customer ID
     * @returns {Promise<Array>} - Array of payment methods
     */
    async getPaymentMethods(customerId) {
        throw new Error('Method getPaymentMethods() must be implemented');
    }

    /**
     * Handle webhook event
     * @param {Object} payload - Raw webhook payload
     * @param {string} signature - Webhook signature
     * @returns {Promise<Object>} - { event, type, data }
     */
    async handleWebhook(payload, signature) {
        throw new Error('Method handleWebhook() must be implemented');
    }

    /**
     * Refund a payment
     * @param {string} paymentIntentId - Payment intent ID
     * @param {number} amount - Amount to refund (null for full refund)
     * @returns {Promise<Object>} - { refundId, status, raw }
     */
    async refund(paymentIntentId, amount = null) {
        throw new Error('Method refund() must be implemented');
    }
}

module.exports = PaymentGateway;
