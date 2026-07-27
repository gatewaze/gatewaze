/**
 * ChatGPT keeps its connectors in the web app — there is no local config file
 * to edit, so all we can do is walk the user through it.
 */
export function chatgptInstructions(name: string, serverUrl: string): string[] {
  return [
    'ChatGPT connectors are managed in the web app; add this one by hand:',
    '  1. Open ChatGPT and go to Settings -> Connectors.',
    '  2. Click "Add" (Create a custom connector).',
    `  3. Name it "${name}" and paste the server URL: ${serverUrl}`,
    '  4. Save, then sign in when the browser window opens.',
  ];
}
