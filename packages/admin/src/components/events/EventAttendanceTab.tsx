// @ts-nocheck
import { useEffect, useState, useCallback } from 'react';
import {
  Loader2,
  Search,
  Download,
  Plus,
  Upload,
  UserCheck,
  Clock,
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

interface AttendanceRow {
  id: string;
  customer_id: string;
  registration_id?: string;
  check_in_method?: string;
  check_in_location?: string;
  checked_in_at: string;
  checked_out_at?: string;
  customers: {
    id: string;
    email: string;
    full_name?: string;
    company?: string;
  };
}

interface RegistrationOption {
  id: string;
  customer_id: string;
  customers: {
    id: string;
    email: string;
    full_name?: string;
  };
}

interface BulkCsvRow {
  email: string;
  check_in_method?: string;
  check_in_location?: string;
}

interface BulkResults {
  success: number;
  error: number;
}

interface Props {
  eventId: string;
}

function parseCsv(text: string): BulkCsvRow[] {
  const lines = text.split(/\r?\n/).filter(line => line.trim());
  if (lines.length < 2) return [];
  const headerLine = lines[0].toLowerCase();
  const headers = headerLine.split(',').map(h => h.trim().replace(/^"|"$/g, ''));
  const emailIdx = headers.indexOf('email');
  if (emailIdx === -1) return [];
  const methodIdx = headers.indexOf('check_in_method');
  const locationIdx = headers.indexOf('check_in_location');
  return lines.slice(1).map(line => {
    const cols = line.split(',').map(c => c.trim().replace(/^"|"$/g, ''));
    return {
      email: cols[emailIdx] || '',
      check_in_method: methodIdx >= 0 ? cols[methodIdx] : undefined,
      check_in_location: locationIdx >= 0 ? cols[locationIdx] : undefined,
    };
  }).filter(r => r.email);
}

const METHOD_LABELS: Record<string, string> = {
  qr_scan: 'QR scan',
  manual_entry: 'Manual',
  badge_scan: 'Badge scan',
  mobile_app: 'Mobile app',
  sponsor_booth: 'Sponsor booth',
};

export function EventAttendanceTab({ eventId }: Props) {
  const [attendance, setAttendance] = useState<AttendanceRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterMethod, setFilterMethod] = useState('all');

  // Manual check-in
  const [showCheckIn, setShowCheckIn] = useState(false);
  const [registrations, setRegistrations] = useState<RegistrationOption[]>([]);
  const [checkInSearch, setCheckInSearch] = useState('');
  const [checkInMethod, setCheckInMethod] = useState('manual_entry');
  const [checkInLocation, setCheckInLocation] = useState('');
  const [saving, setSaving] = useState(false);

  // Bulk upload
  const [showBulkUpload, setShowBulkUpload] = useState(false);
  const [bulkFile, setBulkFile] = useState<File | null>(null);
  const [bulkUploading, setBulkUploading] = useState(false);
  const [bulkPreview, setBulkPreview] = useState<BulkCsvRow[]>([]);
  const [bulkResults, setBulkResults] = useState<BulkResults | null>(null);

  const fetchData = useCallback(async () => {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('event_attendance')
      .select('*, customers(id, email, full_name, company)')
      .eq('event_id', eventId)
      .order('checked_in_at', { ascending: false });
    if (error) toast.error('Failed to load attendance');
    setAttendance((data ?? []) as unknown as AttendanceRow[]);
    setLoading(false);
  }, [eventId]);

  useEffect(() => { fetchData(); }, [fetchData]);

  // Load registrations for manual check-in
  async function loadRegistrations() {
    const supabase = getSupabase();
    const { data } = await supabase
      .from('event_registrations')
      .select('id, customer_id, customers(id, email, full_name)')
      .eq('event_id', eventId)
      .in('status', ['confirmed', 'pending'])
      .order('registered_at', { ascending: false });
    setRegistrations((data ?? []) as unknown as RegistrationOption[]);
  }

  // Filter
  const methods = [...new Set(attendance.map(a => a.check_in_method).filter(Boolean))] as string[];
  const filtered = attendance
    .filter(a => filterMethod === 'all' || a.check_in_method === filterMethod)
    .filter(a => {
      if (!search.trim()) return true;
      const q = search.toLowerCase();
      return a.customers.email?.toLowerCase().includes(q) || a.customers.full_name?.toLowerCase().includes(q) || a.customers.company?.toLowerCase().includes(q);
    });

  // Already checked in customer IDs
  const checkedInCustomerIds = new Set(attendance.map(a => a.customer_id));

  // Registrations not yet checked in
  const availableForCheckIn = registrations
    .filter(r => !checkedInCustomerIds.has(r.customer_id))
    .filter(r => {
      if (!checkInSearch.trim()) return true;
      const q = checkInSearch.toLowerCase();
      return r.customers.email?.toLowerCase().includes(q) || r.customers.full_name?.toLowerCase().includes(q);
    });

  // Manual check-in
  async function checkInPerson(reg: RegistrationOption) {
    setSaving(true);
    const supabase = getSupabase();
    const { error } = await supabase.from('event_attendance').insert({
      event_id: eventId,
      customer_id: reg.customer_id,
      registration_id: reg.id,
      check_in_method: checkInMethod,
      check_in_location: checkInLocation || null,
    });
    if (error) {
      toast.error(error.message);
    } else {
      toast.success(`Checked in ${reg.customers.full_name || reg.customers.email}`);
      // Also update registration status
      await supabase.from('event_registrations').update({
        status: 'attended',
        checked_in_at: new Date().toISOString(),
      }).eq('id', reg.id);
      await fetchData();
      await loadRegistrations();
    }
    setSaving(false);
  }

  // Export
  function exportCsv() {
    const headers = ['Name', 'Email', 'Company', 'Method', 'Location', 'Checked In', 'Checked Out'];
    const rows = filtered.map(a => [
      a.customers.full_name || '',
      a.customers.email,
      a.customers.company || '',
      a.check_in_method || '',
      a.check_in_location || '',
      new Date(a.checked_in_at).toISOString(),
      a.checked_out_at ? new Date(a.checked_out_at).toISOString() : '',
    ]);
    const csv = [headers, ...rows].map(r => r.map(c => `"${c}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `attendance-${eventId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${filtered.length} records`);
  }

  // Bulk CSV upload
  function handleBulkFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] || null;
    setBulkFile(file);
    setBulkResults(null);
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        const text = ev.target?.result as string;
        const rows = parseCsv(text);
        setBulkPreview(rows);
      };
      reader.readAsText(file);
    } else {
      setBulkPreview([]);
    }
  }

  async function handleBulkUpload() {
    if (bulkPreview.length === 0) return;
    setBulkUploading(true);
    setBulkResults(null);
    const supabase = getSupabase();
    let successCount = 0;
    let errorCount = 0;

    for (const row of bulkPreview) {
      // Look up customer
      const { data: customer } = await supabase
        .from('customers')
        .select('id')
        .eq('email', row.email)
        .single();

      if (!customer) { errorCount++; continue; }

      // Check for existing registration
      const { data: reg } = await supabase
        .from('event_registrations')
        .select('id')
        .eq('event_id', eventId)
        .eq('customer_id', customer.id)
        .single();

      // Insert attendance
      const { error } = await supabase.from('event_attendance').insert({
        event_id: eventId,
        customer_id: customer.id,
        registration_id: reg?.id || null,
        check_in_method: row.check_in_method || 'manual_entry',
        check_in_location: row.check_in_location || null,
      });

      if (error) { errorCount++; continue; }

      // Also update registration status if exists
      if (reg) {
        await supabase.from('event_registrations').update({
          status: 'attended',
          checked_in_at: new Date().toISOString(),
        }).eq('id', reg.id);
      }

      successCount++;
    }

    setBulkResults({ success: successCount, error: errorCount });
    setBulkUploading(false);
    toast.success(`Bulk upload complete: ${successCount} checked in, ${errorCount} failed`);
    await fetchData();
  }

  function closeBulkUpload() {
    setShowBulkUpload(false);
    setBulkFile(null);
    setBulkPreview([]);
    setBulkResults(null);
  }

  // Stats
  const uniqueAttendees = new Set(attendance.map(a => a.customer_id)).size;
  const today = new Date().toDateString();
  const todayCheckIns = attendance.filter(a => new Date(a.checked_in_at).toDateString() === today).length;

  if (loading) return <Card><CardContent className="py-8"><div className="flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div></CardContent></Card>;

  return (
    <>
      <div className="space-y-6">
        {/* Stats */}
        <div className="grid gap-4 sm:grid-cols-3">
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">Total check-ins</p>
              <p className="text-2xl font-bold">{attendance.length}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">Unique attendees</p>
              <p className="text-2xl font-bold text-blue-600">{uniqueAttendees}</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm text-muted-foreground">Today</p>
              <p className="text-2xl font-bold text-green-600">{todayCheckIns}</p>
            </CardContent>
          </Card>
        </div>

        {/* Table */}
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0 gap-4">
            <CardTitle>Attendance ({filtered.length})</CardTitle>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={exportCsv}>
                <Download className="mr-1 h-4 w-4" /> Export
              </Button>
              <Button size="sm" variant="outline" onClick={() => setShowBulkUpload(true)}>
                <Upload className="mr-1 h-4 w-4" /> Upload CSV
              </Button>
              <Button size="sm" onClick={() => { setShowCheckIn(true); loadRegistrations(); }}>
                <Plus className="mr-1 h-4 w-4" /> Manual check-in
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Filters */}
            <div className="flex flex-wrap items-center gap-3">
              <div className="relative flex-1 min-w-48">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <Input placeholder="Search attendees..." value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
              </div>
              {methods.length > 0 && (
                <Select value={filterMethod} onValueChange={setFilterMethod}>
                  <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All methods</SelectItem>
                    {methods.map(m => <SelectItem key={m} value={m}>{METHOD_LABELS[m] || m}</SelectItem>)}
                  </SelectContent>
                </Select>
              )}
            </div>

            {filtered.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                {search || filterMethod !== 'all' ? 'No matching records.' : 'No attendance records yet.'}
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Attendee</TableHead>
                    <TableHead>Company</TableHead>
                    <TableHead>Method</TableHead>
                    <TableHead>Location</TableHead>
                    <TableHead>Checked in</TableHead>
                    <TableHead>Duration</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map(a => {
                    // Calculate duration
                    let duration = '';
                    if (a.checked_out_at) {
                      const ms = new Date(a.checked_out_at).getTime() - new Date(a.checked_in_at).getTime();
                      const hours = Math.floor(ms / 3600000);
                      const mins = Math.floor((ms % 3600000) / 60000);
                      duration = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;
                    }

                    return (
                      <TableRow key={a.id}>
                        <TableCell>
                          <div>
                            <p className="font-medium">{a.customers.full_name || a.customers.email}</p>
                            {a.customers.full_name && <p className="text-xs text-muted-foreground">{a.customers.email}</p>}
                          </div>
                        </TableCell>
                        <TableCell className="text-muted-foreground">{a.customers.company || '—'}</TableCell>
                        <TableCell>
                          {a.check_in_method && (
                            <Badge variant="outline">{METHOD_LABELS[a.check_in_method] || a.check_in_method}</Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-muted-foreground">{a.check_in_location || '—'}</TableCell>
                        <TableCell>
                          <div>
                            <p className="text-sm">{new Date(a.checked_in_at).toLocaleTimeString()}</p>
                            <p className="text-xs text-muted-foreground">{new Date(a.checked_in_at).toLocaleDateString()}</p>
                          </div>
                        </TableCell>
                        <TableCell>
                          {a.checked_out_at ? (
                            <span className="text-sm">{duration}</span>
                          ) : (
                            <Badge variant="secondary" className="text-xs">
                              <Clock className="mr-1 h-3 w-3" /> Still here
                            </Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Manual Check-in Dialog */}
      <Dialog open={showCheckIn} onOpenChange={setShowCheckIn}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Manual check-in</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-3 grid-cols-2">
              <div className="space-y-2">
                <Label>Method</Label>
                <Select value={checkInMethod} onValueChange={setCheckInMethod}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="manual_entry">Manual entry</SelectItem>
                    <SelectItem value="qr_scan">QR scan</SelectItem>
                    <SelectItem value="badge_scan">Badge scan</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Location</Label>
                <Input value={checkInLocation} onChange={(e) => setCheckInLocation(e.target.value)} placeholder="Main entrance" />
              </div>
            </div>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input placeholder="Search registered attendees..." value={checkInSearch} onChange={(e) => setCheckInSearch(e.target.value)} className="pl-9" />
            </div>

            <div className="max-h-64 overflow-y-auto space-y-1">
              {availableForCheckIn.length === 0 ? (
                <p className="py-4 text-center text-sm text-muted-foreground">
                  {checkInSearch ? 'No matching registrations.' : 'All registered attendees have been checked in.'}
                </p>
              ) : (
                availableForCheckIn.map(reg => (
                  <div key={reg.id} className="flex items-center justify-between rounded-md border p-2 hover:bg-accent">
                    <div>
                      <p className="text-sm font-medium">{reg.customers.full_name || reg.customers.email}</p>
                      {reg.customers.full_name && <p className="text-xs text-muted-foreground">{reg.customers.email}</p>}
                    </div>
                    <Button size="sm" disabled={saving} onClick={() => checkInPerson(reg)}>
                      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserCheck className="mr-1 h-4 w-4" />}
                      Check in
                    </Button>
                  </div>
                ))
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCheckIn(false)}>Close</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Upload Dialog */}
      <Dialog open={showBulkUpload} onOpenChange={(open) => { if (!open) closeBulkUpload(); }}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader><DialogTitle>Bulk CSV upload</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>CSV file</Label>
              <Input
                type="file"
                accept=".csv"
                onChange={handleBulkFileChange}
              />
              <p className="text-xs text-muted-foreground">
                Expected columns: <strong>email</strong> (required), check_in_method (optional), check_in_location (optional)
              </p>
            </div>

            {bulkPreview.length > 0 && !bulkResults && (
              <div className="space-y-2">
                <p className="text-sm font-medium">Preview ({bulkPreview.length} rows total)</p>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Email</TableHead>
                      <TableHead>Method</TableHead>
                      <TableHead>Location</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {bulkPreview.slice(0, 5).map((row, i) => (
                      <TableRow key={i}>
                        <TableCell className="text-sm">{row.email}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{row.check_in_method || 'manual_entry'}</TableCell>
                        <TableCell className="text-sm text-muted-foreground">{row.check_in_location || '—'}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {bulkPreview.length > 5 && (
                  <p className="text-xs text-muted-foreground">...and {bulkPreview.length - 5} more rows</p>
                )}
              </div>
            )}

            {bulkUploading && (
              <div className="flex items-center gap-2 py-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm text-muted-foreground">Processing {bulkPreview.length} rows...</span>
              </div>
            )}

            {bulkResults && (
              <div className="rounded-md border p-4 space-y-1">
                <p className="font-medium text-sm">Upload complete</p>
                <p className="text-sm text-green-600">{bulkResults.success} successfully checked in</p>
                {bulkResults.error > 0 && (
                  <p className="text-sm text-red-600">{bulkResults.error} failed (customer not found or duplicate)</p>
                )}
              </div>
            )}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={closeBulkUpload}>
              {bulkResults ? 'Close' : 'Cancel'}
            </Button>
            {!bulkResults && (
              <Button
                onClick={handleBulkUpload}
                disabled={bulkPreview.length === 0 || bulkUploading}
              >
                {bulkUploading ? (
                  <><Loader2 className="mr-1 h-4 w-4 animate-spin" /> Uploading...</>
                ) : (
                  <><Upload className="mr-1 h-4 w-4" /> Upload {bulkPreview.length} rows</>
                )}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
