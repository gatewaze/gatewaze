Deno.serve(() => new Response(JSON.stringify({ ok: true }), {
  headers: { 'Content-Type': 'application/json' },
}));

export default handler;
if (import.meta.main) Deno.serve(handler);
