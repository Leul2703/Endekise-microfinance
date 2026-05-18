const cron = require('node-cron');
const { processGrowthTermReminders } = require('../utils/growthTermDeposits');

cron.schedule('5 8 * * *', async () => {
  console.log('[GROWTH TERM SCHEDULER] Running deposit reminders at', new Date().toISOString());
  try {
    await processGrowthTermReminders();
  } catch (error) {
    console.error('[GROWTH TERM SCHEDULER] Error:', error);
  }
});

console.log('[GROWTH TERM SCHEDULER] Growth Term deposit reminder scheduler initialized');
