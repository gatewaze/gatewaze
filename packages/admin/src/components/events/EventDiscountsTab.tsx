// @ts-nocheck
import { useState, useEffect } from 'react';
import { toast } from 'sonner';
import {
  PlusIcon,
  PencilIcon,
  TrashIcon,
  TagIcon,
  ChevronDownIcon,
  ChevronUpIcon,
} from '@heroicons/react/24/outline';
import { Card, Button, ConfirmModal, Badge, Modal } from '@/components/ui-legacy';
import { Input, Select, Checkbox, Textarea } from '@/components/ui-legacy/Form';
import RichTextEditor from '@/components/ui-legacy/RichTextEditor';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import { supabase } from '@/lib/supabase';

interface EventDiscount {
  id: string;
  event_id: string;
  title: string;
  slug: string;
  value: string | null;
  ticket_details: string | null;
  close_date: string | null;
  close_display: string | null;
  intro: string | null;
  content: string | null;
  status: 'active' | 'closed' | 'cancelled';
  is_beta: boolean;
  sort_order: number | null;
  created_at: string;
  updated_at: string | null;
  luma_event_api_id: string | null;
  luma_api_key: string | null;
  luma_percent_off: number | null;
  max_codes: number | null;
  hidden: boolean;
}

interface DiscountClaim {
  id: string;
  discount_id: string;
  email: string;
  status: string;
  created_at: string;
  updated_at: string | null;
}

interface DiscountCode {
  id: string;
  code: string;
  issued_to: string | null;
  issued_at: string | null;
}

interface DiscountFormData {
  title: string;
  slug: string;
  value: string;
  ticket_details: string;
  close_date: string;
  close_display: string;
  intro: string;
  content: string;
  status: 'active' | 'closed' | 'cancelled';
  is_beta: boolean;
  hidden: boolean;
  luma_event_api_id: string;
  luma_api_key: string;
  luma_percent_off: string;
  max_codes: string;
}

const emptyForm: DiscountFormData = {
  title: '',
  slug: '',
  value: '',
  ticket_details: '',
  close_date: '',
  close_display: '',
  intro: '',
  content: '',
  status: 'active',
  is_beta: false,
  hidden: false,
  luma_event_api_id: '',
  luma_api_key: '',
  luma_percent_off: '100',
  max_codes: '',
};

interface EventDiscountsTabProps {
  eventId: string;
}

export const EventDiscountsTab = ({ eventId }: EventDiscountsTabProps) => {
  const [discounts, setDiscounts] = useState<EventDiscount[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [claimCounts, setClaimCounts] = useState<Record<string, number>>({});
  const [codeCounts, setCodeCounts] = useState<Record<string, number>>({});
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [claimsMap, setClaimsMap] = useState<Record<string, DiscountClaim[]>>({});
  const [codesMap, setCodesMap] = useState<Record<string, DiscountCode[]>>({});
  const [loadingMap, setLoadingMap] = useState<Record<string, boolean>>({});

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingDiscount, setEditingDiscount] = useState<EventDiscount | null>(null);
  const [formData, setFormData] = useState<DiscountFormData>(emptyForm);

  // Delete discount modal state
  const [deleteModal, setDeleteModal] = useState<{
    isOpen: boolean;
    discountId: string | null;
    discountTitle: string;
  }>({
    isOpen: false,
    discountId: null,
    discountTitle: '',
  });

  // Delete row modal state (codes or claims)
  const [deleteRowModal, setDeleteRowModal] = useState<{
    isOpen: boolean;
    type: 'code' | 'claim';
    rowId: string | null;
    discountId: string | null;
    label: string;
  }>({
    isOpen: false,
    type: 'code',
    rowId: null,
    discountId: null,
    label: '',
  });

  useEffect(() => {
    loadDiscounts();
  }, [eventId]);

  const loadDiscounts = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('event_discounts')
        .select('*')
        .eq('event_id', eventId)
        .order('sort_order', { ascending: true });

      if (error) throw error;

      const discountList = data || [];
      setDiscounts(discountList);

      // Load counts for each discount
      const claimCountsResult: Record<string, number> = {};
      const codeCountsResult: Record<string, number> = {};
      await Promise.all(
        discountList.map(async (discount) => {
          if (discount.luma_event_api_id) {
            // Dynamic: count issued discount_codes for this event
            const { count } = await supabase
              .from('discount_codes')
              .select('*', { count: 'exact', head: true })
              .eq('event_id', discount.event_id)
              .eq('issued', true);
            codeCountsResult[discount.id] = count || 0;
          } else {
            // Legacy: count discount_claims
            const { count } = await supabase
              .from('discount_claims')
              .select('*', { count: 'exact', head: true })
              .eq('discount_id', discount.id);
            claimCountsResult[discount.id] = count || 0;
          }
        })
      );
      setClaimCounts(claimCountsResult);
      setCodeCounts(codeCountsResult);

      // Auto-expand all and load their data
      setExpandedIds(new Set(discountList.map((d) => d.id)));
      discountList.forEach((discount) => {
        if (discount.luma_event_api_id) {
          loadCodes(discount);
        } else {
          loadClaims(discount.id);
        }
      });
    } catch (error) {
      console.error('Error loading discounts:', error);
      toast.error('Failed to load discounts');
    } finally {
      setLoading(false);
    }
  };

  const loadClaims = async (discountId: string) => {
    setLoadingMap((prev) => ({ ...prev, [discountId]: true }));
    try {
      const { data, error } = await supabase
        .from('discount_claims')
        .select('*')
        .eq('discount_id', discountId)
        .order('created_at', { ascending: false });

      if (error) throw error;
      setClaimsMap((prev) => ({ ...prev, [discountId]: data || [] }));
    } catch (error) {
      console.error('Error loading claims:', error);
      toast.error('Failed to load claims');
    } finally {
      setLoadingMap((prev) => ({ ...prev, [discountId]: false }));
    }
  };

  const loadCodes = async (discount: EventDiscount) => {
    setLoadingMap((prev) => ({ ...prev, [discount.id]: true }));
    try {
      const { data, error } = await supabase
        .from('discount_codes')
        .select('id, code, issued_to, issued_at')
        .eq('event_id', discount.event_id)
        .eq('issued', true)
        .order('issued_at', { ascending: false });

      if (error) throw error;
      setCodesMap((prev) => ({ ...prev, [discount.id]: data || [] }));
    } catch (error) {
      console.error('Error loading codes:', error);
      toast.error('Failed to load issued codes');
    } finally {
      setLoadingMap((prev) => ({ ...prev, [discount.id]: false }));
    }
  };

  const handleToggleExpand = (discount: EventDiscount) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(discount.id)) {
        next.delete(discount.id);
      } else {
        next.add(discount.id);
        if (discount.luma_event_api_id) {
          loadCodes(discount);
        } else {
          loadClaims(discount.id);
        }
      }
      return next;
    });
  };

  const handleAddClick = () => {
    setEditingDiscount(null);
    setFormData(emptyForm);
    setModalOpen(true);
  };

  const handleEditClick = (discount: EventDiscount) => {
    setEditingDiscount(discount);
    setFormData({
      title: discount.title || '',
      slug: discount.slug || '',
      value: discount.value || '',
      ticket_details: discount.ticket_details || '',
      close_date: discount.close_date
        ? discount.close_date.slice(0, 16)
        : '',
      close_display: discount.close_display || '',
      intro: discount.intro || '',
      content: discount.content || '',
      status: discount.status || 'active',
      is_beta: discount.is_beta || false,
      hidden: discount.hidden || false,
      luma_event_api_id: discount.luma_event_api_id || '',
      luma_api_key: discount.luma_api_key || '',
      luma_percent_off: discount.luma_percent_off != null ? String(discount.luma_percent_off) : '100',
      max_codes: discount.max_codes != null ? String(discount.max_codes) : '',
    });
    setModalOpen(true);
  };

  const handleDeleteClick = (discountId: string, title: string) => {
    setDeleteModal({
      isOpen: true,
      discountId,
      discountTitle: title,
    });
  };

  const handleDeleteConfirm = async () => {
    if (!deleteModal.discountId) return;

    try {
      const { error } = await supabase
        .from('event_discounts')
        .delete()
        .eq('id', deleteModal.discountId);

      if (error) throw error;

      setDiscounts(discounts.filter((d) => d.id !== deleteModal.discountId));
      const newClaimCounts = { ...claimCounts };
      const newCodeCounts = { ...codeCounts };
      delete newClaimCounts[deleteModal.discountId];
      delete newCodeCounts[deleteModal.discountId];
      setClaimCounts(newClaimCounts);
      setCodeCounts(newCodeCounts);

      setExpandedIds((prev) => {
        const next = new Set(prev);
        next.delete(deleteModal.discountId!);
        return next;
      });

      toast.success('Discount deleted successfully');
      setDeleteModal({ isOpen: false, discountId: null, discountTitle: '' });
    } catch (error) {
      console.error('Error deleting discount:', error);
      toast.error('Failed to delete discount');
    }
  };

  const handleDeleteRowConfirm = async () => {
    const { type, rowId, discountId } = deleteRowModal;
    if (!rowId || !discountId) return;

    try {
      if (type === 'code') {
        const { error } = await supabase
          .from('discount_codes')
          .delete()
          .eq('id', rowId);
        if (error) throw error;
        setCodesMap((prev) => ({
          ...prev,
          [discountId]: (prev[discountId] || []).filter((c) => c.id !== rowId),
        }));
        setCodeCounts((prev) => ({ ...prev, [discountId]: Math.max(0, (prev[discountId] ?? 1) - 1) }));
        toast.success('Code deleted');
      } else {
        const { error } = await supabase
          .from('discount_claims')
          .delete()
          .eq('id', rowId);
        if (error) throw error;
        setClaimsMap((prev) => ({
          ...prev,
          [discountId]: (prev[discountId] || []).filter((c) => c.id !== rowId),
        }));
        setClaimCounts((prev) => ({ ...prev, [discountId]: Math.max(0, (prev[discountId] ?? 1) - 1) }));
        toast.success('Claim deleted');
      }
      setDeleteRowModal({ isOpen: false, type: 'code', rowId: null, discountId: null, label: '' });
    } catch (error) {
      console.error('Error deleting row:', error);
      toast.error('Failed to delete');
    }
  };

  const handleSave = async () => {
    if (!formData.title.trim()) {
      toast.error('Title is required');
      return;
    }
    if (!formData.slug.trim()) {
      toast.error('Slug is required');
      return;
    }

    setSaving(true);
    try {
      const payload = {
        title: formData.title.trim(),
        slug: formData.slug.trim(),
        value: formData.value.trim() || null,
        ticket_details: formData.ticket_details.trim() || null,
        close_date: formData.close_date || null,
        close_display: formData.close_display.trim() || null,
        intro: formData.intro.trim() || null,
        content: formData.content.trim() || null,
        status: formData.status,
        is_beta: formData.is_beta,
        hidden: formData.hidden,
        luma_event_api_id: formData.luma_event_api_id.trim() || null,
        luma_api_key: formData.luma_api_key.trim() || null,
        luma_percent_off: formData.luma_event_api_id.trim()
          ? (parseInt(formData.luma_percent_off, 10) || 100)
          : null,
        max_codes: formData.max_codes.trim() ? parseInt(formData.max_codes, 10) : null,
      };

      if (editingDiscount) {
        const { data, error } = await supabase
          .from('event_discounts')
          .update(payload)
          .eq('id', editingDiscount.id)
          .select()
          .single();

        if (error) throw error;

        setDiscounts(
          discounts.map((d) => (d.id === editingDiscount.id ? data : d))
        );
        toast.success('Discount updated successfully');
      } else {
        const { data, error } = await supabase
          .from('event_discounts')
          .insert({ ...payload, event_id: eventId })
          .select()
          .single();

        if (error) throw error;

        setDiscounts([...discounts, data]);
        setClaimCounts({ ...claimCounts, [data.id]: 0 });
        setCodeCounts({ ...codeCounts, [data.id]: 0 });
        toast.success('Discount created successfully');
      }

      setModalOpen(false);
      setEditingDiscount(null);
      setFormData(emptyForm);
    } catch (error) {
      console.error('Error saving discount:', error);
      toast.error('Failed to save discount');
    } finally {
      setSaving(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return <Badge color="success">Active</Badge>;
      case 'closed':
        return <Badge color="neutral">Closed</Badge>;
      case 'cancelled':
        return <Badge color="error">Cancelled</Badge>;
      default:
        return <Badge color="neutral">{status}</Badge>;
    }
  };

  const getClaimStatusBadge = (status: string) => {
    switch (status) {
      case 'accepted':
        return <Badge color="success">Accepted</Badge>;
      case 'viewed':
        return <Badge color="info">Viewed</Badge>;
      case 'code-issued':
        return <Badge color="warning">Code Issued</Badge>;
      case 'deposit-initiated':
        return <Badge color="info">Deposit Initiated</Badge>;
      case 'deposit-paid':
        return <Badge color="success">Deposit Paid</Badge>;
      case 'sold-out':
        return <Badge color="error">Sold Out</Badge>;
      default:
        return <Badge color="neutral">{status}</Badge>;
    }
  };

  if (loading) {
    return (
      <Card>
        <div className="p-6 flex justify-center">
          <LoadingSpinner size="medium" />
        </div>
      </Card>
    );
  }

  return (
    <Card>
      <div className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            Discounts ({discounts.length})
          </h3>
          <Button variant="secondary" size="small" onClick={handleAddClick}>
            <PlusIcon className="w-4 h-4 mr-1" />
            Add Discount
          </Button>
        </div>

        {discounts.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <TagIcon className="w-12 h-12 mx-auto mb-3 text-gray-400" />
            <p>No discounts yet</p>
            <p className="text-sm mt-1">
              Create a discount to offer special pricing for this event
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {discounts.map((discount) => {
              const isDynamic = !!discount.luma_event_api_id;
              const isExpanded = expandedIds.has(discount.id);
              const isLoadingData = loadingMap[discount.id];
              const count = isDynamic
                ? (codeCounts[discount.id] ?? 0)
                : (claimCounts[discount.id] ?? 0);

              return (
                <div
                  key={discount.id}
                  className="border border-gray-200 dark:border-dark-300 rounded-lg overflow-hidden"
                >
                  {/* Discount card header */}
                  <div
                    className="flex items-center justify-between p-4 cursor-pointer hover:bg-gray-50 dark:hover:bg-surface-2 transition-colors"
                    onClick={() => handleToggleExpand(discount)}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h4 className="text-sm font-medium text-gray-900 dark:text-white truncate">
                          {discount.title}
                        </h4>
                        {getStatusBadge(discount.status)}
                        {isDynamic && (
                          <Badge color="info" variant="outlined">Dynamic</Badge>
                        )}
                        {discount.is_beta && (
                          <Badge color="secondary" variant="outlined">Beta</Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-4 text-xs text-gray-500 dark:text-dark-200">
                        <span>Slug: {discount.slug}</span>
                        {discount.value && <span>Value: {discount.value}</span>}
                        {discount.ticket_details && (
                          <span>Ticket: {discount.ticket_details}</span>
                        )}
                        {discount.close_date && (
                          <span>
                            Closes:{' '}
                            {new Date(discount.close_date).toLocaleDateString()}
                          </span>
                        )}
                        <span>
                          {isDynamic ? 'Issued' : 'Claims'}: {count}
                          {isDynamic && discount.max_codes != null && ` / ${discount.max_codes}`}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 ml-4">
                      <Button
                        variant="secondary"
                        size="small"
                        onClick={(e: React.MouseEvent) => {
                          e.stopPropagation();
                          handleEditClick(discount);
                        }}
                        title="Edit discount"
                      >
                        <PencilIcon className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="danger"
                        size="small"
                        onClick={(e: React.MouseEvent) => {
                          e.stopPropagation();
                          handleDeleteClick(discount.id, discount.title);
                        }}
                        title="Delete discount"
                      >
                        <TrashIcon className="w-4 h-4" />
                      </Button>
                      {isExpanded ? (
                        <ChevronUpIcon className="w-5 h-5 text-gray-400" />
                      ) : (
                        <ChevronDownIcon className="w-5 h-5 text-gray-400" />
                      )}
                    </div>
                  </div>

                  {/* Expanded content */}
                  {isExpanded && (
                    <div className="border-t border-gray-200 dark:border-dark-300 bg-gray-50 dark:bg-surface-1 p-4">
                      {isDynamic ? (
                        <>
                          <h5 className="text-sm font-medium text-gray-700 dark:text-dark-100 mb-3">
                            Issued Codes ({codeCounts[discount.id] ?? 0})
                          </h5>
                          {isLoadingData ? (
                            <div className="flex justify-center py-4">
                              <LoadingSpinner size="small" />
                            </div>
                          ) : !codesMap[discount.id] || codesMap[discount.id].length === 0 ? (
                            <p className="text-sm text-gray-500 dark:text-dark-200 text-center py-4">
                              No codes issued yet
                            </p>
                          ) : (
                            <div className="overflow-x-auto">
                              <table className="min-w-full divide-y divide-gray-200 dark:divide-dark-300">
                                <thead>
                                  <tr>
                                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-dark-200 uppercase tracking-wider">
                                      Code
                                    </th>
                                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-dark-200 uppercase tracking-wider">
                                      Issued To
                                    </th>
                                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-dark-200 uppercase tracking-wider">
                                      Issued At
                                    </th>
                                    <th className="px-3 py-2" />
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-200 dark:divide-dark-300">
                                  {codesMap[discount.id].map((dc) => (
                                    <tr
                                      key={dc.id}
                                      className="hover:bg-gray-100 dark:hover:bg-surface-2"
                                    >
                                      <td className="px-3 py-2 text-sm font-mono text-gray-900 dark:text-white">
                                        {dc.code}
                                      </td>
                                      <td className="px-3 py-2 text-sm text-gray-900 dark:text-white">
                                        {dc.issued_to || '-'}
                                      </td>
                                      <td className="px-3 py-2 text-sm text-gray-500 dark:text-dark-200">
                                        {dc.issued_at
                                          ? new Date(dc.issued_at).toLocaleString()
                                          : '-'}
                                      </td>
                                      <td className="px-3 py-2 text-right">
                                        <Button
                                          variant="danger"
                                          size="small"
                                          onClick={() => setDeleteRowModal({
                                            isOpen: true,
                                            type: 'code',
                                            rowId: dc.id,
                                            discountId: discount.id,
                                            label: dc.code,
                                          })}
                                        >
                                          <TrashIcon className="w-3.5 h-3.5" />
                                        </Button>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </>
                      ) : (
                        <>
                          <h5 className="text-sm font-medium text-gray-700 dark:text-dark-100 mb-3">
                            Claims ({claimCounts[discount.id] ?? 0})
                          </h5>
                          {isLoadingData ? (
                            <div className="flex justify-center py-4">
                              <LoadingSpinner size="small" />
                            </div>
                          ) : !claimsMap[discount.id] || claimsMap[discount.id].length === 0 ? (
                            <p className="text-sm text-gray-500 dark:text-dark-200 text-center py-4">
                              No claims for this discount yet
                            </p>
                          ) : (
                            <div className="overflow-x-auto">
                              <table className="min-w-full divide-y divide-gray-200 dark:divide-dark-300">
                                <thead>
                                  <tr>
                                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-dark-200 uppercase tracking-wider">
                                      Email
                                    </th>
                                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-dark-200 uppercase tracking-wider">
                                      Status
                                    </th>
                                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-dark-200 uppercase tracking-wider">
                                      Created
                                    </th>
                                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 dark:text-dark-200 uppercase tracking-wider">
                                      Updated
                                    </th>
                                    <th className="px-3 py-2" />
                                  </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-200 dark:divide-dark-300">
                                  {claimsMap[discount.id].map((claim) => (
                                    <tr
                                      key={claim.id}
                                      className="hover:bg-gray-100 dark:hover:bg-surface-2"
                                    >
                                      <td className="px-3 py-2 text-sm text-gray-900 dark:text-white">
                                        {claim.email}
                                      </td>
                                      <td className="px-3 py-2 text-sm">
                                        {getClaimStatusBadge(claim.status)}
                                      </td>
                                      <td className="px-3 py-2 text-sm text-gray-500 dark:text-dark-200">
                                        {claim.created_at
                                          ? new Date(claim.created_at).toLocaleDateString()
                                          : '-'}
                                      </td>
                                      <td className="px-3 py-2 text-sm text-gray-500 dark:text-dark-200">
                                        {claim.updated_at
                                          ? new Date(claim.updated_at).toLocaleDateString()
                                          : '-'}
                                      </td>
                                      <td className="px-3 py-2 text-right">
                                        <Button
                                          variant="danger"
                                          size="small"
                                          onClick={() => setDeleteRowModal({
                                            isOpen: true,
                                            type: 'claim',
                                            rowId: claim.id,
                                            discountId: discount.id,
                                            label: claim.email,
                                          })}
                                        >
                                          <TrashIcon className="w-3.5 h-3.5" />
                                        </Button>
                                      </td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      <Modal
        isOpen={modalOpen}
        onClose={() => {
          setModalOpen(false);
          setEditingDiscount(null);
          setFormData(emptyForm);
        }}
        title={editingDiscount ? 'Edit Discount' : 'Add Discount'}
        size="lg"
        footer={
          <div className="flex justify-end gap-3">
            <Button
              variant="outlined"
              onClick={() => {
                setModalOpen(false);
                setEditingDiscount(null);
                setFormData(emptyForm);
              }}
            >
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : editingDiscount ? 'Update' : 'Create'}
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <Input
            label="Title"
            value={formData.title}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setFormData({ ...formData, title: e.target.value })
            }
            placeholder="e.g. Early Bird Discount"
          />
          <Input
            label="Slug"
            value={formData.slug}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setFormData({ ...formData, slug: e.target.value })
            }
            placeholder="e.g. early-bird"
          />
          <Input
            label="Value"
            value={formData.value}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setFormData({ ...formData, value: e.target.value })
            }
            placeholder="20% off"
          />
          <Input
            label="Ticket Details"
            value={formData.ticket_details}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setFormData({ ...formData, ticket_details: e.target.value })
            }
            placeholder="e.g. General Admission"
          />
          <Input
            label="Close Date"
            type="datetime-local"
            value={formData.close_date}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setFormData({ ...formData, close_date: e.target.value })
            }
          />
          <Input
            label="Close Display"
            value={formData.close_display}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setFormData({ ...formData, close_display: e.target.value })
            }
            placeholder="e.g. Closes March 1st"
          />
          <Textarea
            label="Intro"
            value={formData.intro}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
              setFormData({ ...formData, intro: e.target.value })
            }
            placeholder="Introduction text for this discount..."
            rows={3}
          />

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
              Content
            </label>
            <RichTextEditor
              content={formData.content}
              onChange={(content: string) =>
                setFormData({ ...formData, content })
              }
              placeholder="Detailed discount content (rich text)"
            />
          </div>

          <Select
            label="Status"
            value={formData.status}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
              setFormData({
                ...formData,
                status: e.target.value as 'active' | 'closed' | 'cancelled',
              })
            }
            data={[
              { label: 'Active', value: 'active' },
              { label: 'Closed', value: 'closed' },
              { label: 'Cancelled', value: 'cancelled' },
            ]}
          />
          <Checkbox
            label="Beta"
            checked={formData.is_beta}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setFormData({ ...formData, is_beta: e.target.checked })
            }
          />
          <Checkbox
            label="Hidden (only visible via ?discount=true URL param or when signed in)"
            checked={formData.hidden}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setFormData({ ...formData, hidden: e.target.checked })
            }
          />

          {/* Luma Dynamic Code Generation */}
          <div className="pt-4 border-t border-gray-200 dark:border-dark-300">
            <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
              Luma Dynamic Code Generation
            </h4>
            <p className="text-xs text-gray-500 dark:text-dark-200 mb-3">
              When configured, codes are generated and registered in Luma automatically when someone claims this discount — no CSV upload needed.
            </p>
            <div className="space-y-3">
              <Input
                label="Luma Event API ID"
                value={formData.luma_event_api_id}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setFormData({ ...formData, luma_event_api_id: e.target.value })
                }
                placeholder="evt-xxxxxxxxxxxxxxxx"
              />
              <Input
                label="Luma API Key"
                type="password"
                value={formData.luma_api_key}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setFormData({ ...formData, luma_api_key: e.target.value })
                }
                placeholder="secret-xxxxxxxxxxxxxxxx"
              />
              <Input
                label="Discount % (default 100)"
                type="number"
                min="1"
                max="100"
                value={formData.luma_percent_off}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setFormData({ ...formData, luma_percent_off: e.target.value })
                }
                placeholder="100"
              />
              <Input
                label="Max codes (leave blank for unlimited)"
                type="number"
                min="1"
                value={formData.max_codes}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setFormData({ ...formData, max_codes: e.target.value })
                }
                placeholder="e.g. 50"
              />
            </div>
          </div>
        </div>
      </Modal>

      {/* Delete Discount Confirmation */}
      <ConfirmModal
        isOpen={deleteModal.isOpen}
        title="Delete Discount"
        message={`Are you sure you want to delete the discount "${deleteModal.discountTitle}"? This action cannot be undone.`}
        confirmText="Delete"
        onConfirm={handleDeleteConfirm}
        onClose={() =>
          setDeleteModal({ isOpen: false, discountId: null, discountTitle: '' })
        }
      />

      {/* Delete Code/Claim Row Confirmation */}
      <ConfirmModal
        isOpen={deleteRowModal.isOpen}
        title={deleteRowModal.type === 'code' ? 'Delete Issued Code' : 'Delete Claim'}
        message={
          deleteRowModal.type === 'code'
            ? `Delete code "${deleteRowModal.label}"? This only removes the record — the coupon in Luma will not be affected.`
            : `Delete the claim for "${deleteRowModal.label}"? This action cannot be undone.`
        }
        confirmText="Delete"
        onConfirm={handleDeleteRowConfirm}
        onClose={() =>
          setDeleteRowModal({ isOpen: false, type: 'code', rowId: null, discountId: null, label: '' })
        }
      />
    </Card>
  );
};
