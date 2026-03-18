import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';

// Static imports — edge-runtime sandboxes dynamic imports
import batchSendEmail from '../batch-send-email/index.ts';
import calendar from '../calendar/index.ts';
import discoverCalendars from '../discover-calendars/index.ts';
import eventRegistration from '../event-registration/index.ts';
import events from '../events/index.ts';
import eventsSearch from '../events-search/index.ts';
import generateDownloadToken from '../generate-download-token/index.ts';
import processSingleImage from '../process-single-image/index.ts';
import profileUpdate from '../profile-update/index.ts';
import sendEmail from '../send-email/index.ts';
import sendReminderEmails from '../send-reminder-emails/index.ts';
import sendgridWebhook from '../sendgrid-webhook/index.ts';
import speakerSubmission from '../speaker-submission/index.ts';
import speakerUpdate from '../speaker-update/index.ts';
import userSignup from '../user-signup/index.ts';
import setup from '../setup/index.ts';
import sendMagicLink from '../send-magic-link/index.ts';
import addFirstAdmin from '../add-first-admin/index.ts';

const functions: Record<string, (req: Request) => Response | Promise<Response>> = {
  'batch-send-email': batchSendEmail,
  'calendar': calendar,
  'discover-calendars': discoverCalendars,
  'event-registration': eventRegistration,
  'events': events,
  'events-search': eventsSearch,
  'generate-download-token': generateDownloadToken,
  'process-single-image': processSingleImage,
  'profile-update': profileUpdate,
  'send-email': sendEmail,
  'send-reminder-emails': sendReminderEmails,
  'sendgrid-webhook': sendgridWebhook,
  'speaker-submission': speakerSubmission,
  'speaker-update': speakerUpdate,
  'user-signup': userSignup,
  'setup': setup,
  'send-magic-link': sendMagicLink,
  'add-first-admin': addFirstAdmin,
};

serve(async (req: Request) => {
  const url = new URL(req.url);
  const pathSegments = url.pathname.split('/').filter(Boolean);

  // Route: /functionName or /functions/v1/functionName
  let functionName: string | undefined;

  if (pathSegments.length >= 3 && pathSegments[0] === 'functions' && pathSegments[1] === 'v1') {
    functionName = pathSegments[2];
  } else if (pathSegments.length >= 1) {
    functionName = pathSegments[0];
  }

  const handler = functionName ? functions[functionName] : undefined;

  if (!handler) {
    return new Response(
      JSON.stringify({ error: `Function not found: ${functionName ?? 'unknown'}` }),
      { status: 404, headers: { 'Content-Type': 'application/json' } },
    );
  }

  try {
    return await handler(req);
  } catch (error) {
    console.error(`Error invoking function ${functionName}:`, error);
    return new Response(
      JSON.stringify({ error: `Internal error in function ${functionName}` }),
      { status: 500, headers: { 'Content-Type': 'application/json' } },
    );
  }
});
