/*
 * Mock payment provider — simulates a successful charge. NOTHING is charged.
 *
 * Every provider implements the same interface:
 *
 *   async createPayment({ orderId, amount, currency, customer, description, returnUrl })
 *     -> { status: 'paid',     transactionId }          // charged immediately
 *     -> { status: 'redirect', transactionId, url }     // send customer to a hosted payment page
 *     -> { status: 'failed',   error }
 *
 *   async verifyCallback(req, body)   // optional: for webhook / IPN from the provider
 *     -> { orderId, transactionId, paid: boolean }
 *
 * Real providers (PayPlus, Meshulam/Grow, Stripe) use a hosted page or hosted fields,
 * so raw card numbers never reach this server. See README for wiring one in.
 */
const crypto = require('crypto');

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

module.exports = {
  name: 'mock',

  async createPayment({ amount, customer }) {
    await wait(900); // feel like a real network round-trip

    // Test hook: a card ending with 0000 simulates a decline
    if (customer && customer.cardLast4 === '0000') {
      return { status: 'failed', error: 'העסקה נדחתה (כרטיס בדיקה 0000)' };
    }
    if (!(amount > 0)) return { status: 'failed', error: 'סכום לא תקין' };

    return { status: 'paid', transactionId: 'MOCK-' + crypto.randomBytes(5).toString('hex').toUpperCase() };
  },

  async verifyCallback() {
    throw new Error('mock provider has no callbacks');
  },
};
