// @ts-nocheck
import { useEffect, useState, useCallback } from 'react';
import {
  Loader2,
  Users,
  UserCheck,
  DollarSign,
  TrendingUp,
  Clock,
  Download,
  BarChart3,
} from 'lucide-react';
import { toast } from 'sonner';
import { getSupabase } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';

interface Props {
  eventId: string;
}

interface SummaryMetrics {
  totalRegistrations: number;
  checkedIn: number;
  checkInRate: number;
  totalSpeakers: number;
  budgetTotal: number;
  revenueTotal: number;
}

interface StatusCount {
  status: string;
  count: number;
  percentage: number;
}

interface TypeCount {
  type: string;
  count: number;
  percentage: number;
}

interface DailyTrend {
  date: string;
  count: number;
  cumulative: number;
}

interface MethodCount {
  method: string;
  count: number;
  percentage: number;
}

interface CompanyCount {
  company: string;
  count: number;
}

const STATUS_COLORS: Record<string, string> = {
  confirmed: 'bg-green-500',
  attended: 'bg-emerald-500',
  pending: 'bg-yellow-500',
  cancelled: 'bg-red-500',
  waitlisted: 'bg-orange-500',
  declined: 'bg-gray-500',
};

const METHOD_COLORS: Record<string, string> = {
  qr_code: 'bg-blue-500',
  manual: 'bg-purple-500',
  badge_scan: 'bg-cyan-500',
  self_check_in: 'bg-indigo-500',
  nfc: 'bg-teal-500',
};

function getColor(map: Record<string, string>, key: string, fallback = 'bg-slate-400') {
  return map[key] ?? fallback;
}

export function EventReportsTab({ eventId }: Props) {
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<SummaryMetrics | null>(null);
  const [statusCounts, setStatusCounts] = useState<StatusCount[]>([]);
  const [typeCounts, setTypeCounts] = useState<TypeCount[]>([]);
  const [dailyTrend, setDailyTrend] = useState<DailyTrend[]>([]);
  const [methodCounts, setMethodCounts] = useState<MethodCount[]>([]);
  const [topCompanies, setTopCompanies] = useState<CompanyCount[]>([]);
  const [rawRegs, setRawRegs] = useState<any[]>([]);
  const [rawAttendance, setRawAttendance] = useState<any[]>([]);

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const supabase = getSupabase();
      const [regs, attendance, speakers, budget] = await Promise.all([
        supabase.from('event_registrations').select('*').eq('event_id', eventId),
        supabase.from('event_attendance').select('*').eq('event_id', eventId),
        supabase.from('event_speakers').select('*', { count: 'exact', head: true }).eq('event_id', eventId),
        supabase.from('event_budget_items').select('*').eq('event_id', eventId),
      ]);

      const registrations = regs.data ?? [];
      const attendanceData = attendance.data ?? [];
      const speakerCount = speakers.count ?? 0;
      const budgetItems = budget.data ?? [];

      setRawRegs(registrations);
      setRawAttendance(attendanceData);

      // Summary metrics
      const uniqueCheckedIn = new Set(attendanceData.map((a: any) => a.customer_id)).size;
      const totalRegs = registrations.length;
      const expenses = budgetItems
        .filter((b: any) => b.type === 'expense')
        .reduce((sum: number, b: any) => sum + (parseFloat(b.amount) || 0), 0);
      const revenue = budgetItems
        .filter((b: any) => b.type === 'income')
        .reduce((sum: number, b: any) => sum + (parseFloat(b.amount) || 0), 0);

      setSummary({
        totalRegistrations: totalRegs,
        checkedIn: uniqueCheckedIn,
        checkInRate: totalRegs > 0 ? Math.round((uniqueCheckedIn / totalRegs) * 100) : 0,
        totalSpeakers: speakerCount,
        budgetTotal: expenses,
        revenueTotal: revenue,
      });

      // Registration by status
      const statusMap = new Map<string, number>();
      registrations.forEach((r: any) => {
        const s = r.status || 'unknown';
        statusMap.set(s, (statusMap.get(s) || 0) + 1);
      });
      const statusArr = Array.from(statusMap.entries())
        .map(([status, count]) => ({
          status,
          count,
          percentage: totalRegs > 0 ? Math.round((count / totalRegs) * 100) : 0,
        }))
        .sort((a, b) => b.count - a.count);
      setStatusCounts(statusArr);

      // Registration by type
      const typeMap = new Map<string, number>();
      registrations.forEach((r: any) => {
        const t = r.registration_type || 'unknown';
        typeMap.set(t, (typeMap.get(t) || 0) + 1);
      });
      const typeArr = Array.from(typeMap.entries())
        .map(([type, count]) => ({
          type,
          count,
          percentage: totalRegs > 0 ? Math.round((count / totalRegs) * 100) : 0,
        }))
        .sort((a, b) => b.count - a.count);
      setTypeCounts(typeArr);

      // Daily registration trend
      const dateMap = new Map<string, number>();
      registrations.forEach((r: any) => {
        if (r.registered_at) {
          const date = r.registered_at.split('T')[0];
          dateMap.set(date, (dateMap.get(date) || 0) + 1);
        }
      });
      const sortedDates = Array.from(dateMap.entries()).sort((a, b) => a[0].localeCompare(b[0]));
      let cumulative = 0;
      const trendArr = sortedDates.map(([date, count]) => {
        cumulative += count;
        return { date, count, cumulative };
      });
      setDailyTrend(trendArr.slice(-30));

      // Attendance by method
      const methodMap = new Map<string, number>();
      attendanceData.forEach((a: any) => {
        const m = a.check_in_method || 'unknown';
        methodMap.set(m, (methodMap.get(m) || 0) + 1);
      });
      const totalAttendance = attendanceData.length;
      const methodArr = Array.from(methodMap.entries())
        .map(([method, count]) => ({
          method,
          count,
          percentage: totalAttendance > 0 ? Math.round((count / totalAttendance) * 100) : 0,
        }))
        .sort((a, b) => b.count - a.count);
      setMethodCounts(methodArr);

      // Top companies
      const companyMap = new Map<string, number>();
      registrations.forEach((r: any) => {
        const c = r.company?.trim();
        if (c) companyMap.set(c, (companyMap.get(c) || 0) + 1);
      });
      const companyArr = Array.from(companyMap.entries())
        .map(([company, count]) => ({ company, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);
      setTopCompanies(companyArr);
    } catch (err) {
      console.error('Failed to load report data:', err);
      toast.error('Failed to load report data');
    } finally {
      setLoading(false);
    }
  }, [eventId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const exportCSV = useCallback(() => {
    const lines: string[] = [];
    lines.push('Event Report');
    lines.push('');

    if (summary) {
      lines.push('Summary');
      lines.push(`Total Registrations,${summary.totalRegistrations}`);
      lines.push(`Checked In,${summary.checkedIn}`);
      lines.push(`Check-in Rate,${summary.checkInRate}%`);
      lines.push(`Total Speakers,${summary.totalSpeakers}`);
      lines.push(`Expenses,$${summary.budgetTotal.toFixed(2)}`);
      lines.push(`Revenue,$${summary.revenueTotal.toFixed(2)}`);
      lines.push('');
    }

    lines.push('Registration by Status');
    lines.push('Status,Count,Percentage');
    statusCounts.forEach((s) => lines.push(`${s.status},${s.count},${s.percentage}%`));
    lines.push('');

    lines.push('Registration by Type');
    lines.push('Type,Count,Percentage');
    typeCounts.forEach((t) => lines.push(`${t.type},${t.count},${t.percentage}%`));
    lines.push('');

    lines.push('Daily Registration Trend');
    lines.push('Date,Count,Cumulative');
    dailyTrend.forEach((d) => lines.push(`${d.date},${d.count},${d.cumulative}`));
    lines.push('');

    lines.push('Attendance by Method');
    lines.push('Method,Count,Percentage');
    methodCounts.forEach((m) => lines.push(`${m.method},${m.count},${m.percentage}%`));
    lines.push('');

    lines.push('Top Companies');
    lines.push('Company,Count');
    topCompanies.forEach((c) => lines.push(`"${c.company}",${c.count}`));

    const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `event-report-${eventId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Report exported');
  }, [summary, statusCounts, typeCounts, dailyTrend, methodCounts, topCompanies, eventId]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!summary) return null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-5 w-5" />
          <h3 className="text-lg font-semibold">Event Reports</h3>
        </div>
        <Button variant="outline" size="sm" onClick={exportCSV}>
          <Download className="h-4 w-4 mr-2" />
          Export CSV
        </Button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1">
              <Users className="h-3.5 w-3.5" /> Registrations
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{summary.totalRegistrations}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1">
              <UserCheck className="h-3.5 w-3.5" /> Checked In
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{summary.checkedIn}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1">
              <TrendingUp className="h-3.5 w-3.5" /> Check-in Rate
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{summary.checkInRate}%</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1">
              <Users className="h-3.5 w-3.5" /> Speakers
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{summary.totalSpeakers}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1">
              <DollarSign className="h-3.5 w-3.5" /> Expenses
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">${summary.budgetTotal.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1">
              <DollarSign className="h-3.5 w-3.5" /> Revenue
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">${summary.revenueTotal.toLocaleString()}</p>
          </CardContent>
        </Card>
      </div>

      {/* Registration by Status */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Registration by Status</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {statusCounts.length > 0 ? (
            <>
              <div className="flex h-4 rounded-full overflow-hidden">
                {statusCounts.map((s) => (
                  <div
                    key={s.status}
                    className={getColor(STATUS_COLORS, s.status)}
                    style={{ width: `${s.percentage}%` }}
                    title={`${s.status}: ${s.count}`}
                  />
                ))}
              </div>
              <div className="flex flex-wrap gap-3 text-sm">
                {statusCounts.map((s) => (
                  <div key={s.status} className="flex items-center gap-1.5">
                    <span className={`inline-block h-3 w-3 rounded-full ${getColor(STATUS_COLORS, s.status)}`} />
                    <span className="capitalize">{s.status}</span>
                    <Badge variant="secondary" className="text-xs">{s.count}</Badge>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No registrations yet</p>
          )}
        </CardContent>
      </Card>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Registration by Type */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Registration by Type</CardTitle>
          </CardHeader>
          <CardContent>
            {typeCounts.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">Count</TableHead>
                    <TableHead className="text-right">%</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {typeCounts.map((t) => (
                    <TableRow key={t.type}>
                      <TableCell className="capitalize">{t.type}</TableCell>
                      <TableCell className="text-right">{t.count}</TableCell>
                      <TableCell className="text-right">{t.percentage}%</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-sm text-muted-foreground">No data</p>
            )}
          </CardContent>
        </Card>

        {/* Top Companies */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Top Companies</CardTitle>
          </CardHeader>
          <CardContent>
            {topCompanies.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Company</TableHead>
                    <TableHead className="text-right">Count</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {topCompanies.map((c) => (
                    <TableRow key={c.company}>
                      <TableCell>{c.company}</TableCell>
                      <TableCell className="text-right">{c.count}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-sm text-muted-foreground">No company data</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Attendance by Method */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Attendance by Check-in Method</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {methodCounts.length > 0 ? (
            <>
              <div className="flex h-4 rounded-full overflow-hidden">
                {methodCounts.map((m) => (
                  <div
                    key={m.method}
                    className={getColor(METHOD_COLORS, m.method)}
                    style={{ width: `${m.percentage}%` }}
                    title={`${m.method}: ${m.count}`}
                  />
                ))}
              </div>
              <div className="flex flex-wrap gap-3 text-sm">
                {methodCounts.map((m) => (
                  <div key={m.method} className="flex items-center gap-1.5">
                    <span className={`inline-block h-3 w-3 rounded-full ${getColor(METHOD_COLORS, m.method)}`} />
                    <span className="capitalize">{m.method.replace(/_/g, ' ')}</span>
                    <Badge variant="secondary" className="text-xs">{m.count}</Badge>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No attendance data</p>
          )}
        </CardContent>
      </Card>

      {/* Daily Registration Trend */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <Clock className="h-4 w-4" />
            Daily Registration Trend
          </CardTitle>
          <CardDescription>Last 30 days of registration activity</CardDescription>
        </CardHeader>
        <CardContent>
          {dailyTrend.length > 0 ? (
            <div className="max-h-80 overflow-y-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead className="text-right">Count</TableHead>
                    <TableHead className="text-right">Cumulative</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {dailyTrend.map((d) => (
                    <TableRow key={d.date}>
                      <TableCell>{d.date}</TableCell>
                      <TableCell className="text-right">{d.count}</TableCell>
                      <TableCell className="text-right">{d.cumulative}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No registration dates available</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
