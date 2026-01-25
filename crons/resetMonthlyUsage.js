// crons/resetMonthlyUsage.js
// Cron job to reset monthly usage counters on the 1st of each month

const cron = require('node-cron');
const usageLimitsService = require('../services/subscription/usageLimitsService');

/**
 * Schedule monthly usage reset
 * Runs at 00:00 on the 1st day of every month
 */
function scheduleMonthlyUsageReset() {
  // At 00:00 on day-of-month 1
  cron.schedule('0 0 1 * *', async () => {
    console.log('🔄 Starting monthly usage reset...');
    
    try {
      const result = await usageLimitsService.resetAllMonthlyUsage();
      console.log(`✅ Monthly usage reset completed. ${result.count} subscriptions updated.`);
    } catch (error) {
      console.error('❌ Monthly usage reset failed:', error.message);
    }
  }, {
    timezone: 'UTC'
  });

  console.log('📅 Monthly usage reset cron scheduled (1st of each month at 00:00 UTC)');
}

module.exports = { scheduleMonthlyUsageReset };
