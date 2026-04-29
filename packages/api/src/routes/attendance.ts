/**
 * Attendance API Routes
 *
 * Provides endpoints for marking event attendance/check-in.
 */

import { type Request, type Response } from 'express';
import { getSupabase } from '../lib/supabase.js';
import { labeledRouter } from '../lib/router-registry.js';
import { requireJwt } from '../lib/auth/require-jwt.js';

export const attendanceRouter = labeledRouter('jwt');
attendanceRouter.use(requireJwt());

const VALID_CHECK_IN_METHODS = ['qr_scan', 'manual_entry', 'badge_scan', 'mobile_app', 'sponsor_booth'];

async function ensureRegistration(eventId: string, email: string) {
  const supabase = getSupabase();

  const { data: customer, error: customerError } = await supabase
    .from('people')
    .select('id')
    .eq('email', email)
    .maybeSingle();

  if (customerError) throw new Error(`Error finding customer: ${customerError.message}`);
  if (!customer) throw new Error(`Customer not found for email: ${email}`);

  const { data: member, error: memberError } = await supabase
    .from('people_profiles')
    .select('id')
    .eq('person_id', customer.id)
    .maybeSingle();

  if (memberError) throw new Error(`Error finding member profile: ${memberError.message}`);
  if (!member) throw new Error(`Member profile not found for customer: ${customer.id}`);

  const { data: registration, error: registrationError } = await supabase
    .from('events_registrations')
    .select('id')
    .eq('event_id', eventId)
    .eq('people_profile_id', member.id)
    .maybeSingle();

  if (registrationError) throw new Error(`Error finding registration: ${registrationError.message}`);
  if (!registration) throw new Error(`No registration found for email ${email} at event ${eventId}`);

  return {
    customer_id: customer.id,
    people_profile_id: member.id,
    registration_id: registration.id,
  };
}

// Mark attendance
attendanceRouter.post('/', async (req: Request, res: Response) => {
  try {
    const {
      event_id,
      email,
      check_in_method = 'manual_entry',
      check_in_location,
      checked_in_by,
      badge_printed_on_site = false,
      sessions_attended = [],
      metadata = {},
      source,
      utm_source,
      utm_medium,
      utm_campaign,
      referrer,
    } = req.body;

    if (!event_id || !email) {
      return res.status(400).json({ success: false, error: 'event_id and email are required' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ success: false, error: 'Invalid email format' });
    }

    if (check_in_method && !VALID_CHECK_IN_METHODS.includes(check_in_method)) {
      return res.status(400).json({ success: false, error: `Invalid check_in_method. Must be one of: ${VALID_CHECK_IN_METHODS.join(', ')}` });
    }

    // Async mode
    if (req.body.async === true) {
      res.json({ success: true, message: 'Attendance check-in queued for processing', email, event_id });
      markAttendance(req.body).catch(err => console.error('Async attendance failed:', err.message));
      return;
    }

    const result = await markAttendance(req.body);
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ success: false, error: error.message });
  }
});

// Bulk attendance
attendanceRouter.post('/bulk', async (req: Request, res: Response) => {
  try {
    const { attendees } = req.body;

    if (!Array.isArray(attendees) || attendees.length === 0) {
      return res.status(400).json({ success: false, error: 'attendees array required' });
    }

    const results: any[] = [];
    for (const attendee of attendees) {
      try {
        const result = await markAttendance(attendee);
        results.push({ email: attendee.email, ...result });
      } catch (error: any) {
        results.push({ email: attendee.email, success: false, error: error.message });
      }
    }

    const succeeded = results.filter(r => r.success).length;
    const failed = results.filter(r => !r.success).length;

    res.json({ success: true, total: attendees.length, succeeded, failed, results });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});

async function markAttendance(attendanceData: any) {
  const {
    event_id,
    email,
    check_in_method = 'manual_entry',
    check_in_location,
    checked_in_by,
    badge_printed_on_site = false,
    sessions_attended = [],
    metadata = {},
    source,
    utm_source,
    utm_medium,
    utm_campaign,
    referrer,
  } = attendanceData;

  const { people_profile_id, registration_id } = await ensureRegistration(event_id, email);
  const supabase = getSupabase();

  // Check existing attendance
  const { data: existing } = await supabase
    .from('events_attendance')
    .select('id, checked_in_at')
    .eq('event_id', event_id)
    .eq('people_profile_id', people_profile_id)
    .maybeSingle();

  if (existing) {
    const updates: any = { attendance_metadata: metadata };
    if (check_in_location !== undefined) updates.check_in_location = check_in_location;
    if (checked_in_by !== undefined) updates.checked_in_by = checked_in_by;
    if (badge_printed_on_site !== undefined) updates.badge_printed_on_site = badge_printed_on_site;
    if (sessions_attended.length > 0) updates.sessions_attended = sessions_attended;
    if (badge_printed_on_site === true) updates.badge_printed_at = new Date().toISOString();
    if (source !== undefined) updates.source = source;
    if (utm_source !== undefined) updates.utm_source = utm_source;
    if (utm_medium !== undefined) updates.utm_medium = utm_medium;
    if (utm_campaign !== undefined) updates.utm_campaign = utm_campaign;
    if (referrer !== undefined) updates.referrer = referrer;

    const { error } = await supabase.from('events_attendance').update(updates).eq('id', existing.id);
    if (error) throw new Error(`Failed to update attendance: ${error.message}`);

    return {
      success: true,
      attendance_id: existing.id,
      people_profile_id,
      registration_id,
      already_checked_in: true,
      checked_in_at: existing.checked_in_at,
    };
  }

  // Create new record
  const insertData: any = {
    event_id,
    people_profile_id,
    event_registration_id: registration_id,
    check_in_method,
    check_in_location,
    checked_in_by,
    badge_printed_on_site,
    sessions_attended: sessions_attended.length > 0 ? sessions_attended : null,
    attendance_metadata: metadata,
    checked_in_at: new Date().toISOString(),
  };

  if (badge_printed_on_site) insertData.badge_printed_at = new Date().toISOString();
  if (source) insertData.source = source;
  else if (utm_source) insertData.source = utm_source;
  if (utm_source) insertData.utm_source = utm_source;
  if (utm_medium) insertData.utm_medium = utm_medium;
  if (utm_campaign) insertData.utm_campaign = utm_campaign;
  if (referrer) insertData.referrer = referrer;

  const { data: attendance, error } = await supabase
    .from('events_attendance')
    .insert(insertData)
    .select()
    .single();

  if (error) throw new Error(`Failed to create attendance: ${error.message}`);

  return {
    success: true,
    attendance_id: attendance.id,
    people_profile_id,
    registration_id,
    already_checked_in: false,
    checked_in_at: attendance.checked_in_at,
  };
}
