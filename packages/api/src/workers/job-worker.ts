import { createWorker } from '../lib/queue.js';
import { getSupabase } from '../lib/supabase.js';

// Email worker
const emailWorker = createWorker('email', async (job) => {
  const { to, subject, html, templateId } = job.data as {
    to: string;
    subject: string;
    html?: string;
    templateId?: string;
  };

  const supabase = getSupabase();

  // Invoke send-email edge function
  const { error } = await supabase.functions.invoke('send-email', {
    body: { to, subject, html, templateId },
  });

  if (error) {
    console.error(`Email job ${job.id} failed:`, error);
    throw error;
  }

  console.log(`Email sent to ${to}: ${subject}`);
});

// Image processing worker
const imageWorker = createWorker('image-processing', async (job) => {
  const { eventId, imageUrl } = job.data as {
    eventId: string;
    imageUrl: string;
  };

  const supabase = getSupabase();
  const { error } = await supabase.functions.invoke('process-single-image', {
    body: { eventId, imageUrl },
  });

  if (error) {
    console.error(`Image processing job ${job.id} failed:`, error);
    throw error;
  }

  console.log(`Image processed for event ${eventId}`);
});

console.log('Gatewaze workers started');

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Shutting down workers...');
  await emailWorker.close();
  await imageWorker.close();
  process.exit(0);
});
