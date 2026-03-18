// @ts-nocheck
/**
 * Event Budget Tab Component
 * Allows users to manage budget allocations, line items, revenue, and sponsor payments
 */

import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import {
  PlusIcon,
  PencilIcon,
  TrashIcon,
  CurrencyDollarIcon,
  DocumentTextIcon,
  BuildingOfficeIcon,
  BanknotesIcon,
  CheckCircleIcon,
  ClockIcon,
  ExclamationTriangleIcon,
  ChevronDownIcon,
  ChevronUpIcon,
} from '@heroicons/react/24/outline';
import { Button, Card, Input, Select, Modal, ConfirmModal, Badge } from '@/components/ui-legacy';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import {
  BudgetService,
  BudgetCategory,
  EventBudget,
  BudgetLineItem,
  EventRevenue,
  SponsorPayment,
  CategoryType,
  LineItemStatus,
  RevenueStatus,
  SponsorPaymentStatus,
} from '@/lib/services/budgetService';
import { supabase } from '@/lib/supabase';
import { EventBudgetReport } from './EventBudgetReport';

interface EventBudgetTabProps {
  eventId: string;
}

type ActiveSection = 'allocations' | 'lineItems' | 'revenue' | 'sponsorPayments' | 'report';

export function EventBudgetTab({ eventId }: EventBudgetTabProps) {
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState<ActiveSection>('allocations');

  // Data states
  const [categories, setCategories] = useState<BudgetCategory[]>([]);
  const [budgets, setBudgets] = useState<EventBudget[]>([]);
  const [lineItems, setLineItems] = useState<BudgetLineItem[]>([]);
  const [revenues, setRevenues] = useState<EventRevenue[]>([]);
  const [sponsorPayments, setSponsorPayments] = useState<SponsorPayment[]>([]);
  const [eventSponsors, setEventSponsors] = useState<Array<{
    id: string;
    event_id: string;
    sponsor_id: string;
    sponsorship_tier: string;
    sponsor: {
      id: string;
      name: string;
      logo_url?: string;
    };
  }>>([]);

  // Modal states
  const [showBudgetModal, setShowBudgetModal] = useState(false);
  const [showLineItemModal, setShowLineItemModal] = useState(false);
  const [showRevenueModal, setShowRevenueModal] = useState(false);
  const [showSponsorPaymentModal, setShowSponsorPaymentModal] = useState(false);

  // Editing states
  const [editingBudget, setEditingBudget] = useState<EventBudget | null>(null);
  const [editingLineItem, setEditingLineItem] = useState<BudgetLineItem | null>(null);
  const [editingRevenue, setEditingRevenue] = useState<EventRevenue | null>(null);
  const [editingSponsorPayment, setEditingSponsorPayment] = useState<SponsorPayment | null>(null);

  // Delete confirmation states
  const [deletingLineItem, setDeletingLineItem] = useState<BudgetLineItem | null>(null);
  const [deletingRevenue, setDeletingRevenue] = useState<EventRevenue | null>(null);
  const [deletingSponsorPayment, setDeletingSponsorPayment] = useState<SponsorPayment | null>(null);

  // Form states
  const [budgetForm, setBudgetForm] = useState({
    category_id: '',
    planned_amount: '',
    notes: '',
  });

  const [lineItemForm, setLineItemForm] = useState({
    category_id: '',
    description: '',
    amount: '',
    quantity: '1',
    vendor_name: '',
    invoice_number: '',
    invoice_date: '',
    due_date: '',
    payment_date: '',
    status: 'pending' as LineItemStatus,
    notes: '',
  });

  const [revenueForm, setRevenueForm] = useState({
    source_type: 'external',
    source_name: '',
    description: '',
    ticket_type: '',
    gross_amount: '',
    fees: '0',
    quantity: '1',
    unit_price: '',
    external_reference: '',
    revenue_date: new Date().toISOString().split('T')[0],
    status: 'confirmed' as RevenueStatus,
    notes: '',
  });

  const [sponsorPaymentForm, setSponsorPaymentForm] = useState({
    event_sponsor_id: '',
    sponsor_id: '',
    description: '',
    sponsorship_package: '',
    contracted_amount: '',
    paid_amount: '0',
    payment_status: 'pending' as SponsorPaymentStatus,
    invoice_number: '',
    invoice_date: '',
    due_date: '',
    payment_date: '',
    payment_method: '',
    notes: '',
  });

  // Collapsed sections
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());

  const budgetService = new BudgetService(supabase);

  useEffect(() => {
    loadData();
  }, [eventId]);

  const loadData = async () => {
    try {
      setLoading(true);
      const [categoriesData, budgetsData, lineItemsData, revenuesData, sponsorPaymentsData, eventSponsorsData] = await Promise.all([
        budgetService.getCategories({ includeInactive: false }),
        budgetService.getEventBudgets(eventId),
        budgetService.getEventLineItems(eventId),
        budgetService.getEventRevenue(eventId),
        budgetService.getEventSponsorPayments(eventId),
        supabase
          .from('event_sponsors')
          .select(`
            id,
            event_id,
            sponsor_id,
            sponsorship_tier,
            sponsor:sponsors (
              id,
              name,
              logo_url
            )
          `)
          .eq('event_id', eventId)
          .order('created_at', { ascending: false })
          .then(({ data, error }) => {
            if (error) throw error;
            return data || [];
          }),
      ]);
      setCategories(categoriesData);
      setBudgets(budgetsData);
      setLineItems(lineItemsData);
      setRevenues(revenuesData);
      setSponsorPayments(sponsorPaymentsData);
      setEventSponsors(eventSponsorsData as typeof eventSponsors);
    } catch (error) {
      console.error('Error loading budget data:', error);
      toast.error('Failed to load budget data');
    } finally {
      setLoading(false);
    }
  };

  // ====== HELPER FUNCTIONS ======

  const formatCurrency = (amount: number | string | null | undefined) => {
    const num = typeof amount === 'string' ? parseFloat(amount) : amount;
    if (num === null || num === undefined || isNaN(num)) return '-';
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
    }).format(num);
  };

  const getCategoryById = (id: string) => categories.find((c) => c.id === id);

  const getCategoriesByType = (type: CategoryType) => categories.filter((c) => c.category_type === type);

  const getBudgetForCategory = (categoryId: string) => budgets.find((b) => b.category_id === categoryId);

  const getLineItemsForCategory = (categoryId: string) => lineItems.filter((li) => li.category_id === categoryId);

  const calculateTotalPlanned = () => budgets.reduce((sum, b) => sum + (b.planned_amount || 0), 0);

  const calculateTotalActual = () =>
    lineItems
      .filter((li) => li.status !== 'cancelled')
      .reduce((sum, li) => sum + li.amount * li.quantity, 0);

  const calculateTotalRevenue = () =>
    revenues
      .filter((r) => r.status !== 'refunded')
      .reduce((sum, r) => sum + (r.net_amount || r.gross_amount - (r.fees || 0)), 0);

  const calculateTotalSponsorRevenue = () =>
    sponsorPayments
      .filter((sp) => sp.payment_status !== 'cancelled')
      .reduce((sum, sp) => sum + (sp.paid_amount || 0), 0);

  const toggleCategoryCollapse = (categoryId: string) => {
    setCollapsedCategories((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(categoryId)) {
        newSet.delete(categoryId);
      } else {
        newSet.add(categoryId);
      }
      return newSet;
    });
  };

  // ====== BUDGET ALLOCATION HANDLERS ======

  const handleAddBudget = (categoryId?: string) => {
    setEditingBudget(null);
    setBudgetForm({
      category_id: categoryId || '',
      planned_amount: '',
      notes: '',
    });
    setShowBudgetModal(true);
  };

  const handleEditBudget = (budget: EventBudget) => {
    setEditingBudget(budget);
    setBudgetForm({
      category_id: budget.category_id,
      planned_amount: budget.planned_amount?.toString() || '',
      notes: budget.notes || '',
    });
    setShowBudgetModal(true);
  };

  const handleSaveBudget = async () => {
    if (!budgetForm.category_id) {
      toast.error('Please select a category');
      return;
    }
    if (!budgetForm.planned_amount || parseFloat(budgetForm.planned_amount) < 0) {
      toast.error('Please enter a valid amount');
      return;
    }

    try {
      await budgetService.upsertBudget({
        event_id: eventId,
        category_id: budgetForm.category_id,
        planned_amount: parseFloat(budgetForm.planned_amount),
        notes: budgetForm.notes || undefined,
      });
      toast.success(editingBudget ? 'Budget updated successfully' : 'Budget added successfully');
      setShowBudgetModal(false);
      loadData();
    } catch (error) {
      console.error('Error saving budget:', error);
      toast.error('Failed to save budget');
    }
  };

  // ====== LINE ITEM HANDLERS ======

  const handleAddLineItem = (categoryId?: string) => {
    setEditingLineItem(null);
    setLineItemForm({
      category_id: categoryId || '',
      description: '',
      amount: '',
      quantity: '1',
      vendor_name: '',
      invoice_number: '',
      invoice_date: '',
      due_date: '',
      payment_date: '',
      status: 'pending',
      notes: '',
    });
    setShowLineItemModal(true);
  };

  const handleEditLineItem = (item: BudgetLineItem) => {
    setEditingLineItem(item);
    setLineItemForm({
      category_id: item.category_id,
      description: item.description,
      amount: item.amount.toString(),
      quantity: item.quantity.toString(),
      vendor_name: item.vendor_name || '',
      invoice_number: item.invoice_number || '',
      invoice_date: item.invoice_date || '',
      due_date: item.due_date || '',
      payment_date: item.payment_date || '',
      status: item.status,
      notes: item.notes || '',
    });
    setShowLineItemModal(true);
  };

  const handleSaveLineItem = async () => {
    if (!lineItemForm.category_id) {
      toast.error('Please select a category');
      return;
    }
    if (!lineItemForm.amount || parseFloat(lineItemForm.amount) < 0) {
      toast.error('Please enter a valid amount');
      return;
    }

    try {
      if (editingLineItem) {
        await budgetService.updateLineItem(editingLineItem.id, {
          category_id: lineItemForm.category_id,
          description: lineItemForm.description,
          amount: parseFloat(lineItemForm.amount),
          quantity: parseInt(lineItemForm.quantity) || 1,
          vendor_name: lineItemForm.vendor_name || undefined,
          invoice_number: lineItemForm.invoice_number || undefined,
          invoice_date: lineItemForm.invoice_date || undefined,
          due_date: lineItemForm.due_date || undefined,
          payment_date: lineItemForm.payment_date || undefined,
          status: lineItemForm.status,
          notes: lineItemForm.notes || undefined,
        });
        toast.success('Line item updated successfully');
      } else {
        await budgetService.createLineItem({
          event_id: eventId,
          category_id: lineItemForm.category_id,
          description: lineItemForm.description,
          amount: parseFloat(lineItemForm.amount),
          quantity: parseInt(lineItemForm.quantity) || 1,
          vendor_name: lineItemForm.vendor_name || undefined,
          invoice_number: lineItemForm.invoice_number || undefined,
          invoice_date: lineItemForm.invoice_date || undefined,
          due_date: lineItemForm.due_date || undefined,
          payment_date: lineItemForm.payment_date || undefined,
          status: lineItemForm.status,
          notes: lineItemForm.notes || undefined,
        });
        toast.success('Line item added successfully');
      }
      setShowLineItemModal(false);
      loadData();
    } catch (error) {
      console.error('Error saving line item:', error);
      toast.error('Failed to save line item');
    }
  };

  const handleDeleteLineItem = async () => {
    if (!deletingLineItem) return;
    try {
      await budgetService.deleteLineItem(deletingLineItem.id);
      toast.success('Line item deleted successfully');
      setDeletingLineItem(null);
      loadData();
    } catch (error) {
      console.error('Error deleting line item:', error);
      toast.error('Failed to delete line item');
    }
  };

  // ====== REVENUE HANDLERS ======

  const handleAddRevenue = () => {
    setEditingRevenue(null);
    setRevenueForm({
      source_type: 'external',
      source_name: '',
      description: '',
      ticket_type: '',
      gross_amount: '',
      fees: '0',
      quantity: '1',
      unit_price: '',
      external_reference: '',
      revenue_date: new Date().toISOString().split('T')[0],
      status: 'confirmed',
      notes: '',
    });
    setShowRevenueModal(true);
  };

  const handleEditRevenue = (revenue: EventRevenue) => {
    setEditingRevenue(revenue);
    setRevenueForm({
      source_type: revenue.source_type,
      source_name: revenue.source_name || '',
      description: revenue.description,
      ticket_type: revenue.ticket_type || '',
      gross_amount: revenue.gross_amount.toString(),
      fees: revenue.fees?.toString() || '0',
      quantity: revenue.quantity?.toString() || '1',
      unit_price: revenue.unit_price?.toString() || '',
      external_reference: revenue.external_reference || '',
      revenue_date: revenue.revenue_date,
      status: revenue.status,
      notes: revenue.notes || '',
    });
    setShowRevenueModal(true);
  };

  const handleSaveRevenue = async () => {
    if (!revenueForm.description.trim()) {
      toast.error('Please enter a description');
      return;
    }
    if (!revenueForm.gross_amount || parseFloat(revenueForm.gross_amount) < 0) {
      toast.error('Please enter a valid amount');
      return;
    }

    try {
      if (editingRevenue) {
        await budgetService.updateRevenue(editingRevenue.id, {
          source_type: revenueForm.source_type,
          source_name: revenueForm.source_name || undefined,
          description: revenueForm.description,
          ticket_type: revenueForm.ticket_type || undefined,
          gross_amount: parseFloat(revenueForm.gross_amount),
          fees: parseFloat(revenueForm.fees) || 0,
          quantity: parseInt(revenueForm.quantity) || 1,
          unit_price: revenueForm.unit_price ? parseFloat(revenueForm.unit_price) : undefined,
          external_reference: revenueForm.external_reference || undefined,
          revenue_date: revenueForm.revenue_date,
          status: revenueForm.status,
          notes: revenueForm.notes || undefined,
        });
        toast.success('Revenue updated successfully');
      } else {
        await budgetService.createRevenue({
          event_id: eventId,
          source_type: revenueForm.source_type,
          source_name: revenueForm.source_name || undefined,
          description: revenueForm.description,
          ticket_type: revenueForm.ticket_type || undefined,
          gross_amount: parseFloat(revenueForm.gross_amount),
          fees: parseFloat(revenueForm.fees) || 0,
          quantity: parseInt(revenueForm.quantity) || 1,
          unit_price: revenueForm.unit_price ? parseFloat(revenueForm.unit_price) : undefined,
          external_reference: revenueForm.external_reference || undefined,
          revenue_date: revenueForm.revenue_date,
          status: revenueForm.status,
          notes: revenueForm.notes || undefined,
        });
        toast.success('Revenue added successfully');
      }
      setShowRevenueModal(false);
      loadData();
    } catch (error) {
      console.error('Error saving revenue:', error);
      toast.error('Failed to save revenue');
    }
  };

  const handleDeleteRevenue = async () => {
    if (!deletingRevenue) return;
    try {
      await budgetService.deleteRevenue(deletingRevenue.id);
      toast.success('Revenue deleted successfully');
      setDeletingRevenue(null);
      loadData();
    } catch (error) {
      console.error('Error deleting revenue:', error);
      toast.error('Failed to delete revenue');
    }
  };

  // ====== SPONSOR PAYMENT HANDLERS ======

  const handleAddSponsorPayment = () => {
    setEditingSponsorPayment(null);
    setSponsorPaymentForm({
      event_sponsor_id: '',
      sponsor_id: '',
      description: '',
      sponsorship_package: '',
      contracted_amount: '',
      paid_amount: '0',
      payment_status: 'pending',
      invoice_number: '',
      invoice_date: '',
      due_date: '',
      payment_date: '',
      payment_method: '',
      notes: '',
    });
    setShowSponsorPaymentModal(true);
  };

  const handleEditSponsorPayment = (payment: SponsorPayment) => {
    setEditingSponsorPayment(payment);
    setSponsorPaymentForm({
      event_sponsor_id: payment.event_sponsor_id,
      sponsor_id: payment.sponsor_id,
      description: payment.description,
      sponsorship_package: payment.sponsorship_package || '',
      contracted_amount: payment.contracted_amount.toString(),
      paid_amount: payment.paid_amount?.toString() || '0',
      payment_status: payment.payment_status,
      invoice_number: payment.invoice_number || '',
      invoice_date: payment.invoice_date || '',
      due_date: payment.due_date || '',
      payment_date: payment.payment_date || '',
      payment_method: payment.payment_method || '',
      notes: payment.notes || '',
    });
    setShowSponsorPaymentModal(true);
  };

  const handleSaveSponsorPayment = async () => {
    if (!sponsorPaymentForm.contracted_amount || parseFloat(sponsorPaymentForm.contracted_amount) < 0) {
      toast.error('Please enter a valid contracted amount');
      return;
    }

    try {
      if (editingSponsorPayment) {
        await budgetService.updateSponsorPayment(editingSponsorPayment.id, {
          description: sponsorPaymentForm.description || undefined,
          sponsorship_package: sponsorPaymentForm.sponsorship_package || undefined,
          contracted_amount: parseFloat(sponsorPaymentForm.contracted_amount),
          paid_amount: parseFloat(sponsorPaymentForm.paid_amount) || 0,
          payment_status: sponsorPaymentForm.payment_status,
          invoice_number: sponsorPaymentForm.invoice_number || undefined,
          invoice_date: sponsorPaymentForm.invoice_date || undefined,
          due_date: sponsorPaymentForm.due_date || undefined,
          payment_date: sponsorPaymentForm.payment_date || undefined,
          payment_method: sponsorPaymentForm.payment_method || undefined,
          notes: sponsorPaymentForm.notes || undefined,
        });
        toast.success('Sponsor payment updated successfully');
      } else {
        // Require sponsor selection for new payments
        if (!sponsorPaymentForm.event_sponsor_id) {
          toast.error('Please select a sponsor');
          return;
        }

        // Find the selected event sponsor to get sponsor_id
        const selectedEventSponsor = eventSponsors.find(es => es.id === sponsorPaymentForm.event_sponsor_id);
        if (!selectedEventSponsor) {
          toast.error('Invalid sponsor selected');
          return;
        }

        await budgetService.createSponsorPayment({
          event_sponsor_id: sponsorPaymentForm.event_sponsor_id,
          event_id: eventId,
          sponsor_id: selectedEventSponsor.sponsor_id,
          description: sponsorPaymentForm.description || `${selectedEventSponsor.sponsor.name} - ${sponsorPaymentForm.sponsorship_package || selectedEventSponsor.sponsorship_tier || 'Sponsorship'}`,
          sponsorship_package: sponsorPaymentForm.sponsorship_package || selectedEventSponsor.sponsorship_tier || undefined,
          contracted_amount: parseFloat(sponsorPaymentForm.contracted_amount),
          paid_amount: parseFloat(sponsorPaymentForm.paid_amount) || 0,
          payment_status: sponsorPaymentForm.payment_status,
          invoice_number: sponsorPaymentForm.invoice_number || undefined,
          invoice_date: sponsorPaymentForm.invoice_date || undefined,
          due_date: sponsorPaymentForm.due_date || undefined,
          payment_date: sponsorPaymentForm.payment_date || undefined,
          payment_method: sponsorPaymentForm.payment_method || undefined,
          notes: sponsorPaymentForm.notes || undefined,
        });
        toast.success('Sponsor payment added successfully');
      }
      setShowSponsorPaymentModal(false);
      loadData();
    } catch (error) {
      console.error('Error saving sponsor payment:', error);
      toast.error('Failed to save sponsor payment');
    }
  };

  const handleDeleteSponsorPayment = async () => {
    if (!deletingSponsorPayment) return;
    try {
      await budgetService.deleteSponsorPayment(deletingSponsorPayment.id);
      toast.success('Sponsor payment deleted successfully');
      setDeletingSponsorPayment(null);
      loadData();
    } catch (error) {
      console.error('Error deleting sponsor payment:', error);
      toast.error('Failed to delete sponsor payment');
    }
  };

  // ====== STATUS BADGE HELPERS ======

  const getLineItemStatusBadge = (status: LineItemStatus) => {
    switch (status) {
      case 'paid':
        return <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">Paid</Badge>;
      case 'pending':
        return <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400">Pending</Badge>;
      case 'approved':
        return <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">Approved</Badge>;
      case 'cancelled':
        return <Badge className="bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400">Cancelled</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  const getRevenueStatusBadge = (status: RevenueStatus) => {
    switch (status) {
      case 'confirmed':
        return <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">Confirmed</Badge>;
      case 'pending':
        return <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400">Pending</Badge>;
      case 'refunded':
        return <Badge className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">Refunded</Badge>;
      case 'partial_refund':
        return <Badge className="bg-orange-100 text-orange-800 dark:bg-orange-900/30 dark:text-orange-400">Partial Refund</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  const getSponsorPaymentStatusBadge = (status: SponsorPaymentStatus) => {
    switch (status) {
      case 'paid':
        return <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">Paid</Badge>;
      case 'pending':
        return <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400">Pending</Badge>;
      case 'partial':
        return <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">Partial</Badge>;
      case 'overdue':
        return <Badge className="bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400">Overdue</Badge>;
      case 'cancelled':
        return <Badge className="bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400">Cancelled</Badge>;
      default:
        return <Badge>{status}</Badge>;
    }
  };

  // ====== RENDER ======

  if (loading) {
    return (
      <Card>
        <div className="p-6 flex justify-center">
          <LoadingSpinner size="medium" />
        </div>
      </Card>
    );
  }

  const totalPlanned = calculateTotalPlanned();
  const totalActual = calculateTotalActual();
  const totalRevenue = calculateTotalRevenue();
  const totalSponsorRevenue = calculateTotalSponsorRevenue();
  const variance = totalPlanned - totalActual;
  const isOverBudget = variance < 0;

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-4">
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 dark:bg-blue-900/30 rounded-lg">
              <CurrencyDollarIcon className="w-5 h-5 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <div className="text-sm text-gray-500">Planned Budget</div>
              <div className="text-xl font-bold text-gray-900 dark:text-white">{formatCurrency(totalPlanned)}</div>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-purple-100 dark:bg-purple-900/30 rounded-lg">
              <DocumentTextIcon className="w-5 h-5 text-purple-600 dark:text-purple-400" />
            </div>
            <div>
              <div className="text-sm text-gray-500">Actual Costs</div>
              <div className="text-xl font-bold text-gray-900 dark:text-white">{formatCurrency(totalActual)}</div>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${isOverBudget ? 'bg-red-100 dark:bg-red-900/30' : 'bg-green-100 dark:bg-green-900/30'}`}>
              {isOverBudget ? (
                <ExclamationTriangleIcon className="w-5 h-5 text-red-600 dark:text-red-400" />
              ) : (
                <CheckCircleIcon className="w-5 h-5 text-green-600 dark:text-green-400" />
              )}
            </div>
            <div>
              <div className="text-sm text-gray-500">{isOverBudget ? 'Over Budget' : 'Under Budget'}</div>
              <div className={`text-xl font-bold ${isOverBudget ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                {formatCurrency(Math.abs(variance))}
              </div>
            </div>
          </div>
        </Card>
        <Card className="p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-100 dark:bg-emerald-900/30 rounded-lg">
              <BanknotesIcon className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <div className="text-sm text-gray-500">Total Revenue</div>
              <div className="text-xl font-bold text-emerald-600 dark:text-emerald-400">
                {formatCurrency(totalRevenue + totalSponsorRevenue)}
              </div>
            </div>
          </div>
        </Card>
      </div>

      {/* Section Tabs */}
      <div className="flex gap-2 border-b border-gray-200 dark:border-gray-700">
        <button
          onClick={() => setActiveSection('allocations')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeSection === 'allocations'
              ? 'border-primary-600 text-primary-600 dark:border-primary-400 dark:text-primary-400'
              : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
          }`}
        >
          Budget Allocations
        </button>
        <button
          onClick={() => setActiveSection('lineItems')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeSection === 'lineItems'
              ? 'border-primary-600 text-primary-600 dark:border-primary-400 dark:text-primary-400'
              : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
          }`}
        >
          Line Items ({lineItems.length})
        </button>
        <button
          onClick={() => setActiveSection('revenue')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeSection === 'revenue'
              ? 'border-primary-600 text-primary-600 dark:border-primary-400 dark:text-primary-400'
              : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
          }`}
        >
          Revenue ({revenues.length})
        </button>
        <button
          onClick={() => setActiveSection('sponsorPayments')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeSection === 'sponsorPayments'
              ? 'border-primary-600 text-primary-600 dark:border-primary-400 dark:text-primary-400'
              : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
          }`}
        >
          Sponsor Payments ({sponsorPayments.length})
        </button>
        <button
          onClick={() => setActiveSection('report')}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeSection === 'report'
              ? 'border-primary-600 text-primary-600 dark:border-primary-400 dark:text-primary-400'
              : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
          }`}
        >
          Analytics
        </button>
      </div>

      {/* Budget Allocations Section */}
      {activeSection === 'allocations' && (
        <Card>
          <div className="p-6">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Budget Allocations by Category</h3>
              <Button variant="primary" size="small" onClick={() => handleAddBudget()}>
                <PlusIcon className="w-4 h-4 mr-1" />
                Add Budget
              </Button>
            </div>

            {/* Group by category type */}
            {(['marketing', 'venue', 'catering', 'av', 'supplier', 'other'] as CategoryType[]).map((type) => {
              const typeCategories = getCategoriesByType(type);
              if (typeCategories.length === 0) return null;

              const typeBudgets = budgets.filter((b) => typeCategories.some((c) => c.id === b.category_id));
              const typePlanned = typeBudgets.reduce((sum, b) => sum + (b.planned_amount || 0), 0);
              const typeActual = lineItems
                .filter((li) => typeCategories.some((c) => c.id === li.category_id) && li.status !== 'cancelled')
                .reduce((sum, li) => sum + li.amount * li.quantity, 0);

              return (
                <div key={type} className="mb-6">
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 capitalize">
                      {type} ({typeCategories.length} categories)
                    </h4>
                    <div className="text-sm text-gray-500">
                      Planned: {formatCurrency(typePlanned)} | Actual: {formatCurrency(typeActual)}
                    </div>
                  </div>
                  <div className="space-y-2">
                    {typeCategories.map((category) => {
                      const budget = getBudgetForCategory(category.id);
                      const categoryLineItems = getLineItemsForCategory(category.id);
                      const actualSpend = categoryLineItems
                        .filter((li) => li.status !== 'cancelled')
                        .reduce((sum, li) => sum + li.amount * li.quantity, 0);

                      return (
                        <div
                          key={category.id}
                          className="flex items-center justify-between p-3 bg-gray-50 dark:bg-gray-800/50 rounded-lg"
                        >
                          <div className="flex items-center gap-3">
                            <div
                              className="w-3 h-3 rounded-full"
                              style={{ backgroundColor: category.color || '#6B7280' }}
                            />
                            <span className="text-sm font-medium text-gray-900 dark:text-white">{category.name}</span>
                            {category.registration_source_value && (
                              <Badge className="text-xs bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400">
                                {category.registration_source_value}
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-4">
                            <div className="text-right">
                              <div className="text-sm text-gray-500">Planned</div>
                              <div className="text-sm font-medium text-gray-900 dark:text-white">
                                {budget ? formatCurrency(budget.planned_amount) : '-'}
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="text-sm text-gray-500">Actual</div>
                              <div className="text-sm font-medium text-gray-900 dark:text-white">
                                {formatCurrency(actualSpend)}
                              </div>
                            </div>
                            <div className="flex gap-1">
                              <Button
                                variant="ghost"
                                size="small"
                                onClick={() => (budget ? handleEditBudget(budget) : handleAddBudget(category.id))}
                              >
                                {budget ? <PencilIcon className="w-4 h-4" /> : <PlusIcon className="w-4 h-4" />}
                              </Button>
                              <Button
                                variant="ghost"
                                size="small"
                                onClick={() => handleAddLineItem(category.id)}
                                title="Add line item"
                              >
                                <DocumentTextIcon className="w-4 h-4" />
                              </Button>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Line Items Section */}
      {activeSection === 'lineItems' && (
        <Card>
          <div className="p-6">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Cost Line Items</h3>
              <Button variant="primary" size="small" onClick={() => handleAddLineItem()}>
                <PlusIcon className="w-4 h-4 mr-1" />
                Add Line Item
              </Button>
            </div>

            {lineItems.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <DocumentTextIcon className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p>No line items yet</p>
                <p className="text-sm">Add cost line items to track actual spending</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-700">
                      <th className="text-left py-3 px-3 font-medium text-gray-600 dark:text-gray-400">Description</th>
                      <th className="text-left py-3 px-3 font-medium text-gray-600 dark:text-gray-400">Category</th>
                      <th className="text-left py-3 px-3 font-medium text-gray-600 dark:text-gray-400">Vendor</th>
                      <th className="text-right py-3 px-3 font-medium text-gray-600 dark:text-gray-400">Amount</th>
                      <th className="text-center py-3 px-3 font-medium text-gray-600 dark:text-gray-400">Qty</th>
                      <th className="text-right py-3 px-3 font-medium text-gray-600 dark:text-gray-400">Total</th>
                      <th className="text-center py-3 px-3 font-medium text-gray-600 dark:text-gray-400">Status</th>
                      <th className="text-right py-3 px-3 font-medium text-gray-600 dark:text-gray-400">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lineItems.map((item) => {
                      const category = getCategoryById(item.category_id);
                      return (
                        <tr key={item.id} className="border-b border-gray-100 dark:border-gray-800">
                          <td className="py-3 px-3">
                            <div className="font-medium text-gray-900 dark:text-white">{item.description}</div>
                            {item.invoice_number && (
                              <div className="text-xs text-gray-500">Invoice: {item.invoice_number}</div>
                            )}
                          </td>
                          <td className="py-3 px-3">
                            <div className="flex items-center gap-2">
                              <div
                                className="w-2 h-2 rounded-full"
                                style={{ backgroundColor: category?.color || '#6B7280' }}
                              />
                              <span className="text-gray-600 dark:text-gray-400">{category?.name || 'Unknown'}</span>
                            </div>
                          </td>
                          <td className="py-3 px-3 text-gray-600 dark:text-gray-400">{item.vendor_name || '-'}</td>
                          <td className="py-3 px-3 text-right text-gray-900 dark:text-white">
                            {formatCurrency(item.amount)}
                          </td>
                          <td className="py-3 px-3 text-center text-gray-600 dark:text-gray-400">{item.quantity}</td>
                          <td className="py-3 px-3 text-right font-medium text-gray-900 dark:text-white">
                            {formatCurrency(item.amount * item.quantity)}
                          </td>
                          <td className="py-3 px-3 text-center">{getLineItemStatusBadge(item.status)}</td>
                          <td className="py-3 px-3 text-right">
                            <div className="flex justify-end gap-1">
                              <Button variant="ghost" size="small" onClick={() => handleEditLineItem(item)}>
                                <PencilIcon className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="small"
                                onClick={() => setDeletingLineItem(item)}
                                className="text-red-600 hover:text-red-700"
                              >
                                <TrashIcon className="w-4 h-4" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="bg-gray-50 dark:bg-gray-800/50">
                      <td colSpan={5} className="py-3 px-3 text-right font-medium text-gray-700 dark:text-gray-300">
                        Total:
                      </td>
                      <td className="py-3 px-3 text-right font-bold text-gray-900 dark:text-white">
                        {formatCurrency(totalActual)}
                      </td>
                      <td colSpan={2}></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* Revenue Section */}
      {activeSection === 'revenue' && (
        <Card>
          <div className="p-6">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Revenue</h3>
              <Button variant="primary" size="small" onClick={handleAddRevenue}>
                <PlusIcon className="w-4 h-4 mr-1" />
                Add Revenue
              </Button>
            </div>

            {revenues.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <BanknotesIcon className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p>No revenue recorded yet</p>
                <p className="text-sm">Add ticket sales and other revenue sources</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-700">
                      <th className="text-left py-3 px-3 font-medium text-gray-600 dark:text-gray-400">Description</th>
                      <th className="text-left py-3 px-3 font-medium text-gray-600 dark:text-gray-400">Source</th>
                      <th className="text-left py-3 px-3 font-medium text-gray-600 dark:text-gray-400">Date</th>
                      <th className="text-right py-3 px-3 font-medium text-gray-600 dark:text-gray-400">Gross</th>
                      <th className="text-right py-3 px-3 font-medium text-gray-600 dark:text-gray-400">Fees</th>
                      <th className="text-right py-3 px-3 font-medium text-gray-600 dark:text-gray-400">Net</th>
                      <th className="text-center py-3 px-3 font-medium text-gray-600 dark:text-gray-400">Status</th>
                      <th className="text-right py-3 px-3 font-medium text-gray-600 dark:text-gray-400">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {revenues.map((revenue) => (
                      <tr key={revenue.id} className="border-b border-gray-100 dark:border-gray-800">
                        <td className="py-3 px-3">
                          <div className="font-medium text-gray-900 dark:text-white">{revenue.description}</div>
                          {revenue.ticket_type && (
                            <div className="text-xs text-gray-500">Ticket: {revenue.ticket_type}</div>
                          )}
                        </td>
                        <td className="py-3 px-3">
                          <Badge className="text-xs capitalize">{revenue.source_type}</Badge>
                          {revenue.source_name && (
                            <span className="ml-1 text-gray-500 text-xs">{revenue.source_name}</span>
                          )}
                        </td>
                        <td className="py-3 px-3 text-gray-600 dark:text-gray-400">{revenue.revenue_date}</td>
                        <td className="py-3 px-3 text-right text-gray-900 dark:text-white">
                          {formatCurrency(revenue.gross_amount)}
                        </td>
                        <td className="py-3 px-3 text-right text-red-600 dark:text-red-400">
                          -{formatCurrency(revenue.fees || 0)}
                        </td>
                        <td className="py-3 px-3 text-right font-medium text-green-600 dark:text-green-400">
                          {formatCurrency(revenue.net_amount || revenue.gross_amount - (revenue.fees || 0))}
                        </td>
                        <td className="py-3 px-3 text-center">{getRevenueStatusBadge(revenue.status)}</td>
                        <td className="py-3 px-3 text-right">
                          <div className="flex justify-end gap-1">
                            <Button variant="ghost" size="small" onClick={() => handleEditRevenue(revenue)}>
                              <PencilIcon className="w-4 h-4" />
                            </Button>
                            <Button
                              variant="ghost"
                              size="small"
                              onClick={() => setDeletingRevenue(revenue)}
                              className="text-red-600 hover:text-red-700"
                            >
                              <TrashIcon className="w-4 h-4" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-gray-50 dark:bg-gray-800/50">
                      <td colSpan={5} className="py-3 px-3 text-right font-medium text-gray-700 dark:text-gray-300">
                        Total Net Revenue:
                      </td>
                      <td className="py-3 px-3 text-right font-bold text-green-600 dark:text-green-400">
                        {formatCurrency(totalRevenue)}
                      </td>
                      <td colSpan={2}></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* Sponsor Payments Section */}
      {activeSection === 'sponsorPayments' && (
        <Card>
          <div className="p-6">
            <div className="flex items-center justify-between mb-6">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Sponsor Payments</h3>
              <Button variant="primary" size="small" onClick={handleAddSponsorPayment}>
                <PlusIcon className="w-4 h-4 mr-1" />
                Add Payment
              </Button>
            </div>

            {sponsorPayments.length === 0 ? (
              <div className="text-center py-8 text-gray-500">
                <BuildingOfficeIcon className="w-12 h-12 mx-auto mb-3 opacity-50" />
                <p>No sponsor payments recorded yet</p>
                <p className="text-sm">Track sponsor payments and contracted amounts</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-700">
                      <th className="text-left py-3 px-3 font-medium text-gray-600 dark:text-gray-400">Description</th>
                      <th className="text-left py-3 px-3 font-medium text-gray-600 dark:text-gray-400">Package</th>
                      <th className="text-right py-3 px-3 font-medium text-gray-600 dark:text-gray-400">Contracted</th>
                      <th className="text-right py-3 px-3 font-medium text-gray-600 dark:text-gray-400">Paid</th>
                      <th className="text-right py-3 px-3 font-medium text-gray-600 dark:text-gray-400">Outstanding</th>
                      <th className="text-center py-3 px-3 font-medium text-gray-600 dark:text-gray-400">Status</th>
                      <th className="text-right py-3 px-3 font-medium text-gray-600 dark:text-gray-400">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sponsorPayments.map((payment) => {
                      const outstanding = payment.contracted_amount - (payment.paid_amount || 0);
                      return (
                        <tr key={payment.id} className="border-b border-gray-100 dark:border-gray-800">
                          <td className="py-3 px-3">
                            <div className="font-medium text-gray-900 dark:text-white">{payment.description}</div>
                            {payment.invoice_number && (
                              <div className="text-xs text-gray-500">Invoice: {payment.invoice_number}</div>
                            )}
                          </td>
                          <td className="py-3 px-3 text-gray-600 dark:text-gray-400">
                            {payment.sponsorship_package || '-'}
                          </td>
                          <td className="py-3 px-3 text-right text-gray-900 dark:text-white">
                            {formatCurrency(payment.contracted_amount)}
                          </td>
                          <td className="py-3 px-3 text-right text-green-600 dark:text-green-400">
                            {formatCurrency(payment.paid_amount || 0)}
                          </td>
                          <td className="py-3 px-3 text-right">
                            <span className={outstanding > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-500'}>
                              {formatCurrency(outstanding)}
                            </span>
                          </td>
                          <td className="py-3 px-3 text-center">{getSponsorPaymentStatusBadge(payment.payment_status)}</td>
                          <td className="py-3 px-3 text-right">
                            <div className="flex justify-end gap-1">
                              <Button variant="ghost" size="small" onClick={() => handleEditSponsorPayment(payment)}>
                                <PencilIcon className="w-4 h-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="small"
                                onClick={() => setDeletingSponsorPayment(payment)}
                                className="text-red-600 hover:text-red-700"
                              >
                                <TrashIcon className="w-4 h-4" />
                              </Button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="bg-gray-50 dark:bg-gray-800/50">
                      <td colSpan={3} className="py-3 px-3 text-right font-medium text-gray-700 dark:text-gray-300">
                        Totals:
                      </td>
                      <td className="py-3 px-3 text-right font-bold text-green-600 dark:text-green-400">
                        {formatCurrency(totalSponsorRevenue)}
                      </td>
                      <td className="py-3 px-3 text-right font-bold text-amber-600 dark:text-amber-400">
                        {formatCurrency(
                          sponsorPayments
                            .filter((sp) => sp.payment_status !== 'cancelled')
                            .reduce((sum, sp) => sum + (sp.contracted_amount - (sp.paid_amount || 0)), 0)
                        )}
                      </td>
                      <td colSpan={2}></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* Analytics Section */}
      {activeSection === 'report' && (
        <EventBudgetReport eventId={eventId} />
      )}

      {/* Budget Modal */}
      <Modal
        isOpen={showBudgetModal}
        onClose={() => setShowBudgetModal(false)}
        title={editingBudget ? 'Edit Budget' : 'Add Budget'}
        footer={
          <div className="flex justify-end gap-3 p-4">
            <Button variant="outline" onClick={() => setShowBudgetModal(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleSaveBudget}>
              {editingBudget ? 'Update' : 'Add'} Budget
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Category *</label>
            <Select
              value={budgetForm.category_id}
              onChange={(e) => setBudgetForm({ ...budgetForm, category_id: e.target.value })}
            >
              <option value="">Select a category</option>
              {(['marketing', 'venue', 'catering', 'av', 'supplier', 'other'] as CategoryType[]).map((type) => (
                <optgroup key={type} label={type.charAt(0).toUpperCase() + type.slice(1)}>
                  {getCategoriesByType(type).map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Planned Amount ($) *</label>
            <Input
              type="number"
              min="0"
              step="0.01"
              value={budgetForm.planned_amount}
              onChange={(e) => setBudgetForm({ ...budgetForm, planned_amount: e.target.value })}
              placeholder="0.00"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Notes</label>
            <Input
              value={budgetForm.notes}
              onChange={(e) => setBudgetForm({ ...budgetForm, notes: e.target.value })}
              placeholder="Optional notes"
            />
          </div>
        </div>
      </Modal>

      {/* Line Item Modal */}
      <Modal
        isOpen={showLineItemModal}
        onClose={() => setShowLineItemModal(false)}
        title={editingLineItem ? 'Edit Line Item' : 'Add Line Item'}
        footer={
          <div className="flex justify-end gap-3 p-4">
            <Button variant="outline" onClick={() => setShowLineItemModal(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleSaveLineItem}>
              {editingLineItem ? 'Update' : 'Add'} Line Item
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Category *</label>
            <Select
              value={lineItemForm.category_id}
              onChange={(e) => setLineItemForm({ ...lineItemForm, category_id: e.target.value })}
            >
              <option value="">Select a category</option>
              {(['marketing', 'venue', 'catering', 'av', 'supplier', 'other'] as CategoryType[]).map((type) => (
                <optgroup key={type} label={type.charAt(0).toUpperCase() + type.slice(1)}>
                  {getCategoriesByType(type).map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </Select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Description</label>
            <Input
              value={lineItemForm.description}
              onChange={(e) => setLineItemForm({ ...lineItemForm, description: e.target.value })}
              placeholder="What is this cost for? (optional)"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Amount ($) *</label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={lineItemForm.amount}
                onChange={(e) => setLineItemForm({ ...lineItemForm, amount: e.target.value })}
                placeholder="0.00"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Quantity</label>
              <Input
                type="number"
                min="1"
                value={lineItemForm.quantity}
                onChange={(e) => setLineItemForm({ ...lineItemForm, quantity: e.target.value })}
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Vendor Name</label>
            <Input
              value={lineItemForm.vendor_name}
              onChange={(e) => setLineItemForm({ ...lineItemForm, vendor_name: e.target.value })}
              placeholder="Company or person"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Invoice Number</label>
              <Input
                value={lineItemForm.invoice_number}
                onChange={(e) => setLineItemForm({ ...lineItemForm, invoice_number: e.target.value })}
                placeholder="INV-001"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Status</label>
              <Select
                value={lineItemForm.status}
                onChange={(e) => setLineItemForm({ ...lineItemForm, status: e.target.value as LineItemStatus })}
              >
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="paid">Paid</option>
                <option value="cancelled">Cancelled</option>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Invoice Date</label>
              <Input
                type="date"
                value={lineItemForm.invoice_date}
                onChange={(e) => setLineItemForm({ ...lineItemForm, invoice_date: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Due Date</label>
              <Input
                type="date"
                value={lineItemForm.due_date}
                onChange={(e) => setLineItemForm({ ...lineItemForm, due_date: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Payment Date</label>
              <Input
                type="date"
                value={lineItemForm.payment_date}
                onChange={(e) => setLineItemForm({ ...lineItemForm, payment_date: e.target.value })}
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Notes</label>
            <Input
              value={lineItemForm.notes}
              onChange={(e) => setLineItemForm({ ...lineItemForm, notes: e.target.value })}
              placeholder="Additional notes"
            />
          </div>
        </div>
      </Modal>

      {/* Revenue Modal */}
      <Modal
        isOpen={showRevenueModal}
        onClose={() => setShowRevenueModal(false)}
        title={editingRevenue ? 'Edit Revenue' : 'Add Revenue'}
        footer={
          <div className="flex justify-end gap-3 p-4">
            <Button variant="outline" onClick={() => setShowRevenueModal(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleSaveRevenue}>
              {editingRevenue ? 'Update' : 'Add'} Revenue
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Source Type *</label>
              <Select
                value={revenueForm.source_type}
                onChange={(e) => setRevenueForm({ ...revenueForm, source_type: e.target.value })}
              >
                <option value="stripe">Stripe</option>
                <option value="external">External Platform</option>
                <option value="sponsorship">Sponsorship</option>
                <option value="other">Other</option>
              </Select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Source Name</label>
              <Input
                value={revenueForm.source_name}
                onChange={(e) => setRevenueForm({ ...revenueForm, source_name: e.target.value })}
                placeholder="e.g., Eventbrite, Luma"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Description *</label>
            <Input
              value={revenueForm.description}
              onChange={(e) => setRevenueForm({ ...revenueForm, description: e.target.value })}
              placeholder="e.g., Early Bird Tickets"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Ticket Type</label>
              <Input
                value={revenueForm.ticket_type}
                onChange={(e) => setRevenueForm({ ...revenueForm, ticket_type: e.target.value })}
                placeholder="e.g., VIP, General"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Revenue Date *</label>
              <Input
                type="date"
                value={revenueForm.revenue_date}
                onChange={(e) => setRevenueForm({ ...revenueForm, revenue_date: e.target.value })}
              />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Gross Amount ($) *</label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={revenueForm.gross_amount}
                onChange={(e) => setRevenueForm({ ...revenueForm, gross_amount: e.target.value })}
                placeholder="0.00"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Fees ($)</label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={revenueForm.fees}
                onChange={(e) => setRevenueForm({ ...revenueForm, fees: e.target.value })}
                placeholder="0.00"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Quantity</label>
              <Input
                type="number"
                min="1"
                value={revenueForm.quantity}
                onChange={(e) => setRevenueForm({ ...revenueForm, quantity: e.target.value })}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">External Reference</label>
              <Input
                value={revenueForm.external_reference}
                onChange={(e) => setRevenueForm({ ...revenueForm, external_reference: e.target.value })}
                placeholder="Invoice or transaction ID"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Status</label>
              <Select
                value={revenueForm.status}
                onChange={(e) => setRevenueForm({ ...revenueForm, status: e.target.value as RevenueStatus })}
              >
                <option value="pending">Pending</option>
                <option value="confirmed">Confirmed</option>
                <option value="refunded">Refunded</option>
                <option value="partial_refund">Partial Refund</option>
              </Select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Notes</label>
            <Input
              value={revenueForm.notes}
              onChange={(e) => setRevenueForm({ ...revenueForm, notes: e.target.value })}
              placeholder="Additional notes"
            />
          </div>
        </div>
      </Modal>

      {/* Sponsor Payment Modal */}
      <Modal
        isOpen={showSponsorPaymentModal}
        onClose={() => setShowSponsorPaymentModal(false)}
        title={editingSponsorPayment ? 'Edit Sponsor Payment' : 'Add Sponsor Payment'}
        footer={
          <div className="flex justify-end gap-3 p-4">
            <Button variant="outline" onClick={() => setShowSponsorPaymentModal(false)}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleSaveSponsorPayment}>
              {editingSponsorPayment ? 'Update' : 'Add'} Payment
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          {/* Sponsor dropdown - only show for new payments */}
          {!editingSponsorPayment && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Sponsor *</label>
              {eventSponsors.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  No sponsors found for this event. Add sponsors in the Sponsors tab first.
                </p>
              ) : (
                <Select
                  value={sponsorPaymentForm.event_sponsor_id}
                  onChange={(e) => {
                    const selectedSponsor = eventSponsors.find(es => es.id === e.target.value);
                    setSponsorPaymentForm({
                      ...sponsorPaymentForm,
                      event_sponsor_id: e.target.value,
                      sponsor_id: selectedSponsor?.sponsor_id || '',
                      sponsorship_package: selectedSponsor?.sponsorship_tier || sponsorPaymentForm.sponsorship_package,
                    });
                  }}
                >
                  <option value="">Select a sponsor</option>
                  {eventSponsors.map((es) => (
                    <option key={es.id} value={es.id}>
                      {es.sponsor.name} {es.sponsorship_tier ? `(${es.sponsorship_tier})` : ''}
                    </option>
                  ))}
                </Select>
              )}
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Description</label>
            <Input
              value={sponsorPaymentForm.description}
              onChange={(e) => setSponsorPaymentForm({ ...sponsorPaymentForm, description: e.target.value })}
              placeholder="e.g., Gold Sponsorship Package (auto-generated if blank)"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Sponsorship Package</label>
            <Select
              value={sponsorPaymentForm.sponsorship_package}
              onChange={(e) => setSponsorPaymentForm({ ...sponsorPaymentForm, sponsorship_package: e.target.value })}
            >
              <option value="">Select package</option>
              <option value="Platinum">Platinum</option>
              <option value="Gold">Gold</option>
              <option value="Silver">Silver</option>
              <option value="Bronze">Bronze</option>
              <option value="Partner">Partner</option>
              <option value="Exhibitor">Exhibitor</option>
              <option value="Custom">Custom</option>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Contracted Amount ($) *</label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={sponsorPaymentForm.contracted_amount}
                onChange={(e) => setSponsorPaymentForm({ ...sponsorPaymentForm, contracted_amount: e.target.value })}
                placeholder="0.00"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Paid Amount ($)</label>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={sponsorPaymentForm.paid_amount}
                onChange={(e) => setSponsorPaymentForm({ ...sponsorPaymentForm, paid_amount: e.target.value })}
                placeholder="0.00"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Payment Status</label>
              <Select
                value={sponsorPaymentForm.payment_status}
                onChange={(e) =>
                  setSponsorPaymentForm({ ...sponsorPaymentForm, payment_status: e.target.value as SponsorPaymentStatus })
                }
              >
                <option value="pending">Pending</option>
                <option value="partial">Partial</option>
                <option value="paid">Paid</option>
                <option value="overdue">Overdue</option>
                <option value="cancelled">Cancelled</option>
              </Select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Payment Method</label>
              <Select
                value={sponsorPaymentForm.payment_method}
                onChange={(e) => setSponsorPaymentForm({ ...sponsorPaymentForm, payment_method: e.target.value })}
              >
                <option value="">Select method</option>
                <option value="bank_transfer">Bank Transfer</option>
                <option value="credit_card">Credit Card</option>
                <option value="check">Check</option>
                <option value="stripe">Stripe</option>
                <option value="other">Other</option>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Invoice Number</label>
              <Input
                value={sponsorPaymentForm.invoice_number}
                onChange={(e) => setSponsorPaymentForm({ ...sponsorPaymentForm, invoice_number: e.target.value })}
                placeholder="INV-001"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Due Date</label>
              <Input
                type="date"
                value={sponsorPaymentForm.due_date}
                onChange={(e) => setSponsorPaymentForm({ ...sponsorPaymentForm, due_date: e.target.value })}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Invoice Date</label>
              <Input
                type="date"
                value={sponsorPaymentForm.invoice_date}
                onChange={(e) => setSponsorPaymentForm({ ...sponsorPaymentForm, invoice_date: e.target.value })}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Payment Date</label>
              <Input
                type="date"
                value={sponsorPaymentForm.payment_date}
                onChange={(e) => setSponsorPaymentForm({ ...sponsorPaymentForm, payment_date: e.target.value })}
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Notes</label>
            <Input
              value={sponsorPaymentForm.notes}
              onChange={(e) => setSponsorPaymentForm({ ...sponsorPaymentForm, notes: e.target.value })}
              placeholder="Additional notes"
            />
          </div>
        </div>
      </Modal>

      {/* Delete Confirmations */}
      <ConfirmModal
        isOpen={!!deletingLineItem}
        onClose={() => setDeletingLineItem(null)}
        onConfirm={handleDeleteLineItem}
        title="Delete Line Item"
        message={`Are you sure you want to delete "${deletingLineItem?.description}"? This action cannot be undone.`}
        confirmText="Delete"
        confirmVariant="danger"
      />

      <ConfirmModal
        isOpen={!!deletingRevenue}
        onClose={() => setDeletingRevenue(null)}
        onConfirm={handleDeleteRevenue}
        title="Delete Revenue"
        message={`Are you sure you want to delete "${deletingRevenue?.description}"? This action cannot be undone.`}
        confirmText="Delete"
        confirmVariant="danger"
      />

      <ConfirmModal
        isOpen={!!deletingSponsorPayment}
        onClose={() => setDeletingSponsorPayment(null)}
        onConfirm={handleDeleteSponsorPayment}
        title="Delete Sponsor Payment"
        message={`Are you sure you want to delete "${deletingSponsorPayment?.description}"? This action cannot be undone.`}
        confirmText="Delete"
        confirmVariant="danger"
      />
    </div>
  );
}
