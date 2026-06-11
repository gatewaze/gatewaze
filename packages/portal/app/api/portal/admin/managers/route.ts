/**
 * §9.10 portal-manager provisioning — promote a portal member to a `portal_manager` and list
 * existing managers. Admin-only: the SECURITY DEFINER RPC `portal_promote_to_manager` is the
 * authoritative authz boundary (super_admin OR active admin/editor holding `permissions`); this
 * handler additionally gates reads. Uses the §9.5 error envelope + an x-request-id (§9.8).
 *
 * Scope note: feature/row grants are assigned via the existing admin permissions UI against the
 * returned profile id (spec §6 provisioning-UX). PATCH/DELETE grant-lifecycle is a follow-up.
 */
import { NextResponse, type NextRequest } from 'next/server'
import { getServerBrandConfig } from '@/config/brand'
import { createAuthenticatedServerSupabase } from '@/lib/supabase/server'

type ErrCode = 'unauthorized' | 'forbidden' | 'validation_error' | 'conflict' | 'not_found' | 'internal_error'

function reqId(req: NextRequest): string {
  const inbound = req.headers.get('x-request-id')
  return inbound && /^[\w-]{1,64}$/.test(inbound) ? inbound : crypto.randomUUID()
}
function fail(code: ErrCode, message: string, status: number, requestId: string, details?: unknown) {
  return NextResponse.json({ error: { code, message, requestId, details } }, { status, headers: { 'x-request-id': requestId } })
}
function ok(data: unknown, requestId: string, status = 200) {
  return NextResponse.json(data, { status, headers: { 'x-request-id': requestId } })
}

/** Map the promotion RPC's raised exceptions to §9.5 status codes. */
function mapRpcError(msg: string): { code: ErrCode; status: number } {
  if (msg.includes('insufficient_privilege')) return { code: 'forbidden', status: 403 }
  if (msg.includes('email_already_linked_to_different_user')) return { code: 'conflict', status: 409 }
  if (msg.includes('user_email_mismatch')) return { code: 'conflict', status: 409 }
  if (msg.includes('profile_exists_with_higher_role')) return { code: 'conflict', status: 409 }
  if (msg.includes('duplicate_email_profiles')) return { code: 'conflict', status: 409 }
  if (msg.includes('invalid_email')) return { code: 'validation_error', status: 400 }
  if (msg.includes('user_not_found')) return { code: 'not_found', status: 404 }
  return { code: 'internal_error', status: 500 }
}

async function authorizedProvisioner(req: NextRequest) {
  const brand = (await getServerBrandConfig()).id
  const supabase = await createAuthenticatedServerSupabase(brand)
  const { data: userRes } = await supabase.auth.getUser()
  const user = userRes.user
  if (!user) return { supabase, user: null, allowed: false }
  const [superRes, permRes] = await Promise.all([
    supabase.rpc('is_super_admin'),
    supabase.rpc('admin_has_feature_permission', { p_admin_id: user.id, p_feature: 'permissions', p_account_id: null }),
  ])
  const allowed = superRes.data === true || permRes.data === true
  return { supabase, user, allowed }
}

/** GET — list portal managers (auditability; they're hidden from admin-SPA user lists). */
export async function GET(req: NextRequest) {
  const requestId = reqId(req)
  const { supabase, user, allowed } = await authorizedProvisioner(req)
  if (!user) return fail('unauthorized', 'Sign in required.', 401, requestId)
  if (!allowed) return fail('forbidden', 'Requires permissions management access.', 403, requestId)

  const { data, error } = await supabase
    .from('admin_profiles')
    .select('id, email, name, is_active, created_at')
    .eq('role', 'portal_manager')
    .order('created_at', { ascending: false })
  if (error) return fail('internal_error', 'Failed to list managers.', 500, requestId)
  return ok({ data: data ?? [] }, requestId)
}

/** POST — promote a portal member to portal_manager (mints/activates the admin_profiles row). */
export async function POST(req: NextRequest) {
  const requestId = reqId(req)
  let body: { email?: unknown }
  try {
    body = await req.json()
  } catch {
    return fail('validation_error', 'Invalid JSON body.', 400, requestId)
  }
  const email = typeof body.email === 'string' ? body.email.trim() : ''
  if (!email) return fail('validation_error', 'email is required.', 400, requestId)

  const { supabase, user, allowed } = await authorizedProvisioner(req)
  if (!user) return fail('unauthorized', 'Sign in required.', 401, requestId)
  if (!allowed) return fail('forbidden', 'Requires permissions management access.', 403, requestId)

  // Resolve the target auth user by email (must already exist — we never create auth users, NG3).
  const { data: targetId, error: lookupErr } = await supabase.rpc('admin_get_auth_user_id_by_email', { p_email: email })
  if (lookupErr) return fail('internal_error', 'Lookup failed.', 500, requestId)
  if (!targetId) return fail('not_found', 'No account exists for that email.', 404, requestId)

  // Promote (RPC enforces actor authz + identity integrity + audit).
  const { data: profileId, error: promoteErr } = await supabase.rpc('portal_promote_to_manager', {
    p_user_id: targetId,
    p_email: email,
  })
  if (promoteErr) {
    const { code, status } = mapRpcError(promoteErr.message || '')
    return fail(code, status === 500 ? 'Promotion failed.' : promoteErr.message, status, requestId)
  }

  return ok({ data: { adminId: profileId, email, role: 'portal_manager' } }, requestId, 201)
}
