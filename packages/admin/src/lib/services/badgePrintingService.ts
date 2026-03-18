// @ts-nocheck
/**
 * Badge Printing Service
 * Handles badge generation and printing for events
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { generateBadgeImage, generateBadgePdf, BadgeTemplate } from '../badgeGenerator';
import { printBadge, printBadgeBatch, PrinterConfig, PrintJob } from '../printerIntegration';
import { generateQrAccessToken } from '../qrCode';

export class BadgePrintingService {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Generate badge image for a member at an event
   */
  async generateMemberBadge(
    memberProfileId: string,
    eventId: string,
    templateOverrides?: Partial<BadgeTemplate>
  ) {
    // Get member profile
    const { data: member, error: memberError } = await this.supabase
      .from('member_profiles')
      .select('*')
      .eq('id', memberProfileId)
      .single();

    if (memberError) throw memberError;

    // Get event details
    const { data: event, error: eventError } = await this.supabase
      .from('events')
      .select('*')
      .eq('event_id', eventId)
      .single();

    if (eventError) throw eventError;

    // Generate new QR token for this badge
    const { token, hash } = generateQrAccessToken();
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 60); // 60 days for event badges

    await this.supabase.from('qr_access_tokens').insert({
      member_profile_id: memberProfileId,
      token_hash: hash,
      expires_at: expiresAt.toISOString(),
    });

    // Generate badge image
    const badgeBuffer = await generateBadgeImage(
      {
        qrCodeId: member.qr_code_id,
        fullName: member.full_name,
        company: member.company,
        jobTitle: member.job_title,
        avatarUrl: member.avatar_url,
      },
      {
        eventTitle: event.event_title,
        eventLogo: event.event_logo,
        eventStart: event.event_start,
        eventEnd: event.event_end,
      },
      templateOverrides,
      token
    );

    return { badgeBuffer, qrToken: token };
  }

  /**
   * Print badge on-demand (single badge at check-in)
   */
  async printBadgeOnDemand(
    memberProfileId: string,
    eventId: string,
    printerConfig: PrinterConfig,
    printedBy?: string
  ) {
    // Get registration
    const { data: registration } = await this.supabase
      .from('event_registrations')
      .select('*')
      .eq('member_profile_id', memberProfileId)
      .eq('event_id', eventId)
      .single();

    if (!registration) {
      throw new Error('No registration found');
    }

    // Generate badge
    const { badgeBuffer, qrToken } = await this.generateMemberBadge(
      memberProfileId,
      eventId
    );

    // Create badge print record
    const { data: printRecord, error } = await this.supabase
      .from('badge_prints')
      .insert({
        event_id: eventId,
        member_profile_id: memberProfileId,
        event_registration_id: registration.id,
        print_type: 'check_in',
        printer_id: printerConfig.printerId,
        qr_code_id: (await this.supabase
          .from('member_profiles')
          .select('qr_code_id')
          .eq('id', memberProfileId)
          .single()).data?.qr_code_id,
        printed_by: printedBy,
        print_status: 'queued',
      })
      .select()
      .single();

    if (error) throw error;

    try {
      // Print badge
      await printBadge(badgeBuffer, printerConfig);

      // Update print record
      await this.supabase
        .from('badge_prints')
        .update({
          print_status: 'printed',
          printed_at: new Date().toISOString(),
        })
        .eq('id', printRecord.id);

      // Update registration
      await this.supabase
        .from('event_registrations')
        .update({
          badge_print_status: 'printed',
          badge_printed_count: registration.badge_printed_count + 1,
          last_printed_at: new Date().toISOString(),
        })
        .eq('id', registration.id);

      return { success: true, printRecord };
    } catch (error) {
      // Update print record with error
      await this.supabase
        .from('badge_prints')
        .update({
          print_status: 'failed',
          error_message: error instanceof Error ? error.message : String(error),
        })
        .eq('id', printRecord.id);

      throw error;
    }
  }

  /**
   * Start bulk badge printing job
   */
  async startBulkPrintJob(
    eventId: string,
    printerConfig: PrinterConfig,
    filters?: {
      registrationType?: string;
      onlyUnprinted?: boolean;
    },
    createdBy?: string
  ) {
    // Get registrations to print
    let query = this.supabase
      .from('event_registrations')
      .select('*, member_profile:member_profiles(*)')
      .eq('event_id', eventId)
      .eq('status', 'confirmed');

    if (filters?.registrationType) {
      query = query.eq('registration_type', filters.registrationType);
    }

    if (filters?.onlyUnprinted) {
      query = query.eq('badge_print_status', 'pending');
    }

    const { data: registrations, error } = await query;
    if (error) throw error;

    if (!registrations || registrations.length === 0) {
      throw new Error('No registrations found matching criteria');
    }

    // Create print job
    const { data: printJob, error: jobError } = await this.supabase
      .from('badge_print_jobs')
      .insert({
        event_id: eventId,
        job_type: 'bulk_pre_event',
        status: 'queued',
        total_badges: registrations.length,
        printer_id: printerConfig.printerId,
        printer_location: printerConfig.printerName,
        created_by: createdBy,
      })
      .select()
      .single();

    if (jobError) throw jobError;

    // Process print job in background
    this.processPrintJob(printJob.id, registrations, printerConfig).catch(error => {
      console.error('Print job failed:', error);
    });

    return printJob;
  }

  /**
   * Process a print job (runs in background)
   */
  private async processPrintJob(
    printJobId: string,
    registrations: any[],
    printerConfig: PrinterConfig
  ) {
    // Update job status
    await this.supabase
      .from('badge_print_jobs')
      .update({
        status: 'printing',
        started_at: new Date().toISOString(),
      })
      .eq('id', printJobId);

    const printJobs: PrintJob[] = [];

    // Generate all badges
    for (const registration of registrations) {
      try {
        const { badgeBuffer } = await this.generateMemberBadge(
          registration.member_profile_id,
          registration.event_id
        );

        // Create badge print record
        const { data: printRecord } = await this.supabase
          .from('badge_prints')
          .insert({
            event_id: registration.event_id,
            member_profile_id: registration.member_profile_id,
            event_registration_id: registration.id,
            print_job_id: printJobId,
            print_type: 'pre_event',
            printer_id: printerConfig.printerId,
            qr_code_id: registration.member_profile.qr_code_id,
            print_status: 'queued',
          })
          .select()
          .single();

        if (printRecord) {
          printJobs.push({
            id: printRecord.id,
            imageBuffer: badgeBuffer,
            config: printerConfig,
          });
        }
      } catch (error) {
        console.error('Failed to generate badge:', error);
        await this.supabase
          .from('badge_print_jobs')
          .update({
            failed_count: (await this.supabase
              .from('badge_print_jobs')
              .select('failed_count')
              .eq('id', printJobId)
              .single()).data!.failed_count + 1,
          })
          .eq('id', printJobId);
      }
    }

    // Print all badges
    const results = await printBadgeBatch(printJobs);

    // Update job status
    await this.supabase
      .from('badge_print_jobs')
      .update({
        status: 'completed',
        completed_at: new Date().toISOString(),
        printed_count: results.successful,
        failed_count: results.failed,
      })
      .eq('id', printJobId);

    // Update individual print records
    for (const job of printJobs) {
      const error = results.errors.find(e => e.jobId === job.id);

      await this.supabase
        .from('badge_prints')
        .update({
          print_status: error ? 'failed' : 'printed',
          error_message: error?.error,
          printed_at: error ? null : new Date().toISOString(),
        })
        .eq('id', job.id);

      if (!error) {
        // Update registration
        const printRecord = await this.supabase
          .from('badge_prints')
          .select('event_registration_id')
          .eq('id', job.id)
          .single();

        if (printRecord.data) {
          const registration = await this.supabase
            .from('event_registrations')
            .select('badge_printed_count')
            .eq('id', printRecord.data.event_registration_id)
            .single();

          await this.supabase
            .from('event_registrations')
            .update({
              badge_print_status: 'printed',
              badge_printed_count: (registration.data?.badge_printed_count || 0) + 1,
              last_printed_at: new Date().toISOString(),
            })
            .eq('id', printRecord.data.event_registration_id);
        }
      }
    }

    return results;
  }

  /**
   * Get print job status
   */
  async getPrintJobStatus(printJobId: string) {
    const { data, error } = await this.supabase
      .from('badge_print_jobs')
      .select('*')
      .eq('id', printJobId)
      .single();

    if (error) throw error;
    return data;
  }

  /**
   * Get event print jobs
   */
  async getEventPrintJobs(eventId: string) {
    const { data, error } = await this.supabase
      .from('badge_print_jobs')
      .select('*')
      .eq('event_id', eventId)
      .order('created_at', { ascending: false });

    if (error) throw error;
    return data;
  }

  /**
   * Generate badge PDF for email/download
   */
  async generateBadgePdfForEmail(memberProfileId: string, eventId: string) {
    const { data: member } = await this.supabase
      .from('member_profiles')
      .select('*')
      .eq('id', memberProfileId)
      .single();

    const { data: event } = await this.supabase
      .from('events')
      .select('*')
      .eq('event_id', eventId)
      .single();

    if (!member || !event) {
      throw new Error('Member or event not found');
    }

    const { token } = generateQrAccessToken();

    const pdfBuffer = await generateBadgePdf(
      {
        qrCodeId: member.qr_code_id,
        fullName: member.full_name,
        company: member.company,
        jobTitle: member.job_title,
        avatarUrl: member.avatar_url,
      },
      {
        eventTitle: event.event_title,
        eventLogo: event.event_logo,
      },
      {},
      token
    );

    return { pdfBuffer, fileName: `badge-${member.qr_code_id}.pdf` };
  }
}
