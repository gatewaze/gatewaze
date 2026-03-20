import { supabase } from '@/lib/supabase';

// TypeScript Interfaces matching database schema

export interface StripeCustomer {
  id: string;
  account_id: string;
  stripe_customer_id: string;
  email: string;
  name?: string;
  description?: string;
  phone?: string;
  currency: string;
  balance: number;
  metadata?: Record<string, any>;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface StripeProduct {
  id: string;
  account_id: string;
  stripe_product_id: string;
  name: string;
  description?: string;
  active: boolean;
  default_price_id?: string;
  images?: string[];
  metadata?: Record<string, any>;
  unit_label?: string;
  created_at: string;
  updated_at: string;
}

export interface StripePrice {
  id: string;
  account_id: string;
  product_id: string;
  stripe_price_id: string;
  stripe_product_id: string;
  active: boolean;
  currency: string;
  unit_amount?: number;
  recurring_interval?: string;
  recurring_interval_count?: number;
  type: 'one_time' | 'recurring';
  billing_scheme: string;
  metadata?: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface StripeInvoice {
  id: string;
  account_id: string;
  customer_id?: string;
  stripe_invoice_id: string;
  stripe_customer_id: string;
  invoice_number?: string;
  status: 'draft' | 'open' | 'paid' | 'uncollectible' | 'void';
  currency: string;
  amount_due: number;
  amount_paid: number;
  amount_remaining: number;
  subtotal: number;
  total: number;
  tax: number;
  discount_amount: number;
  description?: string;
  hosted_invoice_url?: string;
  invoice_pdf?: string;
  billing_reason?: string;
  due_date?: string;
  paid_at?: string;
  period_start?: string;
  period_end?: string;
  metadata?: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface StripeTransaction {
  id: string;
  account_id: string;
  customer_id?: string;
  invoice_id?: string;
  stripe_payment_intent_id: string;
  stripe_customer_id?: string;
  stripe_invoice_id?: string;
  amount: number;
  currency: string;
  status: 'requires_payment_method' | 'requires_confirmation' | 'requires_action' | 'processing' | 'succeeded' | 'canceled' | 'requires_capture';
  payment_method_type?: string;
  description?: string;
  receipt_email?: string;
  metadata?: Record<string, any>;
  error_message?: string;
  succeeded_at?: string;
  canceled_at?: string;
  created_at: string;
  updated_at: string;
}

// Extended interfaces with related data
export interface StripeProductWithPrices extends StripeProduct {
  prices?: StripePrice[];
}

export interface StripeInvoiceWithCustomer extends StripeInvoice {
  customer?: StripeCustomer;
}

export interface StripeTransactionWithRelations extends StripeTransaction {
  customer?: StripeCustomer;
  invoice?: StripeInvoice;
}

/**
 * Service for managing Stripe data cached in Supabase
 * Data is synced via Stripe webhooks
 */
export class StripeService {
  // =====================
  // CUSTOMERS
  // =====================

  /**
   * Get all customers for an account
   */
  static async getCustomers(accountId?: string): Promise<{
    data: StripeCustomer[] | null;
    error: string | null;
  }> {
    try {
      let query = supabase
        .from('payments_stripe_customers')
        .select('*')
        .order('created_at', { ascending: false });

      if (accountId) {
        query = query.eq('account_id', accountId);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error fetching Stripe customers:', error);
        return { data: null, error: error.message };
      }

      return { data, error: null };
    } catch (error) {
      console.error('Error fetching Stripe customers:', error);
      return {
        data: null,
        error: error instanceof Error ? error.message : 'Failed to fetch customers',
      };
    }
  }

  /**
   * Get customer by ID
   */
  static async getCustomer(id: string): Promise<{
    data: StripeCustomer | null;
    error: string | null;
  }> {
    try {
      const { data, error } = await supabase
        .from('payments_stripe_customers')
        .select('*')
        .eq('id', id)
        .single();

      if (error) {
        console.error('Error fetching Stripe customer:', error);
        return { data: null, error: error.message };
      }

      return { data, error: null };
    } catch (error) {
      console.error('Error fetching Stripe customer:', error);
      return {
        data: null,
        error: error instanceof Error ? error.message : 'Failed to fetch customer',
      };
    }
  }

  /**
   * Get customer by Stripe customer ID
   */
  static async getCustomerByStripeId(stripeCustomerId: string): Promise<{
    data: StripeCustomer | null;
    error: string | null;
  }> {
    try {
      const { data, error } = await supabase
        .from('payments_stripe_customers')
        .select('*')
        .eq('stripe_customer_id', stripeCustomerId)
        .single();

      if (error) {
        console.error('Error fetching Stripe customer:', error);
        return { data: null, error: error.message };
      }

      return { data, error: null };
    } catch (error) {
      console.error('Error fetching Stripe customer:', error);
      return {
        data: null,
        error: error instanceof Error ? error.message : 'Failed to fetch customer',
      };
    }
  }

  // =====================
  // PRODUCTS
  // =====================

  /**
   * Get all products for an account
   */
  static async getProducts(accountId?: string): Promise<{
    data: StripeProduct[] | null;
    error: string | null;
  }> {
    try {
      let query = supabase
        .from('payments_stripe_products')
        .select('*')
        .order('created_at', { ascending: false });

      if (accountId) {
        query = query.eq('account_id', accountId);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error fetching Stripe products:', error);
        return { data: null, error: error.message };
      }

      return { data, error: null };
    } catch (error) {
      console.error('Error fetching Stripe products:', error);
      return {
        data: null,
        error: error instanceof Error ? error.message : 'Failed to fetch products',
      };
    }
  }

  /**
   * Get products with their prices
   */
  static async getProductsWithPrices(accountId?: string): Promise<{
    data: StripeProductWithPrices[] | null;
    error: string | null;
  }> {
    try {
      let query = supabase
        .from('payments_stripe_products')
        .select(`
          *,
          prices:stripe_prices(*)
        `)
        .order('created_at', { ascending: false });

      if (accountId) {
        query = query.eq('account_id', accountId);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error fetching Stripe products with prices:', error);
        return { data: null, error: error.message };
      }

      return { data, error: null };
    } catch (error) {
      console.error('Error fetching Stripe products with prices:', error);
      return {
        data: null,
        error: error instanceof Error ? error.message : 'Failed to fetch products',
      };
    }
  }

  /**
   * Get product by ID
   */
  static async getProduct(id: string): Promise<{
    data: StripeProductWithPrices | null;
    error: string | null;
  }> {
    try {
      const { data, error } = await supabase
        .from('payments_stripe_products')
        .select(`
          *,
          prices:stripe_prices(*)
        `)
        .eq('id', id)
        .single();

      if (error) {
        console.error('Error fetching Stripe product:', error);
        return { data: null, error: error.message };
      }

      return { data, error: null };
    } catch (error) {
      console.error('Error fetching Stripe product:', error);
      return {
        data: null,
        error: error instanceof Error ? error.message : 'Failed to fetch product',
      };
    }
  }

  // =====================
  // INVOICES
  // =====================

  /**
   * Get all invoices for an account
   */
  static async getInvoices(accountId?: string): Promise<{
    data: StripeInvoice[] | null;
    error: string | null;
  }> {
    try {
      let query = supabase
        .from('payments_stripe_invoices')
        .select('*')
        .order('created_at', { ascending: false });

      if (accountId) {
        query = query.eq('account_id', accountId);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error fetching Stripe invoices:', error);
        return { data: null, error: error.message };
      }

      return { data, error: null };
    } catch (error) {
      console.error('Error fetching Stripe invoices:', error);
      return {
        data: null,
        error: error instanceof Error ? error.message : 'Failed to fetch invoices',
      };
    }
  }

  /**
   * Get invoices with customer data
   */
  static async getInvoicesWithCustomer(accountId?: string): Promise<{
    data: StripeInvoiceWithCustomer[] | null;
    error: string | null;
  }> {
    try {
      let query = supabase
        .from('payments_stripe_invoices')
        .select(`
          *,
          customer:stripe_customers(*)
        `)
        .order('created_at', { ascending: false });

      if (accountId) {
        query = query.eq('account_id', accountId);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error fetching Stripe invoices with customer:', error);
        return { data: null, error: error.message };
      }

      return { data, error: null };
    } catch (error) {
      console.error('Error fetching Stripe invoices with customer:', error);
      return {
        data: null,
        error: error instanceof Error ? error.message : 'Failed to fetch invoices',
      };
    }
  }

  /**
   * Get invoice by ID
   */
  static async getInvoice(id: string): Promise<{
    data: StripeInvoiceWithCustomer | null;
    error: string | null;
  }> {
    try {
      const { data, error } = await supabase
        .from('payments_stripe_invoices')
        .select(`
          *,
          customer:stripe_customers(*)
        `)
        .eq('id', id)
        .single();

      if (error) {
        console.error('Error fetching Stripe invoice:', error);
        return { data: null, error: error.message };
      }

      return { data, error: null };
    } catch (error) {
      console.error('Error fetching Stripe invoice:', error);
      return {
        data: null,
        error: error instanceof Error ? error.message : 'Failed to fetch invoice',
      };
    }
  }

  // =====================
  // TRANSACTIONS
  // =====================

  /**
   * Get all transactions for an account
   */
  static async getTransactions(accountId?: string): Promise<{
    data: StripeTransaction[] | null;
    error: string | null;
  }> {
    try {
      let query = supabase
        .from('payments_stripe_transactions')
        .select('*')
        .order('created_at', { ascending: false });

      if (accountId) {
        query = query.eq('account_id', accountId);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error fetching Stripe transactions:', error);
        return { data: null, error: error.message };
      }

      return { data, error: null };
    } catch (error) {
      console.error('Error fetching Stripe transactions:', error);
      return {
        data: null,
        error: error instanceof Error ? error.message : 'Failed to fetch transactions',
      };
    }
  }

  /**
   * Get transactions with related data (customer, invoice)
   */
  static async getTransactionsWithRelations(accountId?: string): Promise<{
    data: StripeTransactionWithRelations[] | null;
    error: string | null;
  }> {
    try {
      let query = supabase
        .from('payments_stripe_transactions')
        .select(`
          *,
          customer:stripe_customers(*),
          invoice:stripe_invoices(*)
        `)
        .order('created_at', { ascending: false });

      if (accountId) {
        query = query.eq('account_id', accountId);
      }

      const { data, error } = await query;

      if (error) {
        console.error('Error fetching Stripe transactions with relations:', error);
        return { data: null, error: error.message };
      }

      return { data, error: null };
    } catch (error) {
      console.error('Error fetching Stripe transactions with relations:', error);
      return {
        data: null,
        error: error instanceof Error ? error.message : 'Failed to fetch transactions',
      };
    }
  }

  /**
   * Get transaction by ID
   */
  static async getTransaction(id: string): Promise<{
    data: StripeTransactionWithRelations | null;
    error: string | null;
  }> {
    try {
      const { data, error } = await supabase
        .from('payments_stripe_transactions')
        .select(`
          *,
          customer:stripe_customers(*),
          invoice:stripe_invoices(*)
        `)
        .eq('id', id)
        .single();

      if (error) {
        console.error('Error fetching Stripe transaction:', error);
        return { data: null, error: error.message };
      }

      return { data, error: null };
    } catch (error) {
      console.error('Error fetching Stripe transaction:', error);
      return {
        data: null,
        error: error instanceof Error ? error.message : 'Failed to fetch transaction',
      };
    }
  }

  // =====================
  // STATS & ANALYTICS
  // =====================

  /**
   * Get aggregated stats for an account
   */
  static async getStats(accountId?: string): Promise<{
    data: {
      customers: {
        total: number;
        active: number;
      };
      products: {
        total: number;
        active: number;
      };
      invoices: {
        total: number;
        paid: number;
        open: number;
        totalAmount: number;
        paidAmount: number;
      };
      transactions: {
        total: number;
        succeeded: number;
        totalAmount: number;
        succeededAmount: number;
      };
    } | null;
    error: string | null;
  }> {
    try {
      // Fetch all data in parallel
      const [customersRes, productsRes, invoicesRes, transactionsRes] = await Promise.all([
        this.getCustomers(accountId),
        this.getProducts(accountId),
        this.getInvoices(accountId),
        this.getTransactions(accountId),
      ]);

      if (customersRes.error || productsRes.error || invoicesRes.error || transactionsRes.error) {
        return {
          data: null,
          error: 'Failed to fetch stats',
        };
      }

      const customers = customersRes.data || [];
      const products = productsRes.data || [];
      const invoices = invoicesRes.data || [];
      const transactions = transactionsRes.data || [];

      const stats = {
        customers: {
          total: customers.length,
          active: customers.filter(c => c.is_active).length,
        },
        products: {
          total: products.length,
          active: products.filter(p => p.active).length,
        },
        invoices: {
          total: invoices.length,
          paid: invoices.filter(i => i.status === 'paid').length,
          open: invoices.filter(i => i.status === 'open').length,
          totalAmount: invoices.reduce((sum, i) => sum + i.total, 0),
          paidAmount: invoices.filter(i => i.status === 'paid').reduce((sum, i) => sum + i.amount_paid, 0),
        },
        transactions: {
          total: transactions.length,
          succeeded: transactions.filter(t => t.status === 'succeeded').length,
          totalAmount: transactions.reduce((sum, t) => sum + t.amount, 0),
          succeededAmount: transactions.filter(t => t.status === 'succeeded').reduce((sum, t) => sum + t.amount, 0),
        },
      };

      return { data: stats, error: null };
    } catch (error) {
      console.error('Error fetching Stripe stats:', error);
      return {
        data: null,
        error: error instanceof Error ? error.message : 'Failed to fetch stats',
      };
    }
  }
}
