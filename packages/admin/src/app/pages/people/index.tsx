import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import {
  UserGroupIcon,
  MagnifyingGlassIcon,
  ArrowPathIcon,
  EnvelopeIcon,
  BriefcaseIcon,
  BuildingOfficeIcon,
  EyeIcon,
  TrashIcon,
  ArrowDownTrayIcon,
  ArrowUpTrayIcon,
  PlusIcon,
  MapPinIcon,
} from '@heroicons/react/24/outline';
import { toast } from 'sonner';
import { getApiConfig, getSupabaseConfig } from '@/config/brands';
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getPaginationRowModel,
  getFilteredRowModel,
  createColumnHelper,
  SortingState,
} from '@tanstack/react-table';
import {
  Card,
  Button,
  Pagination,
  PaginationFirst,
  PaginationLast,
  PaginationNext,
  PaginationPrevious,
  PaginationItems,
  Modal,
  Input,
  ConfirmModal,
  Avatar,
  Badge,
  Tabs,
  Select,
  Textarea,
} from '@/components/ui';
import { Spinner } from '@/components/ui/Spinner';
import { DataTable } from '@/components/shared/table/DataTable';
import { RowActions } from '@/components/shared/table/RowActions';
import { Page } from '@/components/shared/Page';
import { PeopleService } from '@/utils/peopleService';
import { supabase } from '@/lib/supabase';
import md5 from 'md5';
import { useAccountAccess } from '@/hooks/useAccountAccess';
import { SendEmailModal } from '@/components/emails/SendEmailModal';
import { PersonLocationMap } from '@/components/charts/PersonLocationMap';
import { usePeopleAttributes } from '@/hooks/usePeopleAttributes';

const PAGE_SIZE = 50;

interface Person {
  cio_id: string;
  email: string;
  id: string;
  created_at?: string;
  attributes?: {
    first_name?: string;
    last_name?: string;
    job_title?: string;
    company?: string;
    linkedin_url?: string;
    created_at?: string;
  };
  avatar_source?: 'uploaded' | 'linkedin' | 'gravatar' | null;
  avatar_storage_path?: string | null;
}

// Helper function to get avatar URL from Supabase storage only
function getAvatarUrl(person: Person, size: number = 40): string {
  // Only use stored avatar from Supabase storage (uploaded, linkedin, or synced gravatar)
  // Do NOT fallback to Gravatar URL - only show if stored in Supabase
  const storedAvatar = PeopleService.getAvatarUrl(person as any, size);
  return storedAvatar || '';
}

// Helper function to format timestamp for tooltip
function formatTimestamp(dateString: string | number | undefined): string {
  if (!dateString) return 'No timestamp';

  let date: Date;
  if (typeof dateString === 'number') {
    date = new Date(dateString * 1000);
  } else if (/^\d+$/.test(dateString)) {
    date = new Date(parseInt(dateString) * 1000);
  } else {
    date = new Date(dateString);
  }

  return date.toLocaleString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
}

// Helper function to format time ago
function timeAgo(dateString: string | number | undefined): string {
  if (!dateString) return '-';

  let date: Date;
  if (typeof dateString === 'number') {
    date = new Date(dateString * 1000);
  } else if (/^\d+$/.test(dateString)) {
    date = new Date(parseInt(dateString) * 1000);
  } else {
    date = new Date(dateString);
  }

  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  const intervals = {
    year: 31536000,
    month: 2592000,
    week: 604800,
    day: 86400,
    hour: 3600,
    minute: 60,
  };

  for (const [unit, secondsInUnit] of Object.entries(intervals)) {
    const interval = Math.floor(seconds / secondsInUnit);
    if (interval >= 1) {
      return `${interval} ${unit}${interval === 1 ? '' : 's'} ago`;
    }
  }

  return 'just now';
}

const columnHelper = createColumnHelper<Person>();

export default function MembersPage() {
  const navigate = useNavigate();
  const { isAccountUser, isSystemAdmin } = useAccountAccess();
  const { attributes: peopleAttrConfig } = usePeopleAttributes();
  const [people, setPeople] = useState<Person[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [globalFilter, setGlobalFilter] = useState('');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [totalPeople, setTotalPeople] = useState(0);
  const [peopleWithLinkedIn, setPeopleWithLinkedIn] = useState(0);
  const [currentPage, setCurrentPage] = useState(0);
  const [sorting, setSorting] = useState<SortingState>([
    { id: 'created', desc: true }
  ]);
  const [peopleWithGravatar, setPeopleWithGravatar] = useState<Person[]>([]);

  const [searchParams, setSearchParams] = useSearchParams();
  const tabFromUrl = searchParams.get('tab') as 'data' | 'gallery' | 'map' || 'data';
  const [activeTab, setActiveTab] = useState<'data' | 'gallery' | 'map'>(tabFromUrl);

  // Sync URL with tab changes
  const handleTabChange = (tab: 'data' | 'gallery' | 'map') => {
    setActiveTab(tab);
    setSearchParams({ tab });
  };

  // Update active tab when URL changes
  useEffect(() => {
    const urlTab = searchParams.get('tab') as 'data' | 'gallery' | 'map' || 'data';
    if (urlTab !== activeTab) {
      setActiveTab(urlTab);
    }
  }, [searchParams, activeTab]);

  // Map tab state
  const [peopleLocations, setPeopleLocations] = useState<{country: string; city: string; lat: number; lng: number; count: number}[]>([]);
  const [mapLoading, setMapLoading] = useState(false);

  // Modal states
  const [viewModalOpen, setViewModalOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [emailModalOpen, setEmailModalOpen] = useState(false);
  const [addPersonModalOpen, setAddPersonModalOpen] = useState(false);
  const [selectedPerson, setSelectedPerson] = useState<Person | null>(null);
  const [selectedPersonIds, setSelectedPersonIds] = useState<Set<string>>(new Set());
  const [selectAllMode, setSelectAllMode] = useState(false); // Track if "select all" is active
  const [editFormData, setEditFormData] = useState({
    email: '',
    first_name: '',
    last_name: '',
    job_title: '',
    company: '',
    linkedin_url: '',
  });
  const [addPersonFormData, setAddPersonFormData] = useState<Record<string, string>>({
    email: '',
    first_name: '',
    last_name: '',
    job_title: '',
    company: '',
  });
  const [addingMember, setAddingMember] = useState(false);
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });

  const loadPeople = async () => {
    try {
      setLoading(true);

      // Determine sort parameters
      const sortBy = sorting.length > 0 ? sorting[0].id : 'created_at';
      const sortOrder = sorting.length > 0 ? (sorting[0].desc ? 'desc' : 'asc') : 'desc';

      // Fetch only the current page with server-side pagination, sorting, and filtering
      const { people: fetchedPeople, total } = await PeopleService.getAuthenticatedPeoplePaginated(
        currentPage,
        PAGE_SIZE,
        sortBy,
        sortOrder,
        globalFilter || undefined
      );

      // Debug: Check what fields are being returned
      console.log('========================================');
      console.log('🔍 DATABASE QUERY RESULTS:');
      console.log('Total customers fetched:', fetchedPeople.length);
      if (fetchedPeople.length > 0) {
        console.log('Fields returned:', Object.keys(fetchedPeople[0]));
        console.log('Sample customer:', fetchedPeople[0]);
        console.log('Has avatar_storage_path?', 'avatar_storage_path' in fetchedPeople[0]);
        console.log('Has avatar_source?', 'avatar_source' in fetchedPeople[0]);
      }
      console.log('========================================');

      // Fetch LinkedIn count
      const linkedInCount = await PeopleService.getAuthenticatedPeopleWithLinkedInCount();
      setPeopleWithLinkedIn(linkedInCount);

      const mappedPeople = fetchedPeople.map(c => ({
        cio_id: c.cio_id,
        email: c.email || '',
        id: c.id?.toString() || '',
        created_at: c.created_at,
        attributes: c.attributes as Person['attributes'],
        avatar_storage_path: c.avatar_storage_path,
        avatar_source: c.avatar_source,
      }));

      // Debug: Log avatar data
      const peopleWithAvatars = mappedPeople.filter(c => c.avatar_storage_path);
      console.log(`👤 Loaded ${mappedPeople.length} customers, ${peopleWithAvatars.length} with avatars`);
      if (peopleWithAvatars.length > 0) {
        console.log('📷 Sample avatar data:', {
          email: peopleWithAvatars[0].email,
          avatar_storage_path: peopleWithAvatars[0].avatar_storage_path,
          avatar_source: peopleWithAvatars[0].avatar_source
        });
      }

      setPeople(mappedPeople);
      setTotalPeople(total);
      setLastUpdated(new Date());
    } catch (error) {
      console.error('Error loading customers:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadAllPeopleForGallery = async () => {
    try {
      // Fetch customers with stored avatars in Supabase storage
      const fetchedPeople = await PeopleService.getPeopleWithGravatar();

      const mapped = fetchedPeople.map(c => ({
        cio_id: c.cio_id,
        email: c.email || '',
        id: c.id?.toString() || '',
        created_at: c.created_at,
        attributes: c.attributes as Person['attributes'],
        avatar_source: c.avatar_source,
        avatar_storage_path: c.avatar_storage_path,
      }));

      setPeopleWithGravatar(mapped);
    } catch (error) {
      console.error('Error loading customers for gallery:', error);
    }
  };

  // Load people locations for map
  const loadPeopleLocations = async () => {
    try {
      setMapLoading(true);

      // Fetch all people with location data
      // We need to fetch all people and filter those with valid location coordinates
      const allLocations: { country: string; city: string; lat: number; lng: number }[] = [];
      let offset = 0;
      const pageSize = 1000;

      while (true) {
        const { data: peopleData, error } = await supabase
          .from('people')
          .select('attributes')
          .not('auth_user_id', 'is', null)
          .order('id', { ascending: true })
          .range(offset, offset + pageSize - 1);

        if (error) {
          console.error('Error fetching people for map:', error);
          break;
        }

        if (!peopleData || peopleData.length === 0) {
          break;
        }

        // Filter people with valid location data
        for (const person of peopleData) {
          const attrs = person.attributes as Record<string, any> | null;
          if (attrs?.location && attrs?.city && attrs?.country) {
            const locationStr = attrs.location as string;
            const [latStr, lngStr] = locationStr.split(',').map((s: string) => s.trim());
            const lat = parseFloat(latStr);
            const lng = parseFloat(lngStr);

            if (!isNaN(lat) && !isNaN(lng)) {
              allLocations.push({
                country: attrs.country,
                city: attrs.city,
                lat,
                lng
              });
            }
          }
        }

        offset += pageSize;

        if (peopleData.length < pageSize) {
          break;
        }
      }

      // Aggregate by city/country
      const locationMap = new Map<string, { country: string; city: string; lat: number; lng: number; count: number }>();

      for (const loc of allLocations) {
        const key = `${loc.city}|${loc.country}`;
        const existing = locationMap.get(key);
        if (existing) {
          existing.count++;
        } else {
          locationMap.set(key, { ...loc, count: 1 });
        }
      }

      // Convert to array and sort by count descending
      const aggregated = Array.from(locationMap.values()).sort((a, b) => b.count - a.count);
      setPeopleLocations(aggregated);
    } catch (error) {
      console.error('Error loading people locations:', error);
    } finally {
      setMapLoading(false);
    }
  };

  // Function to check and update a single person's Gravatar status
  const checkAndUpdateGravatar = async (person: Person) => {
    if (!person.email || !person.id) return;

    const trimmedEmail = person.email.trim().toLowerCase();
    const hash = md5(trimmedEmail);
    const checkUrl = `https://www.gravatar.com/avatar/${hash}?d=404`;

    try {
      const img = new Image();
      const hasGravatar = await new Promise<boolean>((resolve) => {
        img.onload = () => resolve(true);
        img.onerror = () => resolve(false);
        img.src = checkUrl;
      });

      // Update database with gravatar status
      await PeopleService.updateGravatarStatus(parseInt(person.id), hasGravatar);

      // Reload gallery if status changed to true
      if (hasGravatar) {
        loadAllPeopleForGallery();
      }
    } catch (error) {
      console.error('Error checking gravatar:', error);
    }
  };

  const columns = useMemo(
    () => [
      columnHelper.display({
        id: 'select',
        header: () => (
          <input
            type="checkbox"
            checked={selectAllMode || (selectedPersonIds.size > 0 && selectedPersonIds.size === totalPeople)}
            ref={(el) => {
              if (el) {
                el.indeterminate = selectedPersonIds.size > 0 && selectedPersonIds.size < totalPeople && !selectAllMode;
              }
            }}
            onChange={handleToggleAll}
            className="rounded border-[var(--gray-a6)] text-[var(--accent-9)] focus:ring-[var(--accent-9)]"
            title={selectAllMode ? `All ${totalPeople} people selected` : `${selectedPersonIds.size} selected`}
          />
        ),
        cell: (info) => {
          const person = info.row.original;
          return (
            <input
              type="checkbox"
              checked={selectedPersonIds.has(person.id)}
              onChange={() => handleToggleSelection(person.id)}
              className="rounded border-[var(--gray-a6)] text-[var(--accent-9)] focus:ring-[var(--accent-9)]"
            />
          );
        },
      }),
      columnHelper.accessor(
        (row) => row.attributes?.created_at || row.created_at,
        {
          id: 'created',
          header: 'Created',
          cell: (info) => (
            <div
              className="text-sm text-[var(--gray-11)] cursor-help whitespace-nowrap"
              title={formatTimestamp(info.getValue())}
            >
              {timeAgo(info.getValue())}
            </div>
          ),
          sortingFn: (rowA, rowB) => {
            const aValue = rowA.original.attributes?.created_at
              ? parseInt(rowA.original.attributes.created_at)
              : rowA.original.created_at ? new Date(rowA.original.created_at).getTime() / 1000 : 0;
            const bValue = rowB.original.attributes?.created_at
              ? parseInt(rowB.original.attributes.created_at)
              : rowB.original.created_at ? new Date(rowB.original.created_at).getTime() / 1000 : 0;
            return aValue - bValue;
          },
        }
      ),
      columnHelper.accessor('email', {
        header: 'Email',
        cell: (info) => {
          const email = info.getValue() || '-';
          const person = info.row.original;
          const avatarUrl = email !== '-' ? getAvatarUrl(person, 32) : '';
          const name = person.attributes?.first_name && person.attributes?.last_name
            ? `${person.attributes.first_name} ${person.attributes.last_name}`
            : email;

          return (
            <div className="text-sm text-[var(--gray-12)] flex items-center gap-2 max-w-xs" title={email}>
              <Avatar
                src={avatarUrl || undefined}
                name={name}
                size={8}
                initialColor="auto"
                className="flex-shrink-0"
              />
              <span className="truncate">{email}</span>
            </div>
          );
        },
      }),
      columnHelper.accessor((row) => row.attributes?.first_name, {
        id: 'firstName',
        header: 'First Name',
        cell: (info) => {
          const value = info.getValue() || '-';
          return (
            <div className="text-sm text-[var(--gray-12)] max-w-[150px]" title={value}>
              <span className="truncate block">{value}</span>
            </div>
          );
        },
      }),
      columnHelper.accessor((row) => row.attributes?.last_name, {
        id: 'lastName',
        header: 'Last Name',
        cell: (info) => {
          const value = info.getValue() || '-';
          return (
            <div className="text-sm text-[var(--gray-12)] max-w-[150px]" title={value}>
              <span className="truncate block">{value}</span>
            </div>
          );
        },
      }),
      // Dynamic attribute columns based on people attributes config
      // (excludes first_name and last_name which have dedicated columns above)
      ...peopleAttrConfig
        .filter(a => a.enabled && a.key !== 'first_name' && a.key !== 'last_name')
        .map(attr => {
          if (attr.key === 'linkedin_url') {
            return columnHelper.accessor((row) => row.attributes?.linkedin_url, {
              id: 'linkedin',
              header: attr.label,
              enableSorting: false,
              cell: (info) => (
                <div className="text-sm">
                  {info.getValue() ? (
                    <a
                      href={info.getValue()}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[var(--accent-11)] hover:text-[var(--accent-12)]"
                      title="View LinkedIn Profile"
                    >
                      <EyeIcon className="size-5" />
                    </a>
                  ) : (
                    <span className="text-[var(--gray-11)]">-</span>
                  )}
                </div>
              ),
            });
          }

          const icon = attr.key === 'job_title' ? <BriefcaseIcon className="size-4 text-[var(--gray-a8)] flex-shrink-0" />
            : attr.key === 'company' ? <BuildingOfficeIcon className="size-4 text-[var(--gray-a8)] flex-shrink-0" />
            : null;
          const attrType = attr.type || 'string';

          return columnHelper.accessor((row) => (row.attributes as Record<string, any>)?.[attr.key], {
            id: attr.key,
            header: attr.label,
            cell: (info) => {
              const rawValue = info.getValue();
              if (!rawValue) return <span className="text-sm text-[var(--gray-11)]">-</span>;

              // Multi-select: display as pills
              if (attrType === 'multi-select') {
                let items: string[] = [];
                try { items = typeof rawValue === 'string' ? JSON.parse(rawValue) : Array.isArray(rawValue) ? rawValue : []; } catch { items = []; }
                if (items.length === 0) return <span className="text-sm text-[var(--gray-11)]">-</span>;
                return (
                  <div className="flex flex-wrap gap-1 max-w-[250px]">
                    {items.map((item, idx) => (
                      <span key={idx} className="inline-block rounded-md bg-[var(--accent-3)] text-[var(--accent-11)] px-1.5 py-0.5 text-xs font-medium">{item}</span>
                    ))}
                  </div>
                );
              }

              const displayValue = String(rawValue);
              return (
                <div className="text-sm text-[var(--gray-12)] flex items-center gap-2 max-w-[200px]" title={displayValue}>
                  {icon}
                  <span className="truncate">{displayValue}</span>
                </div>
              );
            },
          });
        }),
      columnHelper.display({
        id: 'actions',
        header: '',
        cell: (info) => {
          const person = info.row.original;
          return (
            <RowActions
              actions={[
                { label: 'View', icon: <EyeIcon className="size-4" />, onClick: () => navigate(`/people/${person.id}`) },
                { label: 'Send Email', icon: <EnvelopeIcon className="size-4" />, onClick: () => handleEmail(person) },
                { label: 'Delete', icon: <TrashIcon className="size-4" />, onClick: () => handleDelete(person), color: 'red' },
              ]}
            />
          );
        },
      }),
    ],
    [selectedPersonIds, people, selectAllMode, totalPeople, peopleAttrConfig]
  );

  const table = useReactTable({
    data: people,
    columns,
    state: {
      sorting,
      globalFilter,
      pagination: {
        pageIndex: currentPage,
        pageSize: PAGE_SIZE,
      },
    },
    pageCount: Math.ceil(totalPeople / PAGE_SIZE),
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
    onPaginationChange: (updater) => {
      if (typeof updater === 'function') {
        const newState = updater({ pageIndex: currentPage, pageSize: PAGE_SIZE });
        setCurrentPage(newState.pageIndex);
      }
    },
    onSortingChange: (updater) => {
      setSorting(updater);
      setCurrentPage(0); // Reset to first page when sorting changes
    },
    onGlobalFilterChange: (updater) => {
      setGlobalFilter(updater);
      setCurrentPage(0); // Reset to first page when searching
    },
    getCoreRowModel: getCoreRowModel(),
  });

  useEffect(() => {
    loadPeople();
  }, [currentPage, sorting, globalFilter]);

  useEffect(() => {
    // Load all customers for avatar gallery on initial mount
    loadAllPeopleForGallery();
  }, []);

  // Load people locations when map tab is active
  useEffect(() => {
    if (activeTab === 'map' && peopleLocations.length === 0) {
      loadPeopleLocations();
    }
  }, [activeTab]);

  const handleRefresh = () => {
    loadPeople();
  };

  // View person
  const handleView = (person: Person) => {
    setSelectedPerson(person);
    setViewModalOpen(true);
  };

  // Edit person
  const handleEdit = (person: Person) => {
    setSelectedPerson(person);
    setEditFormData({
      email: person.email || '',
      first_name: person.attributes?.first_name || '',
      last_name: person.attributes?.last_name || '',
      job_title: person.attributes?.job_title || '',
      company: person.attributes?.company || '',
      linkedin_url: person.attributes?.linkedin_url || '',
    });
    setEditModalOpen(true);
  };

  // Email person
  const handleEmail = (person: Person) => {
    setSelectedPerson(person);
    setEmailModalOpen(true);
  };

  const handleSaveEdit = async () => {
    if (!selectedPerson?.id) return;

    try {
      const result = await PeopleService.updatePerson(
        parseInt(selectedPerson.id),
        {
          email: editFormData.email,
          attributes: {
            first_name: editFormData.first_name,
            last_name: editFormData.last_name,
            job_title: editFormData.job_title,
            company: editFormData.company,
            linkedin_url: editFormData.linkedin_url,
          },
        }
      );

      if (result.success) {
        toast.success('Person updated successfully');
        setEditModalOpen(false);
        loadPeople();
      } else {
        toast.error(`Failed to update person: ${result.error}`);
      }
    } catch (error) {
      toast.error('Error updating person');
      console.error('Error updating person:', error);
    }
  };

  // Delete person
  const handleDelete = (person: Person) => {
    setConfirmModal({
      isOpen: true,
      title: 'Delete Person',
      message: `Are you sure you want to delete "${person.email}"? This will also remove their Supabase Auth account. This action cannot be undone.`,
      onConfirm: async () => {
        if (!person.id) return;

        try {
          const result = await PeopleService.deletePerson(person.id);

          if (result.success) {
            toast.success('Person deleted successfully');
            loadPeople();
          } else {
            toast.error(`Failed to delete person: ${result.error}`);
          }
        } catch (error) {
          toast.error('Error deleting person');
          console.error('Error deleting person:', error);
        }
      },
    });
  };

  // Export selected customers to CSV
  const handleExportCSV = async () => {
    if (selectedPersonIds.size === 0) {
      toast.error('No people selected');
      return;
    }

    try {
      toast.loading('Exporting people...', { id: 'export-csv' });

      // Fetch full customer data for selected IDs
      const selectedIdsArray = Array.from(selectedPersonIds).map(id => parseInt(id));

      // Fetch in batches of 1000 to handle large selections
      const allPersonData = [];
      for (let i = 0; i < selectedIdsArray.length; i += 1000) {
        const batch = selectedIdsArray.slice(i, i + 1000);
        const { data, error } = await supabase
          .from('people')
          .select('email, attributes')
          .in('id', batch);

        if (error) throw error;
        if (data) allPersonData.push(...data);
      }

      // Define CSV columns
      const columns = [
        'email',
        'first_name',
        'last_name',
        'job_title',
        'company',
        'linkedin_url',
        'city',
        'country',
        'continent'
      ];

      // Create CSV header
      const csvHeader = columns.join(',');

      // Create CSV rows
      const csvRows = allPersonData.map(person => {
        const attrs = person.attributes || {};
        const row = [
          person.email || '',
          attrs.first_name || '',
          attrs.last_name || '',
          attrs.job_title || '',
          attrs.company || '',
          attrs.linkedin_url || '',
          attrs.city || '',
          attrs.country || '',
          attrs.continent || ''
        ];

        // Escape fields that contain commas or quotes
        return row.map(field => {
          const fieldStr = String(field);
          if (fieldStr.includes(',') || fieldStr.includes('"') || fieldStr.includes('\n')) {
            return `"${fieldStr.replace(/"/g, '""')}"`;
          }
          return fieldStr;
        }).join(',');
      });

      // Combine header and rows
      const csvContent = [csvHeader, ...csvRows].join('\n');

      // Create blob and download
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);

      link.setAttribute('href', url);
      link.setAttribute('download', `people-export-${new Date().toISOString().split('T')[0]}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      toast.success(`Exported ${allPersonData.length} person(s) to CSV`, { id: 'export-csv' });
    } catch (error) {
      console.error('Error exporting CSV:', error);
      toast.error('Failed to export CSV', { id: 'export-csv' });
    }
  };

  // Bulk delete customers
  const handleBulkDelete = () => {
    if (selectedPersonIds.size === 0) return;

    setConfirmModal({
      isOpen: true,
      title: 'Delete Multiple People',
      message: `Are you sure you want to delete ${selectedPersonIds.size} person(s)? This will also remove their Supabase Auth accounts. This action cannot be undone.`,
      onConfirm: async () => {
        const promises = Array.from(selectedPersonIds).map(id =>
          PeopleService.deletePerson(id)
        );

        try {
          const results = await Promise.all(promises);
          const successful = results.filter(r => r.success).length;
          const failed = results.length - successful;

          if (successful > 0) {
            toast.success(`Successfully deleted ${successful} person(s)`);
          }
          if (failed > 0) {
            toast.error(`Failed to delete ${failed} person(s)`);
          }

          setSelectedPersonIds(new Set());
          loadPeople();
        } catch (error) {
          toast.error('Error deleting persons');
          console.error('Error deleting persons:', error);
        }
      },
    });
  };

  // Toggle single selection
  const handleToggleSelection = (personId: string) => {
    const newSelected = new Set(selectedPersonIds);
    if (newSelected.has(personId)) {
      newSelected.delete(personId);
      // If in select-all mode and deselecting, exit select-all mode
      if (selectAllMode) {
        setSelectAllMode(false);
      }
    } else {
      newSelected.add(personId);
    }
    setSelectedPersonIds(newSelected);
  };

  // Handle CSV import
  const handleCsvImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validate file type
    if (!file.name.endsWith('.csv')) {
      toast.error('Please select a CSV file');
      return;
    }

    // Validate file size (50MB limit)
    const maxSize = 50 * 1024 * 1024;
    if (file.size > maxSize) {
      toast.error('File size exceeds 50MB limit');
      return;
    }

    setIsImporting(true);
    const toastId = toast.loading('Importing customers from CSV...');

    try {
      const formData = new FormData();
      formData.append('file', file);

      const token = (await supabase.auth.getSession()).data.session?.access_token;
      if (!token) {
        throw new Error('Not authenticated');
      }

      // Use brand-aware API configuration
      const apiConfig = getApiConfig();
      const apiUrl = apiConfig.baseUrl;
      const response = await fetch(`${apiUrl}/csv/import/people`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
        body: formData,
      });

      if (!response.ok) {
        const text = await response.text();
        let errorMsg = 'Import failed';
        try {
          const err = JSON.parse(text);
          errorMsg = err.error || errorMsg;
        } catch {
          if (text) errorMsg = text;
        }
        throw new Error(errorMsg);
      }

      const result = await response.json();

      toast.success(result.message || `Successfully imported ${result.stats?.success || 0} customers`, {
        id: toastId,
      });

      // Reload customers list
      loadPeople();
    } catch (error) {
      console.error('CSV import error:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to import CSV', {
        id: toastId,
      });
    } finally {
      setIsImporting(false);
      // Reset file input
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // Add new member using people-signup edge function
  const handleAddMember = async () => {
    const { email } = addPersonFormData;

    if (!email) {
      toast.error('Email is required');
      return;
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      toast.error('Please enter a valid email address');
      return;
    }

    // Validate required fields from people attributes config
    const missingRequired = peopleAttrConfig
      .filter(a => a.enabled && a.required && !addPersonFormData[a.key]?.trim())
      .map(a => a.label);
    if (missingRequired.length > 0) {
      toast.error(`Required: ${missingRequired.join(', ')}`);
      return;
    }

    setAddingMember(true);

    try {
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      if (!token) {
        throw new Error('Not authenticated');
      }

      // Use brand-aware Supabase configuration
      const supabaseConfig = getSupabaseConfig();
      const supabaseUrl = supabaseConfig.url || '';

      const response = await fetch(`${supabaseUrl}/functions/v1/people-signup`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          email,
          source: 'admin_member_invite',
          app: 'admin',
          user_metadata: {
            ...Object.fromEntries(
              peopleAttrConfig
                .filter(a => a.enabled && addPersonFormData[a.key]?.trim())
                .map(a => [a.key, addPersonFormData[a.key].trim()])
            ),
            full_name: `${addPersonFormData.first_name || ''} ${addPersonFormData.last_name || ''}`.trim() || undefined,
          },
        }),
      });

      const result = await response.json();

      if (!response.ok || !result.success) {
        throw new Error(result.error || 'Failed to add person');
      }

      toast.success(`Person added successfully! ${result.message || ''}`);

      // Reset form and close modal
      setAddPersonFormData({
        email: '',
        first_name: '',
        last_name: '',
        job_title: '',
        company: '',
      });
      setAddPersonModalOpen(false);

      // Reload members list
      loadPeople();
    } catch (error) {
      console.error('Add member error:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to add person');
    } finally {
      setAddingMember(false);
    }
  };

  // Toggle all selection (across all pages)
  const handleToggleAll = async () => {
    if (selectAllMode || selectedPersonIds.size > 0) {
      // Deselect all
      setSelectedPersonIds(new Set());
      setSelectAllMode(false);
    } else {
      // Select all customers across all pages
      try {
        // Fetch all customer IDs from database (paginated to handle large datasets)
        const allIds: string[] = [];
        let page = 0;
        const PAGE_SIZE = 1000;
        let hasMore = true;

        while (hasMore) {
          const { data, error } = await supabase
            .from('people')
            .select('id')
            .not('auth_user_id', 'is', null)
            .order('id')
            .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

          if (error) {
            toast.error('Failed to select all people');
            console.error('Error fetching all customer IDs:', error);
            return;
          }

          if (data && data.length > 0) {
            allIds.push(...data.map(c => c.id.toString()));
          }

          // Check if there are more customers
          if (!data || data.length < PAGE_SIZE) {
            hasMore = false;
          } else {
            page++;
          }
        }

        const allIdsSet = new Set(allIds);
        setSelectedPersonIds(allIdsSet);
        setSelectAllMode(true);
        toast.success(`Selected all ${allIdsSet.size.toLocaleString()} people`);
      } catch (error) {
        toast.error('Failed to select all people');
        console.error('Error selecting all:', error);
      }
    }
  };

  return (
    <Page title="People">
      <div className="p-6 space-y-6">
        {/* Header */}
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-semibold text-[var(--gray-12)]">
              People Dashboard
            </h1>
            <p className="text-[var(--gray-11)] mt-1">
              Viewing people with Supabase Auth accounts
              {isAccountUser && !isSystemAdmin && (
                <span className="ml-2 text-sm text-[var(--amber-11)] font-medium">
                  (Showing all platform people - filtering by account competitions coming soon)
                </span>
              )}
            </p>
          </div>
          <div className="flex gap-3 items-center">
            {/* Add Person button */}
            <Button
              onClick={() => setAddPersonModalOpen(true)}
              color="cyan"
              className="gap-2"
            >
              <PlusIcon className="size-4" />
              Add Person
            </Button>

            {/* CSV Import button for super admins */}
            {isSystemAdmin && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".csv"
                  onChange={handleCsvImport}
                  className="hidden"
                  disabled={isImporting}
                />
                <Button
                  onClick={() => fileInputRef.current?.click()}
                  variant="outline"
                  disabled={isImporting}
                  className="gap-2 text-[var(--green-11)] border-[var(--green-a6)] hover:bg-[var(--green-a3)]"
                >
                  <ArrowUpTrayIcon className="size-4" />
                  {isImporting ? 'Importing...' : 'Import CSV'}
                </Button>
              </>
            )}

            {selectedPersonIds.size > 0 && (
              <>
                <Button
                  onClick={handleExportCSV}
                  variant="outline"
                  className="gap-2 text-[var(--accent-11)] border-[var(--accent-a6)] hover:bg-[var(--accent-a3)]"
                >
                  <ArrowDownTrayIcon className="size-4" />
                  Export CSV ({selectedPersonIds.size.toLocaleString()})
                </Button>
                <Button
                  onClick={handleBulkDelete}
                  variant="outline"
                  className="gap-2 text-[var(--red-11)] border-[var(--red-a6)] hover:bg-[var(--red-a3)]"
                >
                  <TrashIcon className="size-4" />
                  Delete Selected ({selectedPersonIds.size})
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Tabs */}
        <Tabs
          value={activeTab}
          onChange={(tab) => handleTabChange(tab as 'data' | 'gallery' | 'map')}
          tabs={[
            { id: 'data', label: 'Data' },
            { id: 'gallery', label: 'Gallery', count: peopleWithGravatar.length },
            { id: 'map', label: 'Map', icon: <MapPinIcon className="size-4" />, count: peopleLocations.length > 0 ? peopleLocations.reduce((sum, l) => sum + l.count, 0) : undefined },
          ]}
          className="mb-6"
        />

        {/* Tab Content */}
        {activeTab === 'map' ? (
          /* People Location Map */
          <Card variant="surface" className="p-6">
            <PersonLocationMap locations={peopleLocations} loading={mapLoading} />
          </Card>
        ) : activeTab === 'gallery' ? (
          /* Avatar Gallery */
          peopleWithGravatar.length > 0 ? (
            <Card variant="surface" className="overflow-hidden">
              <div className="grid grid-cols-12 sm:grid-cols-16 md:grid-cols-20 lg:grid-cols-24 xl:grid-cols-32">
                {peopleWithGravatar.map((person) => (
                  <div
                    key={person.id}
                    className="aspect-square relative group cursor-pointer"
                    onClick={() => navigate(`/people/${person.id}`)}
                    title={`${person.email}${person.avatar_source ? ` (${person.avatar_source})` : ''}`}
                  >
                    <img
                      src={getAvatarUrl(person, 128)}
                      alt={person.email}
                      className="w-full h-full object-cover transition-opacity group-hover:opacity-75"
                    />
                  </div>
                ))}
              </div>
            </Card>
          ) : (
            <Card variant="surface" className="p-12">
              <div className="text-center">
                <UserGroupIcon className="mx-auto h-12 w-12 text-[var(--gray-a8)]" />
                <h3 className="mt-2 text-sm font-medium text-[var(--gray-12)]">
                  No avatar images found
                </h3>
                <p className="mt-1 text-sm text-[var(--gray-11)]">
                  People with stored avatars will appear here.
                </p>
              </div>
            </Card>
          )
        ) : (
          <>
            {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Card variant="surface" className="p-6">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-[var(--accent-a3)] rounded-lg">
                <UserGroupIcon className="size-6 text-[var(--accent-11)]" />
              </div>
              <div>
                <div className="text-sm font-medium text-[var(--gray-11)]">Total People</div>
                <div className="text-2xl font-bold mt-1">{(totalPeople ?? 0).toLocaleString()}</div>
              </div>
            </div>
          </Card>
          <Card variant="surface" className="p-6">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-[var(--green-a3)] rounded-lg">
                <BriefcaseIcon className="size-6 text-[var(--green-11)]" />
              </div>
              <div>
                <div className="text-sm font-medium text-[var(--gray-11)]">With LinkedIn</div>
                <div className="text-2xl font-bold mt-1">{peopleWithLinkedIn.toLocaleString()}</div>
              </div>
            </div>
          </Card>
        </div>

        {/* Search */}
        <Card variant="surface" className="p-4">
          <div className="space-y-2">
            <div className="relative">
              <MagnifyingGlassIcon className="absolute left-3 top-1/2 -translate-y-1/2 size-5 text-[var(--gray-a8)]" />
              <input
                type="text"
                placeholder="Search people... (e.g., company:microsoft or john)"
                value={globalFilter ?? ''}
                onChange={(e) => setGlobalFilter(e.target.value)}
                className="w-full pl-10 pr-4 py-2 bg-[var(--color-background)] border border-[var(--gray-a6)] rounded-lg focus:outline-none focus:ring-2 focus:ring-[var(--accent-9)] text-[var(--gray-12)]"
              />
            </div>
            <div className="text-xs text-[var(--gray-11)] flex items-center gap-2">
              <span className="font-medium">💡 Tip:</span>
              <span>
                Use <code className="px-1 py-0.5 bg-[var(--gray-a3)] rounded">field:value</code> for specific fields
                (e.g., <code className="px-1 py-0.5 bg-[var(--gray-a3)] rounded">company:microsoft</code>,
                <code className="px-1 py-0.5 bg-[var(--gray-a3)] rounded ml-1">first_name:john</code>)
              </span>
            </div>
          </div>
        </Card>

        {/* Members Table */}
        <Card className="overflow-hidden">
          {/* Select All Banner */}
          {selectAllMode && (
            <div className="bg-[var(--accent-a3)] border-b border-[var(--accent-a6)] px-6 py-3">
              <div className="flex items-center justify-between">
                <p className="text-sm text-[var(--accent-11)]">
                  <strong>All {(totalPeople ?? 0).toLocaleString()} people</strong> across all pages are selected.
                </p>
                <Button
                  variant="ghost"
                  size="1"
                  onClick={() => {
                    setSelectedPersonIds(new Set());
                    setSelectAllMode(false);
                  }}
                >
                  Clear selection
                </Button>
              </div>
            </div>
          )}
          <DataTable table={table} loading={loading} onRowDoubleClick={(person) => navigate(`/people/${person.id}`)} />

          {/* Pagination */}
          {!loading && table.getRowModel().rows.length > 0 && (
            <div className="px-6 py-4 border-t border-[var(--gray-a5)]">
              <div className="flex items-center justify-between">
                <div className="text-sm text-[var(--gray-11)]">
                  Showing{' '}
                  <span className="font-medium">
                    {currentPage * PAGE_SIZE + 1}
                  </span>{' '}
                  to{' '}
                  <span className="font-medium">
                    {Math.min((currentPage + 1) * PAGE_SIZE, totalPeople)}
                  </span>{' '}
                  of{' '}
                  <span className="font-medium">
                    {(totalPeople ?? 0).toLocaleString()}
                  </span>{' '}
                  results
                </div>
                <Pagination
                  total={table.getPageCount()}
                  value={table.getState().pagination.pageIndex + 1}
                  onChange={(page) => table.setPageIndex(page - 1)}
                >
                  <PaginationFirst
                    onClick={() => table.setPageIndex(0)}
                    disabled={!table.getCanPreviousPage()}
                  />
                  <PaginationPrevious
                    onClick={() => table.previousPage()}
                    disabled={!table.getCanPreviousPage()}
                  />
                  <PaginationItems />
                  <PaginationNext
                    onClick={() => table.nextPage()}
                    disabled={!table.getCanNextPage()}
                  />
                  <PaginationLast
                    onClick={() => table.setPageIndex(table.getPageCount() - 1)}
                    disabled={!table.getCanNextPage()}
                  />
                </Pagination>
              </div>
            </div>
          )}
        </Card>
          </>
        )}

        {/* View Customer Modal */}
        <Modal
          isOpen={viewModalOpen}
          onClose={() => setViewModalOpen(false)}
          title="Person Details"
          footer={
            <div className="flex justify-end">
              <Button variant="outline" onClick={() => setViewModalOpen(false)}>
                Close
              </Button>
            </div>
          }
        >
          {selectedPerson && (
            <div className="space-y-4">
              {/* Avatar */}
              <div className="flex justify-center">
                <Avatar
                  src={getAvatarUrl(selectedPerson, 80) || undefined}
                  name={selectedPerson.attributes?.first_name && selectedPerson.attributes?.last_name
                    ? `${selectedPerson.attributes.first_name} ${selectedPerson.attributes.last_name}`
                    : selectedPerson.email}
                  size={20}
                  initialColor="auto"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--gray-11)]">Email</label>
                <p className="mt-1 text-sm text-[var(--gray-12)]">{selectedPerson.email || '-'}</p>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-[var(--gray-11)]">First Name</label>
                  <p className="mt-1 text-sm text-[var(--gray-12)]">{selectedPerson.attributes?.first_name || '-'}</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-[var(--gray-11)]">Last Name</label>
                  <p className="mt-1 text-sm text-[var(--gray-12)]">{selectedPerson.attributes?.last_name || '-'}</p>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--gray-11)]">Job Title</label>
                <p className="mt-1 text-sm text-[var(--gray-12)]">{selectedPerson.attributes?.job_title || '-'}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--gray-11)]">Company</label>
                <p className="mt-1 text-sm text-[var(--gray-12)]">{selectedPerson.attributes?.company || '-'}</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--gray-11)]">LinkedIn</label>
                {selectedPerson.attributes?.linkedin_url ? (
                  <a
                    href={selectedPerson.attributes.linkedin_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 text-sm text-[var(--accent-11)] hover:text-[var(--accent-12)] block"
                  >
                    View Profile
                  </a>
                ) : (
                  <p className="mt-1 text-sm text-[var(--gray-12)]">-</p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-4 pt-2 border-t border-[var(--gray-a6)]">
                <div>
                  <label className="block text-xs font-medium text-[var(--gray-11)]">Customer.io ID</label>
                  <p className="mt-1 text-xs text-[var(--gray-11)] font-mono">{selectedPerson.cio_id}</p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--gray-11)]">Database ID</label>
                  <p className="mt-1 text-xs text-[var(--gray-11)] font-mono">{selectedPerson.id}</p>
                </div>
              </div>
            </div>
          )}
        </Modal>

        {/* Edit Customer Modal */}
        <Modal
          isOpen={editModalOpen}
          onClose={() => setEditModalOpen(false)}
          title="Edit Person"
          footer={
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setEditModalOpen(false)}>
                Cancel
              </Button>
              <Button onClick={handleSaveEdit}>
                Save Changes
              </Button>
            </div>
          }
        >
          <div className="space-y-4">
            <Input
              label="Email"
              value={editFormData.email}
              onChange={(e) => setEditFormData({ ...editFormData, email: e.target.value })}
              placeholder="customer@example.com"
            />
            <div className="grid grid-cols-2 gap-4">
              <Input
                label="First Name"
                value={editFormData.first_name}
                onChange={(e) => setEditFormData({ ...editFormData, first_name: e.target.value })}
                placeholder="John"
              />
              <Input
                label="Last Name"
                value={editFormData.last_name}
                onChange={(e) => setEditFormData({ ...editFormData, last_name: e.target.value })}
                placeholder="Doe"
              />
            </div>
            <Input
              label="Job Title"
              value={editFormData.job_title}
              onChange={(e) => setEditFormData({ ...editFormData, job_title: e.target.value })}
              placeholder="Software Engineer"
            />
            <Input
              label="Company"
              value={editFormData.company}
              onChange={(e) => setEditFormData({ ...editFormData, company: e.target.value })}
              placeholder="Acme Corp"
            />
            <Input
              label="LinkedIn URL"
              value={editFormData.linkedin_url}
              onChange={(e) => setEditFormData({ ...editFormData, linkedin_url: e.target.value })}
              placeholder="https://linkedin.com/in/..."
            />
          </div>
        </Modal>

        {/* Delete Confirmation Modal */}
        <ConfirmModal
          isOpen={confirmModal.isOpen}
          onClose={() => setConfirmModal({ ...confirmModal, isOpen: false })}
          onConfirm={() => {
            confirmModal.onConfirm();
            setConfirmModal({ ...confirmModal, isOpen: false });
          }}
          title={confirmModal.title}
          message={confirmModal.message}
          confirmText="Delete"
          confirmColor="red"
        />

        {/* Send Email Modal */}
        {selectedPerson && (
          <SendEmailModal
            isOpen={emailModalOpen}
            onClose={() => setEmailModalOpen(false)}
            recipientEmail={selectedPerson.email}
            recipientName={
              selectedPerson.attributes?.first_name || selectedPerson.attributes?.last_name
                ? `${selectedPerson.attributes?.first_name || ''} ${selectedPerson.attributes?.last_name || ''}`.trim()
                : undefined
            }
            customerId={selectedPerson.id ? parseInt(selectedPerson.id) : undefined}
          />
        )}

        {/* Add Person Modal */}
        <Modal
          isOpen={addPersonModalOpen}
          onClose={() => {
            setAddPersonModalOpen(false);
            setAddPersonFormData({ email: '', first_name: '', last_name: '', job_title: '', company: '' });
          }}
          title="Add New Person"
          footer={
            <div className="flex justify-end gap-2">
              <Button
                variant="outline"
                onClick={() => {
                  setAddPersonModalOpen(false);
                  setAddPersonFormData({ email: '', first_name: '', last_name: '', job_title: '', company: '' });
                }}
                disabled={addingMember}
              >
                Cancel
              </Button>
              <Button
                onClick={handleAddMember}
                disabled={addingMember}
              >
                {addingMember ? (
                  <span className="flex items-center gap-2">
                    <Spinner className="size-4" />
                    Adding...
                  </span>
                ) : 'Add Person'}
              </Button>
            </div>
          }
        >
          <div className="space-y-4">
            <Input
              label="Email"
              type="email"
              value={addPersonFormData.email}
              onChange={(e) => setAddPersonFormData({ ...addPersonFormData, email: e.target.value })}
              placeholder="member@example.com"
              required
              disabled={addingMember}
            />

            {(() => {
              const enabledAttrs = peopleAttrConfig.filter(a => a.enabled);
              // Group into pairs for 2-column layout (text/multi-select get full width)
              const items: { attr: typeof enabledAttrs[0]; fullWidth: boolean }[] = enabledAttrs.map(a => ({
                attr: a,
                fullWidth: a.type === 'text' || a.type === 'multi-select',
              }));
              const rows: typeof items[] = [];
              let i = 0;
              while (i < items.length) {
                if (items[i].fullWidth) {
                  rows.push([items[i]]);
                  i++;
                } else if (i + 1 < items.length && !items[i + 1].fullWidth) {
                  rows.push([items[i], items[i + 1]]);
                  i += 2;
                } else {
                  rows.push([items[i]]);
                  i++;
                }
              }
              return rows.map((row, ri) => (
                <div key={ri} className={`grid gap-4 ${row.length === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
                  {row.map(({ attr }) => {
                    const fieldLabel = `${attr.label}${attr.required ? '' : ' (Optional)'}`;
                    const attrType = attr.type || 'string';

                    if (attrType === 'text') {
                      return (
                        <Textarea
                          key={attr.key}
                          label={fieldLabel}
                          value={addPersonFormData[attr.key] || ''}
                          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setAddPersonFormData({ ...addPersonFormData, [attr.key]: e.target.value })}
                          disabled={addingMember}
                          rows={3}
                        />
                      );
                    }

                    if (attrType === 'select') {
                      return (
                        <Select
                          key={attr.key}
                          label={fieldLabel}
                          value={addPersonFormData[attr.key] || ''}
                          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setAddPersonFormData({ ...addPersonFormData, [attr.key]: e.target.value })}
                          disabled={addingMember}
                          data={[
                            { label: `Select ${attr.label}...`, value: '', disabled: true },
                            ...(attr.options || []).map((opt: any) => ({ label: opt, value: opt })),
                          ]}
                        />
                      );
                    }

                    if (attrType === 'multi-select') {
                      const selected: string[] = addPersonFormData[attr.key] ? JSON.parse(addPersonFormData[attr.key] || '[]') : [];
                      return (
                        <div key={attr.key} className="flex flex-col">
                          <span className="text-sm font-medium text-[var(--gray-12)] mb-1">{fieldLabel}</span>
                          <div className="flex flex-wrap gap-1.5 rounded-lg border border-[var(--gray-6)] bg-[var(--color-surface)] p-2 min-h-[38px]">
                            {(attr.options || []).map((opt: any) => {
                              const isSelected = selected.includes(opt);
                              return (
                                <button
                                  key={opt}
                                  type="button"
                                  disabled={addingMember}
                                  onClick={() => {
                                    const next = isSelected ? selected.filter(s => s !== opt) : [...selected, opt];
                                    setAddPersonFormData({ ...addPersonFormData, [attr.key]: JSON.stringify(next) });
                                  }}
                                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                                    isSelected
                                      ? 'bg-[var(--accent-9)] text-white'
                                      : 'bg-[var(--gray-3)] text-[var(--gray-11)] hover:bg-[var(--gray-4)]'
                                  } ${addingMember ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                                >
                                  {opt}
                                </button>
                              );
                            })}
                            {(attr.options || []).length === 0 && (
                              <span className="text-xs text-[var(--gray-8)]">No options configured</span>
                            )}
                          </div>
                        </div>
                      );
                    }

                    // Default: string type
                    return (
                      <Input
                        key={attr.key}
                        label={fieldLabel}
                        value={addPersonFormData[attr.key] || ''}
                        onChange={(e) => setAddPersonFormData({ ...addPersonFormData, [attr.key]: e.target.value })}
                        required={attr.required}
                        disabled={addingMember}
                      />
                    );
                  })}
                </div>
              ));
            })()}
          </div>
        </Modal>
      </div>
    </Page>
  );
}
