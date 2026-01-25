// controllers/subscription/webhookController.js
// Webhook handlers for payment gateway events

const subscriptionManager = require('../../services/subscription/subscriptionManager');

/**
 * @desc Handle Stripe webhook events
 * @route POST /api/subscriptions/webhooks/stripe
 * @access Public (verified by signature)
 */
exports.handleStripeWebhook = async (req, res) => {
    try {
        const signature = req.headers['stripe-signature'];
        const payload = req.body; // Raw body for signature verification

        const result = await subscriptionManager.handleWebhook('stripe', payload, signature);

        console.log(`✅ Stripe webhook handled: ${result.handled}`);
        res.status(200).json({ received: true, type: result.handled });
    } catch (error) {
        console.error('❌ Stripe webhook error:', error.message);
        res.status(400).json({
            success: false,
            message: error.message
        });
    }
};

/**
 * @desc Handle Tap webhook events
 * @route POST /api/subscriptions/webhooks/tap
 * @access Public (verified by signature)
 */
exports.handleTapWebhook = async (req, res) => {
    try {
        const signature = req.headers['tap-signature'];
        const payload = req.body;

        const result = await subscriptionManager.handleWebhook('tap', payload, signature);

        console.log(`✅ Tap webhook handled: ${result.handled}`);
        res.status(200).json({ received: true, type: result.handled });
    } catch (error) {
        console.error('❌ Tap webhook error:', error.message);
        res.status(400).json({
            success: false,
            message: error.message
        });
    }
};
