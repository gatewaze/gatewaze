// @ts-nocheck
import { useEffect, useState, useCallback } from 'react';
import {
  Loader2,
  Search,
  Download,
  Upload,
  Pencil,
  UserCheck,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { getSupabase } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface RegistrationRow {
  id: string;
  status: string;
  registration_type?: string;
  ticket_type?: string;
  payment_status?: string;
  amount_paid?: number;
  badge_print_status?: string;
  notes?: string;
  registered_at: string;
  checked_in_at?: string;
  customers: {
    id: string;
    email: string;
    full_name?: string;
    first_name?: string;
    last_name?: string;
    company?: string;
    job_title?: string;
  };
}

interface Props {
  eventId: string;
  onCountChange?: (count: number) => void;
}

const STATUS_COLORS: Record<string, string> = {
  confirmed: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400',
  attended: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400',
  pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400',
  cancelled: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400',
  no_show: 'bg-gray-100 text-gray-800 dark:bg-gray-900/30 dark:text-gray-400',
};

const PAYMENT_COLORS: Record<string, string> = {
  paid: 'bg-green-100 text-green-800',
  pending: 'bg-yellow-100 text-yellow-800',
  refunded: 'bg-red-100 text-red-800',
  waived: 'bg-gray-100 text-gray-800',
};

function parseCSV(text: string): Record<string, string>[] {
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, '').toLowerCase().replace(/\s+/g, '_'));
  return lines.slice(1).map(line => {
    const values = line.match(/(".*?"|[^,]*)/g)?.map(v => v.trim().replace(/^"|"$/g, '')) || [];
    const row: Record<string, string> = {};
    headers.forEach((h, i) => { row[h] = values[i] || ''; });
    return row;
  });
}

export function EventRegistrationsTab({ eventId, onCountChange }: Props) {
  const [registrations, setRegistrations] = useState<RegistrationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterType, setFilterType] = useState('all');
  const [page, setPage] = useState(0);
  const pageSize = 50;

  // Edit modal
  const [showEdit, setShowEdit] = useState(false);
  const [editingReg, setEditingReg] = useState<RegistrationRow | null>(null);
  const [editForm, setEditForm] = useState({
    status: '',
    registration_type: '',
    ticket_type: '',
    payment_status: '',
    amount_paid: '',
    notes: '',
  });
  const [saving, setSaving] = useState(false);

  // Bulk upload
  const [showBulkUpload, setShowBulkUpload] = useState(false);
  const [bulkFile, setBulkFile] = useState<File | null>(null);
  const [bulkUploading, setBulkUploading] = useState(false);
  const [bulkPreview, setBulkPreview] = useState<Record<string, string>[]>([]);
  const [bulkProgress, setBulkProgress] = useState({ current: 0, total: 0 });
  const [bulkResult, setBulkResult] = useState<{ success: number; skipped: number; errors: number } | null>(null);

  const fetchRegistrations = useCallback(async () => {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('event_registrations')
      .select('*, customers(id, email, full_name, first_name, last_name, company, job_title)')
      .eq('event_id', eventId)
      .order('registered_at', { ascending: false });

    if (error) {
      toast.error('Failed to load registrations');
      return;
    }
    const rows = (data ?? []) as unknown as RegistrationRow[];
    setRegistrations(rows);
    onCountChange?.(rows.length);
    setLoading(false);
  }, [eventId, onCountChange]);

  useEffect(() => { fetchRegistrations(); }, [fetchRegistrations]);

  // Filter and search
  const filtered = registrations
    .filter(r => filterStatus === 'all' || r.status === filterStatus)
    .filter(r => filterType === 'all' || r.registration_type === filterType)
    .filter(r => {
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return (
        r.customers.email?.toLowerCase().includes(q) ||
        r.customers.full_name?.toLowerCase().includes(q) ||
        r.customers.company?.toLowerCase().includes(q) ||
        r.customers.job_title?.toLowerCase().includes(q)
      );
    });

  // Pagination
  const totalPages = Math.ceil(filtered.length / pageSize);
  const paginatedRegs = filtered.slice(page * pageSize, (page + 1) * pageSize);

  // Unique types for filter
  const regTypes = [...new Set(registrations.map(r => r.registration_type).filter(Boolean))] as string[];

  // Stats
  const confirmedCount = registrations.filter(r => r.status === 'confirmed' || r.status === 'attended').length;
  const checkedInCount = registrations.filter(r => r.checked_in_at).length;

  // Edit
  function openEdit(reg: RegistrationRow) {
    setEditingReg(reg);
    setEditForm({
      status: reg.status,
      registration_type: reg.registration_type || '',
      ticket_type: reg.ticket_type || '',
      payment_status: reg.payment_status || '',
      amount_paid: reg.amount_paid != null ? String(reg.amount_paid) : '',
      notes: reg.notes || '',
    });
    setShowEdit(true);
  }

  async function saveEdit() {
    if (!editingReg) return;
    setSaving(true);
    const supabase = getSupabase();
    const { error } = await supabase.from('event_registrations').update({
      status: editForm.status,
      registration_type: editForm.registration_type || null,
      ticket_type: editForm.ticket_type || null,
      payment_status: editForm.payment_status || null,
      amount_paid: editForm.amount_paid ? parseFloat(editForm.amount_paid) : null,
      notes: editForm.notes || null,
    }).eq('id', editingReg.id);
    if (error) toast.error(error.message);
    else {
      toast.success('Registration updated');
      setShowEdit(false);
      setEditingReg(null);
      await fetchRegistrations();
    }
    setSaving(false);
  }

  // Quick status change
  async function quickStatusChange(id: string, newStatus: string) {
    const supabase = getSupabase();
    const updates: Record<string, unknown> = { status: newStatus };
    if (newStatus === 'cancelled') updates.cancelled_at = new Date().toISOString();
    const { error } = await supabase.from('event_registrations').update(updates).eq('id', id);
    if (error) toast.error(error.message);
    else { toast.success(`Status changed to ${newStatus}`); await fetchRegistrations(); }
  }

  // Export CSV
  function exportCsv() {
    const headers = ['Name', 'Email', 'Company', 'Job Title', 'Status', 'Type', 'Ticket', 'Payment', 'Amount', 'Registered', 'Checked In'];
    const rows = filtered.map(r => [
      r.customers.full_name || '',
      r.customers.email,
      r.customers.company || '',
      r.customers.job_title || '',
      r.status,
      r.registration_type || '',
      r.ticket_type || '',
      r.payment_status || '',
      r.amount_paid != null ? r.amount_paid.toString() : '',
      new Date(r.registered_at).toISOString(),
      r.checked_in_at ? new Date(r.checked_in_at).toISOString() : '',
    ]);
    const csv = [headers, ...rows].map(row => row.map(c => `"${c}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `registrations-${eventId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${filtered.length} registrations`);
  }

  // Bulk upload handlers
  function handleBulkFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBulkFile(file);
    setBulkResult(null);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const rows = parseCSV(text);
      setBulkPreview(rows);
    };
    reader.readAsText(file);
  }

  function openBulkUpload() {
    setBulkFile(null);
    setBulkPreview([]);
    setBulkUploading(false);
    setBulkProgress({ current: 0, total: 0 });
    setBulkResult(null);
    setShowBulkUpload(true);
  }

  async function executeBulkUpload() {
    if (bulkPreview.length === 0) return;
    setBulkUploading(true);
    setBulkProgress({ current: 0, total: bulkPreview.length });
    let success = 0;
    let skipped = 0;
    let errors = 0;

    for (let i = 0; i < bulkPreview.length; i++) {
      const row = bulkPreview[i];
      setBulkProgress({ current: i + 1, total: bulkPreview.length });
      if (!row.email?.trim()) {
        errors++;
        continue;
      }
      try {
        const response = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/event-registration`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              email: row.email,
              event_id: eventId,
              first_name: row.first_name,
              last_name: row.last_name,
              company: row.company,
              job_title: row.job_title,
              phone: row.phone,
              registration_type: row.registration_type || 'free',
              source: 'csv_upload',
            }),
          }
        );
        if (response.ok) {
          const data = await response.json();
          if (data.duplicate || data.skipped) skipped++;
          else success++;
        } else if (response.status === 409) {
          skipped++;
        } else {
          errors++;
        }
      } catch {
        errors++;
      }
    }

    setBulkUploading(false);
    setBulkResult({ success, skipped, errors });
    if (success > 0) {
      toast.success(`${success} registrations uploaded`);
    }
  }

  function closeBulkUpload() {
    setShowBulkUpload(false);
    if (bulkResult && bulkResult.success > 0) {
      fetchRegistrations();
    }
  }

  if (loading) return <Card><CardContent className="py-8"><div className="flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div></CardContent></Card>;

  return (
    <>
      <div className="space-y-6">
        {/* Stats */}
        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">Total registrations</p>
              <p className="text-2xl font-bold">{registrations.length}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">Confirmed</p>
              <p className="text-2xl font-bold text-green-600">{confirmedCount}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">Checked in</p>
              <p className="text-2xl font-bold text-blue-600">{checkedInCount}</p>
            </CardContent>
          </Card>
        </div>

        {/* Table */}
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 gap-4">
            <CardTitle>Registrations ({filtered.length})</CardTitle>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={openBulkUpload}>
                <Upload className="mr-1 h-4 w-4" /> Upload CSV
              </Button>
              <Button size="sm" variant="outline" onClick={exportCsv}>
                <Download className="mr-1 h-4 w-4" /> Export CSV
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Filters */}
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative flex-1 min-w-48">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input placeholder="Search name, email, company..." value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} className="pl-9" />
              </div>
              <Select value={filterStatus} onValueChange={(v) => { setFilterStatus(v); setPage(0); }}>
                <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="confirmed">Confirmed</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="attended">Attended</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                  <SelectItem value="no_show">No show</SelectItem>
                </SelectContent>
              </Select>
              {regTypes.length > 0 && (
                <Select value={filterType} onValueChange={(v) => { setFilterType(v); setPage(0); }}>
                  <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All types</SelectItem>
                    {regTypes.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            </div>

            {filtered.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {search || filterStatus !== 'all' ? 'No registrations match your filters.' : 'No registrations yet.'}
              </p>
            ) : (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Attendee</TableHead>
                      <TableHead>Company</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Payment</TableHead>
                      <TableHead>Registered</TableHead>
                      <TableHead className="w-24">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedRegs.map((reg) => (
                      <TableRow key={reg.id}>
                        <TableCell>
                          <div>
                            <p className="font-medium">{reg.customers.full_name || reg.customers.email}</p>
                            {reg.customers.full_name && <p className="text-xs text-muted-foreground">{reg.customers.email}</p>}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div>
                            <p className="text-sm">{reg.customers.company || '—'}</p>
                            {reg.customers.job_title && <p className="text-xs text-muted-foreground">{reg.customers.job_title}</p>}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge className={STATUS_COLORS[reg.status] || ''}>{reg.status}</Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {reg.registration_type || '—'}
                          {reg.ticket_type && <span className="block text-xs">{reg.ticket_type}</span>}
                        </TableCell>
                        <TableCell>
                          {reg.payment_status && (
                            <div>
                              <Badge className={PAYMENT_COLORS[reg.payment_status] || ''} variant="outline">{reg.payment_status}</Badge>
                              {reg.amount_paid != null && <p className="text-xs mt-0.5 font-mono">${Number(reg.amount_paid).toFixed(2)}</p>}
                            </div>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {new Date(reg.registered_at).toLocaleDateString()}
                          {reg.checked_in_at && (
                            <p className="text-xs text-green-600 flex items-center gap-1 mt-0.5">
                              <UserCheck className="h-3 w-3" /> {new Date(reg.checked_in_at).toLocaleTimeString()}
                            </p>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(reg)}>
                              <Pencil className="h-3 w-3" />
                            </Button>
                            {reg.status === 'pending' && (
                              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => quickStatusChange(reg.id, 'confirmed')}>
                                <UserCheck className="h-3 w-3 text-green-600" />
                              </Button>
                            )}
                            {reg.status !== 'cancelled' && (
                              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => quickStatusChange(reg.id, 'cancelled')}>
                                <XCircle className="h-3 w-3 text-destructive" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between pt-2">
                    <p className="text-sm text-muted-foreground">
                      Showing {page * pageSize + 1}–{Math.min((page + 1) * pageSize, filtered.length)} of {filtered.length}
                    </p>
                    <div className="flex gap-1">
                      <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(p => p - 1)}>Previous</Button>
                      <Button variant="outline" size="sm" disabled={page >= totalPages - 1} onClick={() => setPage(p => p + 1)}>Next</Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Edit Dialog */}
      <Dialog open={showEdit} onOpenChange={setShowEdit}>
        <DialogContent>
          <DialogHeader><DialogTitle>Edit registration</DialogTitle></DialogHeader>
          {editingReg && (
            <div className="space-y-4">
              <div className="rounded-md border p-3 bg-accent/50">
                <p className="font-medium">{editingReg.customers.full_name || editingReg.customers.email}</p>
                <p className="text-xs text-muted-foreground">{editingReg.customers.email}</p>
              </div>
              <div className="grid gap-4 grid-cols-2">
                <div className="space-y-2">
                  <Label>Status</Label>
                  <Select value={editForm.status} onValueChange={(v) => setEditForm(p => ({ ...p, status: v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="confirmed">Confirmed</SelectItem>
                      <SelectItem value="attended">Attended</SelectItem>
                      <SelectItem value="cancelled">Cancelled</SelectItem>
                      <SelectItem value="no_show">No show</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Registration type</Label>
                  <Select value={editForm.registration_type || 'none'} onValueChange={(v) => setEditForm(p => ({ ...p, registration_type: v === 'none' ? '' : v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">—</SelectItem>
                      {['free', 'paid', 'comp', 'sponsor', 'speaker', 'staff', 'vip'].map(t => (
                        <SelectItem key={t} value={t}>{t}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <div className="grid gap-4 grid-cols-2">
                <div className="space-y-2">
                  <Label>Payment status</Label>
                  <Select value={editForm.payment_status || 'none'} onValueChange={(v) => setEditForm(p => ({ ...p, payment_status: v === 'none' ? '' : v }))}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">—</SelectItem>
                      <SelectItem value="pending">Pending</SelectItem>
                      <SelectItem value="paid">Paid</SelectItem>
                      <SelectItem value="refunded">Refunded</SelectItem>
                      <SelectItem value="waived">Waived</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Amount paid</Label>
                  <Input type="number" step="0.01" min={0} value={editForm.amount_paid} onChange={(e) => setEditForm(p => ({ ...p, amount_paid: e.target.value }))} />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Ticket type</Label>
                <Input value={editForm.ticket_type} onChange={(e) => setEditForm(p => ({ ...p, ticket_type: e.target.value }))} placeholder="General admission, VIP, etc." />
              </div>
              <div className="space-y-2">
                <Label>Notes</Label>
                <Input value={editForm.notes} onChange={(e) => setEditForm(p => ({ ...p, notes: e.target.value }))} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEdit(false)}>Cancel</Button>
            <Button onClick={saveEdit} disabled={saving}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Save
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Upload Dialog */}
      <Dialog open={showBulkUpload} onOpenChange={setShowBulkUpload}>
        <DialogContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Bulk upload registrations</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>CSV file</Label>
              <Input
                type="file"
                accept=".csv"
                onChange={handleBulkFileChange}
                disabled={bulkUploading}
              />
              <p className="text-xs text-muted-foreground">
                Expected columns: email (required), first_name, last_name, company, job_title, phone, registration_type, ticket_type, notes
              </p>
            </div>

            {bulkPreview.length > 0 && !bulkResult && (
              <div className="space-y-2">
                <p className="text-sm font-medium">Preview ({bulkPreview.length} rows total{bulkPreview.length > 5 ? ', showing first 5' : ''})</p>
                <div className="overflow-auto max-h-48 rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Email</TableHead>
                        <TableHead>First Name</TableHead>
                        <TableHead>Last Name</TableHead>
                        <TableHead>Company</TableHead>
                        <TableHead>Type</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {bulkPreview.slice(0, 5).map((row, i) => (
                        <TableRow key={i}>
                          <TableCell className="text-xs">{row.email || <span className="text-destructive">missing</span>}</TableCell>
                          <TableCell className="text-xs">{row.first_name || '—'}</TableCell>
                          <TableCell className="text-xs">{row.last_name || '—'}</TableCell>
                          <TableCell className="text-xs">{row.company || '—'}</TableCell>
                          <TableCell className="text-xs">{row.registration_type || 'free'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}

            {bulkUploading && (
              <div className="space-y-2">
                <p className="text-sm">Uploading {bulkProgress.current} of {bulkProgress.total}...</p>
                <div className="h-2 w-full rounded-full bg-secondary">
                  <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${(bulkProgress.current / bulkProgress.total) * 100}%` }} />
                </div>
              </div>
            )}

            {bulkResult && (
              <div className="rounded-md border p-4 space-y-2">
                <p className="font-medium">Upload complete</p>
                <div className="flex gap-4 text-sm">
                  <span className="text-green-600">{bulkResult.success} added</span>
                  <span className="text-yellow-600">{bulkResult.skipped} skipped (duplicates)</span>
                  <span className="text-red-600">{bulkResult.errors} errors</span>
                </div>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={closeBulkUpload} disabled={bulkUploading}>
              {bulkResult ? 'Close' : 'Cancel'}
            </Button>
            {!bulkResult && (
              <Button onClick={executeBulkUpload} disabled={bulkUploading || bulkPreview.length === 0}>
                {bulkUploading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {bulkUploading ? `Uploading ${bulkProgress.current}/${bulkProgress.total}` : `Upload ${bulkPreview.length} rows`}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
