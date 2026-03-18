// @ts-nocheck
import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import {
  UsersIcon,
  MagnifyingGlassIcon,
  ArrowDownTrayIcon,
  TrashIcon,
  CheckIcon,
  XMarkIcon,
  ArrowPathIcon,
} from '@heroicons/react/24/outline';
import { Card, Button, ConfirmModal, Badge } from '@/components/ui-legacy';
import LoadingSpinner from '@/components/shared/LoadingSpinner';
import { supabase } from '@/lib/supabase';

interface EventInterest {
  id: string;
  event_id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  job_title: string | null;
  phone: string | null;
  linkedin_url: string | null;
  interest_source: string | null;
  interest_type: string | null;
  status: 'active' | 'converted' | 'withdrawn';
  source: string | null;
  expressed_at: string;
  created_at: string;
  member_profile_id: string | null;
  converted_to_registration_id: string | null;
  converted_at: string | null;
  customer_id: number | null;
  display_first_name: string | null;
  display_last_name: string | null;
}

const ITEMS_PER_PAGE = 50;

interface EventInterestTabProps {
  eventId: string;
}

export const EventInterestTab = ({ eventId }: EventInterestTabProps) => {
  const navigate = useNavigate();
  const [interests, setInterests] = useState<EventInterest[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [deleteModal, setDeleteModal] = useState<{
    isOpen: boolean;
    interestId: string | null;
    interestName: string;
  }>({
    isOpen: false,
    interestId: null,
    interestName: '',
  });
  const [convertingId, setConvertingId] = useState<string | null>(null);

  useEffect(() => {
    loadInterests();
  }, [eventId]);

  const loadInterests = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('event_interest_with_details')
        .select('*')
        .eq('event_id', eventId)
        .order('expressed_at', { ascending: false });

      if (error) throw error;
      setInterests(data || []);
    } catch (error) {
      console.error('Error loading interests:', error);
      toast.error('Failed to load interests');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteClick = (interestId: string, email: string) => {
    setDeleteModal({
      isOpen: true,
      interestId,
      interestName: email,
    });
  };

  const handleDeleteConfirm = async () => {
    if (!deleteModal.interestId) return;

    try {
      const { error } = await supabase
        .from('event_interest')
        .delete()
        .eq('id', deleteModal.interestId);

      if (error) throw error;

      setInterests(interests.filter((i) => i.id !== deleteModal.interestId));
      toast.success('Interest record deleted successfully');
      setDeleteModal({ isOpen: false, interestId: null, interestName: '' });
    } catch (error) {
      console.error('Error deleting interest:', error);
      toast.error('Failed to delete interest record');
    }
  };

  const handleWithdraw = async (interest: EventInterest) => {
    try {
      const { error } = await supabase
        .from('event_interest')
        .update({ status: 'withdrawn' })
        .eq('id', interest.id);

      if (error) throw error;

      setInterests(
        interests.map((i) =>
          i.id === interest.id ? { ...i, status: 'withdrawn' as const } : i
        )
      );
      toast.success('Interest withdrawn successfully');
    } catch (error) {
      console.error('Error withdrawing interest:', error);
      toast.error('Failed to withdraw interest');
    }
  };

  const handleReactivate = async (interest: EventInterest) => {
    try {
      const { error } = await supabase
        .from('event_interest')
        .update({ status: 'active' })
        .eq('id', interest.id);

      if (error) throw error;

      setInterests(
        interests.map((i) =>
          i.id === interest.id ? { ...i, status: 'active' as const } : i
        )
      );
      toast.success('Interest reactivated successfully');
    } catch (error) {
      console.error('Error reactivating interest:', error);
      toast.error('Failed to reactivate interest');
    }
  };

  const handleConvertToRegistration = async (interest: EventInterest) => {
    setConvertingId(interest.id);
    try {
      // Call the event-registration edge function to create a registration
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/event-registration`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            email: interest.email,
            event_id: interest.event_id,
            first_name: interest.first_name,
            last_name: interest.last_name,
            company: interest.company,
            job_title: interest.job_title,
            phone: interest.phone,
            linkedin_url: interest.linkedin_url,
            registration_type: 'free',
            source: interest.source || 'interest_conversion',
          }),
        }
      );

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Failed to create registration');
      }

      // Update the interest record to mark as converted
      const { error: updateError } = await supabase
        .from('event_interest')
        .update({
          status: 'converted',
          converted_to_registration_id: result.registration_id,
          converted_at: new Date().toISOString(),
        })
        .eq('id', interest.id);

      if (updateError) throw updateError;

      setInterests(
        interests.map((i) =>
          i.id === interest.id
            ? {
                ...i,
                status: 'converted' as const,
                converted_to_registration_id: result.registration_id,
                converted_at: new Date().toISOString(),
              }
            : i
        )
      );

      toast.success(
        result.already_registered
          ? 'Already registered for this event'
          : 'Successfully converted to registration'
      );
    } catch (error) {
      console.error('Error converting to registration:', error);
      toast.error(
        error instanceof Error
          ? error.message
          : 'Failed to convert to registration'
      );
    } finally {
      setConvertingId(null);
    }
  };

  const handleDownloadCSV = () => {
    try {
      if (interests.length === 0) {
        toast.error('No interests to export');
        return;
      }

      const headers = [
        'Email',
        'First Name',
        'Last Name',
        'Company',
        'Job Title',
        'Phone',
        'LinkedIn URL',
        'Interest Type',
        'Status',
        'Source',
        'Expressed At',
      ];

      const rows = interests.map((interest) => [
        interest.email || '',
        interest.first_name || '',
        interest.last_name || '',
        interest.company || '',
        interest.job_title || '',
        interest.phone || '',
        interest.linkedin_url || '',
        interest.interest_type || '',
        interest.status || '',
        interest.source || '',
        interest.expressed_at
          ? new Date(interest.expressed_at).toISOString()
          : '',
      ]);

      const csvContent = [
        headers.join(','),
        ...rows.map((row) =>
          row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')
        ),
      ].join('\n');

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${eventId}_event_interests.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);

      toast.success(`Exported ${interests.length} interest records`);
    } catch (error) {
      console.error('Error exporting CSV:', error);
      toast.error('Failed to export CSV');
    }
  };

  const filteredInterests = interests.filter((interest) => {
    const query = searchQuery.toLowerCase();
    return (
      interest.email?.toLowerCase().includes(query) ||
      interest.first_name?.toLowerCase().includes(query) ||
      interest.last_name?.toLowerCase().includes(query) ||
      interest.company?.toLowerCase().includes(query) ||
      interest.interest_type?.toLowerCase().includes(query)
    );
  });

  // Pagination
  const totalPages = Math.ceil(filteredInterests.length / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const paginatedInterests = filteredInterests.slice(startIndex, endIndex);

  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery]);

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return <Badge variant="success">Active</Badge>;
      case 'converted':
        return <Badge variant="primary">Converted</Badge>;
      case 'withdrawn':
        return <Badge variant="secondary">Withdrawn</Badge>;
      default:
        return <Badge variant="secondary">{status}</Badge>;
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
            Event Interest ({interests.length})
          </h3>
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="small"
              onClick={handleDownloadCSV}
              disabled={interests.length === 0}
            >
              <ArrowDownTrayIcon className="w-4 h-4 mr-1" />
              Export CSV
            </Button>
          </div>
        </div>

        {interests.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            <UsersIcon className="w-12 h-12 mx-auto mb-3 text-gray-400" />
            <p>No interest expressions yet</p>
            <p className="text-sm mt-1">
              People who express interest in this event will appear here
            </p>
          </div>
        ) : (
          <>
            {/* Search */}
            <div className="mb-4">
              <div className="relative">
                <MagnifyingGlassIcon className="absolute left-3 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="text"
                  placeholder="Search by name, email, company, or interest type..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-primary-500 focus:border-primary-500 dark:bg-surface-1 dark:border-dark-300 dark:text-white"
                />
              </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-4 mb-4">
              <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-green-600 dark:text-green-400">
                  {interests.filter((i) => i.status === 'active').length}
                </div>
                <div className="text-sm text-green-700 dark:text-green-300">
                  Active
                </div>
              </div>
              <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                  {interests.filter((i) => i.status === 'converted').length}
                </div>
                <div className="text-sm text-blue-700 dark:text-blue-300">
                  Converted
                </div>
              </div>
              <div className="bg-gray-50 dark:bg-gray-900/20 rounded-lg p-3 text-center">
                <div className="text-2xl font-bold text-gray-600 dark:text-gray-400">
                  {interests.filter((i) => i.status === 'withdrawn').length}
                </div>
                <div className="text-sm text-gray-700 dark:text-gray-300">
                  Withdrawn
                </div>
              </div>
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200 dark:divide-dark-300">
                <thead>
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-dark-200 uppercase tracking-wider">
                      Email
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-dark-200 uppercase tracking-wider">
                      Name
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-dark-200 uppercase tracking-wider">
                      Company
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-dark-200 uppercase tracking-wider">
                      Interest Type
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-dark-200 uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 dark:text-dark-200 uppercase tracking-wider">
                      Expressed
                    </th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 dark:text-dark-200 uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200 dark:divide-dark-300">
                  {paginatedInterests.map((interest) => (
                    <tr
                      key={interest.id}
                      className="hover:bg-gray-50 dark:hover:bg-surface-2"
                    >
                      <td className="px-4 py-3 text-sm text-gray-900 dark:text-white">
                        {interest.email}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-900 dark:text-white">
                        {(() => {
                          const name = [interest.display_first_name || interest.first_name, interest.display_last_name || interest.last_name]
                            .filter(Boolean)
                            .join(' ') || '-';
                          return interest.customer_id ? (
                            <button
                              onClick={() => navigate(`/members/${interest.customer_id}`)}
                              className="hover:text-primary-600 dark:hover:text-primary-400 hover:underline text-left cursor-pointer"
                            >
                              {name}
                            </button>
                          ) : (
                            name
                          );
                        })()}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500 dark:text-dark-200">
                        {interest.company || '-'}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500 dark:text-dark-200">
                        {interest.interest_type || 'general'}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {getStatusBadge(interest.status)}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500 dark:text-dark-200">
                        {interest.expressed_at
                          ? new Date(interest.expressed_at).toLocaleDateString()
                          : '-'}
                      </td>
                      <td className="px-4 py-3 text-sm text-right">
                        <div className="flex items-center justify-end gap-1">
                          {interest.status === 'active' && (
                            <>
                              <Button
                                variant="secondary"
                                size="small"
                                onClick={() =>
                                  handleConvertToRegistration(interest)
                                }
                                disabled={convertingId === interest.id}
                                title="Convert to registration"
                              >
                                {convertingId === interest.id ? (
                                  <ArrowPathIcon className="w-4 h-4 animate-spin" />
                                ) : (
                                  <CheckIcon className="w-4 h-4" />
                                )}
                              </Button>
                              <Button
                                variant="secondary"
                                size="small"
                                onClick={() => handleWithdraw(interest)}
                                title="Mark as withdrawn"
                              >
                                <XMarkIcon className="w-4 h-4" />
                              </Button>
                            </>
                          )}
                          {interest.status === 'withdrawn' && (
                            <Button
                              variant="secondary"
                              size="small"
                              onClick={() => handleReactivate(interest)}
                              title="Reactivate interest"
                            >
                              <ArrowPathIcon className="w-4 h-4" />
                            </Button>
                          )}
                          <Button
                            variant="danger"
                            size="small"
                            onClick={() =>
                              handleDeleteClick(interest.id, interest.email)
                            }
                            title="Delete"
                          >
                            <TrashIcon className="w-4 h-4" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="mt-4 flex items-center justify-between">
                <div className="text-sm text-gray-500 dark:text-dark-200">
                  Showing {startIndex + 1} to{' '}
                  {Math.min(endIndex, filteredInterests.length)} of{' '}
                  {filteredInterests.length} interests
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="secondary"
                    size="small"
                    onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                    disabled={currentPage === 1}
                  >
                    Previous
                  </Button>
                  <span className="text-sm text-gray-600 dark:text-dark-200">
                    Page {currentPage} of {totalPages}
                  </span>
                  <Button
                    variant="secondary"
                    size="small"
                    onClick={() =>
                      setCurrentPage((p) => Math.min(totalPages, p + 1))
                    }
                    disabled={currentPage === totalPages}
                  >
                    Next
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      <ConfirmModal
        isOpen={deleteModal.isOpen}
        title="Delete Interest Record"
        message={`Are you sure you want to delete the interest record for "${deleteModal.interestName}"? This action cannot be undone.`}
        confirmText="Delete"
        onConfirm={handleDeleteConfirm}
        onClose={() =>
          setDeleteModal({ isOpen: false, interestId: null, interestName: '' })
        }
      />
    </Card>
  );
};
