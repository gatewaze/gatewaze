const handler = (_req: Request): Response => new Response(JSON.stringify({ ok: true }), {
  headers: { 'Content-Type': 'application/json' },
});

export default handler;
Deno.serve(handler);
