import { emailQueue, imageQueue } from '../lib/queue.js';

async function startScheduler() {
  console.log('Gatewaze scheduler started');

  // Example: send reminder emails every hour
  await emailQueue.upsertJobScheduler('send-reminders', {
    every: 3600000, // 1 hour
  }, {
    name: 'send-reminder-emails',
    data: { type: 'reminder' },
  });

  console.log('Scheduled jobs registered');
}

startScheduler().catch((err) => {
  console.error('Scheduler failed to start:', err);
  process.exit(1);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Shutting down scheduler...');
  await emailQueue.close();
  await imageQueue.close();
  process.exit(0);
});
