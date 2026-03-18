/**
 * Event Budget Service
 * Handles event budget tracking, cost management, revenue tracking, and P&L reporting
 */

import { SupabaseClient } from '@supabase/supabase-js';

// ============================================================================
// Types
// ============================================================================

export type CategoryType = 'marketing' | 'venue' | 'catering' | 'av' | 'supplier' | 'other';
export type LineItemStatus = 'pending' | 'approved' | 'paid' | 'cancelled';
export type PaymentStatus = 'unpaid' | 'partial' | 'paid' | 'refunded';
export type RevenueSourceType = 'stripe' | 'external' | 'sponsorship' | 'other';
export type RevenueStatus = 'pending' | 'confirmed' | 'refunded' | 'partial_refund';
export type SponsorPaymentStatus = 'pending' | 'partial' | 'paid' | 'overdue' | 'cancelled';

export interface BudgetCategory {
  id: string;
  name: string;
  slug: string;
  parent_category_id: string | null;
  category_type: CategoryType;
  description: string | null;
  icon: string | null;
  color: string | null;
  display_order: number;
  registration_source_value: string | null;
  registration_source_pattern: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface EventBudget {
  id: string;
  event_id: string;
  category_id: string;
  planned_amount: number;
  currency: string;
  notes: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  // Joined fields
  category?: BudgetCategory;
}

export interface BudgetLineItem {
  id: string;
  event_id: string;
  category_id: string;
  description: string;
  vendor_name: string | null;
  amount: number;
  currency: string;
  quantity: number;
  unit_cost: number | null;
  status: LineItemStatus;
  payment_status: PaymentStatus;
  payment_date: string | null;
  payment_reference: string | null;
  expense_date: string | null;
  due_date: string | null;
  invoice_url: string | null;
  receipt_url: string | null;
  contract_url: string | null;
  metadata: Record<string, unknown>;
  notes: string | null;
  internal_notes: string | null;
  supplier_id: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
  updated_by: string | null;
  // Joined fields
  category?: BudgetCategory;
}

export interface Supplier {
  id: string;
  name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  website: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  country: string;
  tax_id: string | null;
  payment_terms: string | null;
  supplier_type: string | null;
  services_offered: string[] | null;
  rating: number | null;
  notes: string | null;
  is_active: boolean;
  is_preferred: boolean;
  created_at: string;
  updated_at: string;
}

export interface EventRevenue {
  id: string;
  event_id: string;
  source_type: RevenueSourceType;
  source_name: string | null;
  description: string;
  ticket_type: string | null;
  gross_amount: number;
  fees: number;
  net_amount: number; // Computed column
  currency: string;
  quantity: number;
  unit_price: number | null;
  external_reference: string | null;
  stripe_payment_intent_id: string | null;
  stripe_invoice_id: string | null;
  revenue_date: string;
  refund_amount: number;
  refund_date: string | null;
  status: RevenueStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

export interface SponsorPayment {
  id: string;
  event_sponsor_id: string;
  event_id: string;
  sponsor_id: string;
  description: string;
  sponsorship_package: string | null;
  contracted_amount: number;
  paid_amount: number;
  currency: string;
  payment_status: SponsorPaymentStatus;
  invoice_number: string | null;
  invoice_date: string | null;
  due_date: string | null;
  payment_date: string | null;
  payment_method: string | null;
  external_reference: string | null;
  stripe_payment_intent_id: string | null;
  stripe_invoice_id: string | null;
  contract_url: string | null;
  invoice_url: string | null;
  notes: string | null;
  internal_notes: string | null;
  created_at: string;
  updated_at: string;
  created_by: string | null;
}

// Input types for creating/updating
export interface CreateBudgetInput {
  event_id: string;
  category_id: string;
  planned_amount: number;
  currency?: string;
  notes?: string;
  created_by?: string;
}

export interface CreateLineItemInput {
  event_id: string;
  category_id: string;
  description: string;
  amount: number;
  vendor_name?: string;
  currency?: string;
  quantity?: number;
  unit_cost?: number;
  status?: LineItemStatus;
  payment_status?: PaymentStatus;
  payment_date?: string;
  payment_reference?: string;
  expense_date?: string;
  due_date?: string;
  invoice_url?: string;
  receipt_url?: string;
  contract_url?: string;
  metadata?: Record<string, unknown>;
  notes?: string;
  internal_notes?: string;
  supplier_id?: string;
  created_by?: string;
}

export interface CreateRevenueInput {
  event_id: string;
  source_type: RevenueSourceType;
  source_name?: string;
  description: string;
  ticket_type?: string;
  gross_amount: number;
  fees?: number;
  currency?: string;
  quantity?: number;
  unit_price?: number;
  external_reference?: string;
  stripe_payment_intent_id?: string;
  stripe_invoice_id?: string;
  revenue_date: string;
  status?: RevenueStatus;
  notes?: string;
  created_by?: string;
}

export interface CreateSponsorPaymentInput {
  event_sponsor_id: string;
  event_id: string;
  sponsor_id: string;
  description: string;
  sponsorship_package?: string;
  contracted_amount: number;
  paid_amount?: number;
  currency?: string;
  payment_status?: SponsorPaymentStatus;
  invoice_number?: string;
  invoice_date?: string;
  due_date?: string;
  payment_date?: string;
  payment_method?: string;
  external_reference?: string;
  stripe_payment_intent_id?: string;
  stripe_invoice_id?: string;
  contract_url?: string;
  invoice_url?: string;
  notes?: string;
  internal_notes?: string;
  created_by?: string;
}

// Report types
export interface BudgetSummary {
  event_id: string;
  total_planned: number;
  total_actual: number;
  by_category_type: Array<{
    category_type: CategoryType;
    planned: number;
    actual: number;
  }>;
  by_category: Array<{
    category_id: string;
    category_name: string;
    category_type: CategoryType;
    color: string;
    planned: number;
    actual: number;
    line_item_count: number;
  }>;
}

export interface BreakdownItem {
  country?: string;
  job_title?: string;
  count: number;
}

export interface MarketingCPASource {
  source: string;
  category_name: string;
  category_id: string;
  color: string;
  is_pattern?: boolean;
  planned_budget: number;
  actual_spend: number;
  registrations: number;
  attendees: number;
  cpa_registration: number | null;
  cpa_attendee: number | null;
  registrations_by_country?: BreakdownItem[];
  attendees_by_country?: BreakdownItem[];
  registrations_by_job_title?: BreakdownItem[];
  attendees_by_job_title?: BreakdownItem[];
}

export interface MarketingCPA {
  event_id: string;
  sources: MarketingCPASource[];
}

export interface ProfitLoss {
  event_id: string;
  ticket_revenue: {
    gross_total: number;
    fees: number;
    net_total: number;
    refunds: number;
    adjusted_net: number;
    by_source: Array<{
      source_type: string;
      source_name: string;
      gross: number;
      fees: number;
      net: number;
      refunds: number;
      quantity: number;
    }>;
    by_ticket_type: Array<{
      ticket_type: string;
      gross: number;
      net: number;
      quantity: number;
    }>;
  };
  sponsor_revenue: {
    event_id: string;
    total_contracted: number;
    total_paid: number;
    total_outstanding: number;
    by_tier: Array<{
      sponsorship_tier: string;
      sponsor_count: number;
      contracted: number;
      paid: number;
    }>;
    by_sponsor: Array<{
      sponsor_name: string;
      sponsor_id: string;
      sponsorship_tier: string;
      contracted: number;
      paid: number;
      outstanding: number;
      statuses: string[];
    }>;
    payment_status_summary: Record<string, number>;
  };
  total_revenue: {
    ticket_net: number;
    sponsor_contracted: number;
    sponsor_paid: number;
    total_contracted: number;
    total_received: number;
  };
  costs: {
    total: number;
    by_category_type: Array<{
      category_type: CategoryType;
      total: number;
    }>;
    by_category: Array<{
      category_name: string;
      category_type: CategoryType;
      color: string;
      total: number;
      line_item_count: number;
    }>;
    planned_total: number;
  };
  summary: {
    total_revenue_contracted: number;
    total_revenue_received: number;
    total_costs: number;
    gross_profit_contracted: number;
    gross_profit_received: number;
    profit_margin_contracted: number | null;
    profit_margin_received: number | null;
    outstanding_sponsor_payments: number;
  };
  marketing_roi: {
    marketing_spend: number;
    attributed_revenue: number;
    roi_percentage: number | null;
  };
}

// ============================================================================
// Service Class
// ============================================================================

export class BudgetService {
  constructor(private supabase: SupabaseClient) {}

  // --------------------------------------------------------------------------
  // Budget Categories
  // --------------------------------------------------------------------------

  /**
   * Get all active budget categories
   */
  async getCategories(options?: { categoryType?: CategoryType; includeInactive?: boolean }) {
    let query = this.supabase
      .from('event_budget_categories')
      .select('*')
      .order('display_order', { ascending: true });

    if (options?.categoryType) {
      query = query.eq('category_type', options.categoryType);
    }

    if (!options?.includeInactive) {
      query = query.eq('is_active', true);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data as BudgetCategory[];
  }

  /**
   * Get categories by type for UI filtering
   */
  async getCategoriesByType() {
    const categories = await this.getCategories();
    const grouped: Record<CategoryType, BudgetCategory[]> = {
      marketing: [],
      venue: [],
      catering: [],
      av: [],
      supplier: [],
      other: [],
    };

    for (const category of categories) {
      if (grouped[category.category_type]) {
        grouped[category.category_type].push(category);
      }
    }

    return grouped;
  }

  /**
   * Get marketing categories (those linked to registration sources)
   */
  async getMarketingCategories() {
    const { data, error } = await this.supabase
      .from('event_budget_categories')
      .select('*')
      .eq('category_type', 'marketing')
      .eq('is_active', true)
      .not('registration_source_value', 'is', null)
      .order('display_order', { ascending: true });

    if (error) throw error;
    return data as BudgetCategory[];
  }

  /**
   * Create a new budget category
   */
  async createCategory(input: Partial<BudgetCategory>) {
    const { data, error } = await this.supabase
      .from('event_budget_categories')
      .insert(input)
      .select()
      .single();

    if (error) throw error;
    return data as BudgetCategory;
  }

  /**
   * Update an existing budget category
   */
  async updateCategory(id: string, input: Partial<BudgetCategory>) {
    const { data, error } = await this.supabase
      .from('event_budget_categories')
      .update(input)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data as BudgetCategory;
  }

  /**
   * Soft delete a budget category (set is_active to false)
   */
  async deactivateCategory(id: string) {
    const { error } = await this.supabase
      .from('event_budget_categories')
      .update({ is_active: false })
      .eq('id', id);

    if (error) throw error;
  }

  /**
   * Permanently delete a budget category
   */
  async deleteCategory(id: string) {
    const { error } = await this.supabase
      .from('event_budget_categories')
      .delete()
      .eq('id', id);

    if (error) throw error;
  }

  // --------------------------------------------------------------------------
  // Event Budgets (Planned amounts per category)
  // --------------------------------------------------------------------------

  /**
   * Get all budgets for an event
   */
  async getEventBudgets(eventId: string) {
    const { data, error } = await this.supabase
      .from('event_budget_allocations')
      .select(`
        *,
        category:event_budget_categories(*)
      `)
      .eq('event_id', eventId);

    if (error) throw error;
    return data as EventBudget[];
  }

  /**
   * Set/update a budget for an event category
   */
  async upsertBudget(input: CreateBudgetInput) {
    const { data, error } = await this.supabase
      .from('event_budget_allocations')
      .upsert(
        {
          event_id: input.event_id,
          category_id: input.category_id,
          planned_amount: input.planned_amount,
          currency: input.currency || 'USD',
          notes: input.notes,
          created_by: input.created_by,
        },
        {
          onConflict: 'event_id,category_id',
        }
      )
      .select()
      .single();

    if (error) throw error;
    return data as EventBudget;
  }

  /**
   * Bulk update budgets for an event
   */
  async bulkUpsertBudgets(
    eventId: string,
    budgets: Array<{ category_id: string; planned_amount: number }>,
    createdBy?: string
  ) {
    const records = budgets.map((b) => ({
      event_id: eventId,
      category_id: b.category_id,
      planned_amount: b.planned_amount,
      currency: 'USD',
      created_by: createdBy,
    }));

    const { data, error } = await this.supabase
      .from('event_budget_allocations')
      .upsert(records, { onConflict: 'event_id,category_id' })
      .select();

    if (error) throw error;
    return data as EventBudget[];
  }

  /**
   * Delete a budget allocation
   */
  async deleteBudget(id: string) {
    const { error } = await this.supabase.from('event_budget_allocations').delete().eq('id', id);
    if (error) throw error;
  }

  // --------------------------------------------------------------------------
  // Budget Line Items (Actual costs)
  // --------------------------------------------------------------------------

  /**
   * Get all line items for an event
   */
  async getEventLineItems(eventId: string, options?: { categoryId?: string; status?: LineItemStatus }) {
    let query = this.supabase
      .from('event_budget_line_items')
      .select(`
        *,
        category:event_budget_categories(*)
      `)
      .eq('event_id', eventId)
      .order('created_at', { ascending: false });

    if (options?.categoryId) {
      query = query.eq('category_id', options.categoryId);
    }

    if (options?.status) {
      query = query.eq('status', options.status);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data as BudgetLineItem[];
  }

  /**
   * Get a single line item
   */
  async getLineItem(id: string) {
    const { data, error } = await this.supabase
      .from('event_budget_line_items')
      .select(`
        *,
        category:event_budget_categories(*)
      `)
      .eq('id', id)
      .single();

    if (error) throw error;
    return data as BudgetLineItem;
  }

  /**
   * Create a new line item
   */
  async createLineItem(input: CreateLineItemInput) {
    const { data, error } = await this.supabase
      .from('event_budget_line_items')
      .insert({
        event_id: input.event_id,
        category_id: input.category_id,
        description: input.description,
        amount: input.amount,
        vendor_name: input.vendor_name,
        currency: input.currency || 'USD',
        quantity: input.quantity ?? 1,
        unit_cost: input.unit_cost,
        status: input.status || 'pending',
        payment_status: input.payment_status || 'unpaid',
        payment_date: input.payment_date,
        payment_reference: input.payment_reference,
        expense_date: input.expense_date,
        due_date: input.due_date,
        invoice_url: input.invoice_url,
        receipt_url: input.receipt_url,
        contract_url: input.contract_url,
        metadata: input.metadata || {},
        notes: input.notes,
        internal_notes: input.internal_notes,
        supplier_id: input.supplier_id,
        created_by: input.created_by,
      })
      .select()
      .single();

    if (error) throw error;
    return data as BudgetLineItem;
  }

  /**
   * Update a line item
   */
  async updateLineItem(id: string, updates: Partial<CreateLineItemInput> & { updated_by?: string }) {
    const { data, error } = await this.supabase
      .from('event_budget_line_items')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data as BudgetLineItem;
  }

  /**
   * Delete a line item
   */
  async deleteLineItem(id: string) {
    const { error } = await this.supabase.from('event_budget_line_items').delete().eq('id', id);
    if (error) throw error;
  }

  /**
   * Mark a line item as paid
   */
  async markLineItemPaid(id: string, paymentDate?: string, paymentReference?: string) {
    return this.updateLineItem(id, {
      status: 'paid',
      payment_status: 'paid',
      payment_date: paymentDate || new Date().toISOString().split('T')[0],
      payment_reference: paymentReference,
    });
  }

  // --------------------------------------------------------------------------
  // Suppliers
  // --------------------------------------------------------------------------

  /**
   * Get all suppliers
   */
  async getSuppliers(options?: { type?: string; activeOnly?: boolean; preferredOnly?: boolean }) {
    let query = this.supabase.from('event_suppliers').select('*').order('name', { ascending: true });

    if (options?.type) {
      query = query.eq('supplier_type', options.type);
    }

    if (options?.activeOnly !== false) {
      query = query.eq('is_active', true);
    }

    if (options?.preferredOnly) {
      query = query.eq('is_preferred', true);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data as Supplier[];
  }

  /**
   * Create a supplier
   */
  async createSupplier(input: Partial<Supplier>) {
    const { data, error } = await this.supabase.from('event_suppliers').insert(input).select().single();

    if (error) throw error;
    return data as Supplier;
  }

  /**
   * Update a supplier
   */
  async updateSupplier(id: string, updates: Partial<Supplier>) {
    const { data, error } = await this.supabase.from('event_suppliers').update(updates).eq('id', id).select().single();

    if (error) throw error;
    return data as Supplier;
  }

  // --------------------------------------------------------------------------
  // Event Revenue
  // --------------------------------------------------------------------------

  /**
   * Get all revenue entries for an event
   */
  async getEventRevenue(eventId: string, options?: { sourceType?: RevenueSourceType }) {
    let query = this.supabase
      .from('event_revenue')
      .select('*')
      .eq('event_id', eventId)
      .order('revenue_date', { ascending: false });

    if (options?.sourceType) {
      query = query.eq('source_type', options.sourceType);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data as EventRevenue[];
  }

  /**
   * Create a revenue entry
   */
  async createRevenue(input: CreateRevenueInput) {
    const { data, error } = await this.supabase
      .from('event_revenue')
      .insert({
        event_id: input.event_id,
        source_type: input.source_type,
        source_name: input.source_name,
        description: input.description,
        ticket_type: input.ticket_type,
        gross_amount: input.gross_amount,
        fees: input.fees || 0,
        currency: input.currency || 'USD',
        quantity: input.quantity || 1,
        unit_price: input.unit_price,
        external_reference: input.external_reference,
        stripe_payment_intent_id: input.stripe_payment_intent_id,
        stripe_invoice_id: input.stripe_invoice_id,
        revenue_date: input.revenue_date,
        status: input.status || 'confirmed',
        notes: input.notes,
        created_by: input.created_by,
      })
      .select()
      .single();

    if (error) throw error;
    return data as EventRevenue;
  }

  /**
   * Update a revenue entry
   */
  async updateRevenue(id: string, updates: Partial<CreateRevenueInput>) {
    const { data, error } = await this.supabase.from('event_revenue').update(updates).eq('id', id).select().single();

    if (error) throw error;
    return data as EventRevenue;
  }

  /**
   * Record a refund on revenue
   */
  async recordRefund(id: string, refundAmount: number, refundDate?: string) {
    const { data, error } = await this.supabase
      .from('event_revenue')
      .update({
        refund_amount: refundAmount,
        refund_date: refundDate || new Date().toISOString().split('T')[0],
        status: 'partial_refund',
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data as EventRevenue;
  }

  /**
   * Delete a revenue record
   */
  async deleteRevenue(id: string) {
    const { error } = await this.supabase.from('event_revenue').delete().eq('id', id);
    if (error) throw error;
  }

  // --------------------------------------------------------------------------
  // Sponsor Payments
  // --------------------------------------------------------------------------

  /**
   * Get sponsor payments for an event
   */
  async getEventSponsorPayments(eventId: string, options?: { sponsorId?: string; status?: SponsorPaymentStatus }) {
    let query = this.supabase
      .from('event_sponsor_payments')
      .select('*')
      .eq('event_id', eventId)
      .order('created_at', { ascending: false });

    if (options?.sponsorId) {
      query = query.eq('sponsor_id', options.sponsorId);
    }

    if (options?.status) {
      query = query.eq('payment_status', options.status);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data as SponsorPayment[];
  }

  /**
   * Create a sponsor payment record
   */
  async createSponsorPayment(input: CreateSponsorPaymentInput) {
    const { data, error } = await this.supabase
      .from('event_sponsor_payments')
      .insert({
        event_sponsor_id: input.event_sponsor_id,
        event_id: input.event_id,
        sponsor_id: input.sponsor_id,
        description: input.description,
        sponsorship_package: input.sponsorship_package,
        contracted_amount: input.contracted_amount,
        paid_amount: input.paid_amount || 0,
        currency: input.currency || 'USD',
        payment_status: input.payment_status || 'pending',
        invoice_number: input.invoice_number,
        invoice_date: input.invoice_date,
        due_date: input.due_date,
        payment_date: input.payment_date,
        payment_method: input.payment_method,
        external_reference: input.external_reference,
        stripe_payment_intent_id: input.stripe_payment_intent_id,
        stripe_invoice_id: input.stripe_invoice_id,
        contract_url: input.contract_url,
        invoice_url: input.invoice_url,
        notes: input.notes,
        internal_notes: input.internal_notes,
        created_by: input.created_by,
      })
      .select()
      .single();

    if (error) throw error;
    return data as SponsorPayment;
  }

  /**
   * Update a sponsor payment
   */
  async updateSponsorPayment(id: string, updates: Partial<CreateSponsorPaymentInput>) {
    const { data, error } = await this.supabase
      .from('event_sponsor_payments')
      .update(updates)
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;
    return data as SponsorPayment;
  }

  /**
   * Record a payment received from a sponsor
   */
  async recordSponsorPaymentReceived(
    id: string,
    amount: number,
    paymentDate?: string,
    paymentMethod?: string
  ) {
    const payment = await this.getSponsorPayment(id);
    const newPaidAmount = (payment.paid_amount || 0) + amount;
    const newStatus: SponsorPaymentStatus =
      newPaidAmount >= payment.contracted_amount ? 'paid' : 'partial';

    return this.updateSponsorPayment(id, {
      paid_amount: newPaidAmount,
      payment_status: newStatus,
      payment_date: paymentDate || new Date().toISOString().split('T')[0],
      payment_method: paymentMethod,
    });
  }

  /**
   * Get a single sponsor payment
   */
  async getSponsorPayment(id: string) {
    const { data, error } = await this.supabase
      .from('event_sponsor_payments')
      .select('*')
      .eq('id', id)
      .single();

    if (error) throw error;
    return data as SponsorPayment;
  }

  /**
   * Delete a sponsor payment record
   */
  async deleteSponsorPayment(id: string) {
    const { error } = await this.supabase.from('event_sponsor_payments').delete().eq('id', id);
    if (error) throw error;
  }

  // --------------------------------------------------------------------------
  // Reporting Functions (Using database functions)
  // --------------------------------------------------------------------------

  /**
   * Get budget summary for an event (planned vs actual by category)
   */
  async getBudgetSummary(eventId: string): Promise<BudgetSummary> {
    const { data, error } = await this.supabase.rpc('get_event_budget_summary', {
      p_event_id: eventId,
    });

    if (error) throw error;
    return data as BudgetSummary;
  }

  /**
   * Get marketing CPA (Cost Per Acquisition) for an event
   */
  async getMarketingCPA(eventId: string): Promise<MarketingCPA> {
    const { data, error } = await this.supabase.rpc('get_event_marketing_cpa', {
      p_event_id: eventId,
    });

    if (error) throw error;
    return data as MarketingCPA;
  }

  /**
   * Get full Profit & Loss report for an event
   */
  async getProfitLoss(eventId: string): Promise<ProfitLoss> {
    const { data, error } = await this.supabase.rpc('get_event_profit_loss', {
      p_event_id: eventId,
    });

    if (error) throw error;
    return data as ProfitLoss;
  }

  /**
   * Get sponsor revenue summary for an event
   */
  async getSponsorRevenue(eventId: string) {
    const { data, error } = await this.supabase.rpc('get_event_sponsor_revenue', {
      p_event_id: eventId,
    });

    if (error) throw error;
    return data;
  }

  /**
   * Get cost summary (includes overall CPA)
   */
  async getCostSummary(eventId: string) {
    const { data, error } = await this.supabase.rpc('get_event_cost_summary', {
      p_event_id: eventId,
    });

    if (error) throw error;
    return data;
  }

  // --------------------------------------------------------------------------
  // Utility Methods
  // --------------------------------------------------------------------------

  /**
   * Calculate total actual spend for an event
   */
  async getTotalActualSpend(eventId: string): Promise<number> {
    const { data, error } = await this.supabase
      .from('event_budget_line_items')
      .select('amount, quantity')
      .eq('event_id', eventId)
      .neq('status', 'cancelled');

    if (error) throw error;

    return data.reduce((total, item) => total + item.amount * item.quantity, 0);
  }

  /**
   * Calculate total planned budget for an event
   */
  async getTotalPlannedBudget(eventId: string): Promise<number> {
    const { data, error } = await this.supabase
      .from('event_budget_allocations')
      .select('planned_amount')
      .eq('event_id', eventId);

    if (error) throw error;

    return data.reduce((total, item) => total + (item.planned_amount || 0), 0);
  }

  /**
   * Get budget variance (planned - actual)
   */
  async getBudgetVariance(eventId: string): Promise<{
    planned: number;
    actual: number;
    variance: number;
    variancePercentage: number | null;
  }> {
    const [planned, actual] = await Promise.all([
      this.getTotalPlannedBudget(eventId),
      this.getTotalActualSpend(eventId),
    ]);

    const variance = planned - actual;
    const variancePercentage = planned > 0 ? ((variance / planned) * 100) : null;

    return {
      planned,
      actual,
      variance,
      variancePercentage,
    };
  }
}
