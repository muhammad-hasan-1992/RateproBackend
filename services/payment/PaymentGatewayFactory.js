// services/payment/PaymentGatewayFactory.js
// Factory pattern for creating payment gateway instances

const StripeGateway = require('./StripeGateway');
// const TapGateway = require('./TapGateway'); // Future implementation

class PaymentGatewayFactory {
    static gateways = {};

    /**
     * Get a payment gateway instance by name
     * @param {string} gatewayName - 'stripe' or 'tap'
     * @returns {PaymentGateway} Gateway instance
     */
    static getGateway(gatewayName) {
        const name = gatewayName.toLowerCase();

        // Return cached instance if exists
        if (this.gateways[name]) {
            return this.gateways[name];
        }

        // Create new instance based on name
        switch (name) {
            case 'stripe':
                this.gateways[name] = new StripeGateway();
                break;
            // case 'tap':
            //   this.gateways[name] = new TapGateway();
            //   break;
            default:
                throw new Error(`Unsupported payment gateway: ${gatewayName}`);
        }

        return this.gateways[name];
    }

    /**
     * Get the default payment gateway
     * @returns {PaymentGateway} Default gateway instance
     */
    static getDefaultGateway() {
        const defaultGateway = process.env.DEFAULT_PAYMENT_GATEWAY || 'stripe';
        return this.getGateway(defaultGateway);
    }

    /**
     * Get all supported gateway names
     * @returns {Array<string>} List of supported gateways
     */
    static getSupportedGateways() {
        return ['stripe']; // Add 'tap' when implemented
    }

    /**
     * Check if a gateway is supported
     * @param {string} gatewayName - Gateway name to check
     * @returns {boolean}
     */
    static isSupported(gatewayName) {
        return this.getSupportedGateways().includes(gatewayName.toLowerCase());
    }
}

module.exports = PaymentGatewayFactory;
