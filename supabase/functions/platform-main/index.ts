import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';

// Static imports — edge-runtime sandboxes dynamic imports
import eventsRegistration from '../events-registration/index.ts';
import events from '../events/index.ts';
import eventsSearch from '../events-search/index.ts';
import platformGenerateDownloadToken from '../platform-generate-download-token/index.ts';
import peopleProfileUpdate from '../people-profile-update/index.ts';
import emailSend from '../email-send/index.ts';
import emailSendReminders from '../email-send-reminders/index.ts';
import emailSendgridWebhook from '../email-sendgrid-webhook/index.ts';
import peopleSignup from '../people-signup/index.ts';
import platformSetup from '../platform-setup/index.ts';
import adminSendMagicLink from '../admin-send-magic-link/index.ts';
import adminAddFirst from '../admin-add-first/index.ts';

const functions: Record<string, (req: Request) => Response | Promise<Response>> = {
  'events-registration': eventsRegistration,
  'events': events,
  'events-search': eventsSearch,
  'platform-generate-download-token': platformGenerateDownloadToken,
  'people-profile-update': peopleProfileUpdate,
  'email-send': emailSend,
  'email-send-reminders': emailSendReminders,
  'email-sendgrid-webhook': emailSendgridWebhook,
  'people-signup': peopleSignup,
  'platform-setup': platformSetup,
  'admin-send-magic-link': adminSendMagicLink,
  'admin-add-first': adminAddFirst,
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
