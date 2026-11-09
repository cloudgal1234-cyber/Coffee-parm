/*
 * Payment provider registry.
 * Select with the env var PAYMENT_PROVIDER (default: "mock").
 *
 * To add a real provider:
 *   1. Create server/payments/<name>-provider.js implementing the interface
 *      documented in mock-provider.js
 *   2. Register it below
 *   3. Run with PAYMENT_PROVIDER=<name> (+ its API keys in env vars)
 */
const providers = {
  mock: require('./mock-provider'),
  // payplus: require('./payplus-provider'),
  // meshulam: require('./meshulam-provider'),
  // stripe: require('./stripe-provider'),
};

const selected = process.env.PAYMENT_PROVIDER || 'mock';
if (!providers[selected]) {
  throw new Error(`Unknown PAYMENT_PROVIDER "${selected}". Available: ${Object.keys(providers).join(', ')}`);
}

module.exports = providers[selected];
