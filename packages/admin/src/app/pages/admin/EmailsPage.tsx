import { useEffect, useState } from 'react';
import { FileText, Send, RefreshCw } from 'lucide-react';
import { getSupabase } from '@/lib/supabase';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';

interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  updated_at: string;
}

interface EmailLog {
  id: string;
  to_email: string;
  subject: string;
  status: string;
  sent_at: string;
  error_message?: string;
}

function logStatusVariant(
  status: string,
): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'sent':
    case 'delivered':
      return 'default';
    case 'pending':
    case 'queued':
      return 'secondary';
    case 'failed':
    case 'bounced':
      return 'destructive';
    default:
      return 'outline';
  }
}

export default function EmailsPage() {
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [logs, setLogs] = useState<EmailLog[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(true);
  const [loadingLogs, setLoadingLogs] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function fetchTemplates() {
    try {
      setLoadingTemplates(true);
      const supabase = getSupabase();

      const { data, error: fetchError } = await supabase
        .from('email_templates')
        .select('id, name, subject, updated_at')
        .order('name', { ascending: true });

      if (fetchError) throw fetchError;
      setTemplates(data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load email templates');
    } finally {
      setLoadingTemplates(false);
    }
  }

  async function fetchLogs() {
    try {
      setLoadingLogs(true);
      const supabase = getSupabase();

      const { data, error: fetchError } = await supabase
        .from('email_logs')
        .select('id, to_email, subject, status, sent_at, error_message')
        .order('sent_at', { ascending: false })
        .limit(50);

      if (fetchError) throw fetchError;
      setLogs(data ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load email logs');
    } finally {
      setLoadingLogs(false);
    }
  }

  useEffect(() => {
    fetchTemplates();
    fetchLogs();
  }, []);

  if (error) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="text-center">
          <p className="text-lg font-medium text-destructive">Error loading email data</p>
          <p className="mt-1 text-sm text-muted-foreground">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Emails</h1>
        <p className="text-muted-foreground">Manage email templates and view send history.</p>
      </div>

      <Tabs defaultValue="templates">
        <TabsList>
          <TabsTrigger value="templates">
            <FileText className="mr-2 h-4 w-4" />
            Templates
          </TabsTrigger>
          <TabsTrigger value="logs">
            <Send className="mr-2 h-4 w-4" />
            Logs
          </TabsTrigger>
        </TabsList>

        <TabsContent value="templates">
          <Card>
            <CardHeader>
              <CardTitle>Email Templates</CardTitle>
              <CardDescription>
                Templates used for automated and manual email communications.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loadingTemplates ? (
                <div className="space-y-3">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : templates.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No email templates found.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Name</TableHead>
                      <TableHead>Subject</TableHead>
                      <TableHead>Last Updated</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {templates.map((template) => (
                      <TableRow key={template.id} className="cursor-pointer">
                        <TableCell className="font-medium">{template.name}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {template.subject}
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {new Date(template.updated_at).toLocaleString()}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="logs">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle>Email Logs</CardTitle>
                  <CardDescription>
                    Recent emails sent from the platform.
                  </CardDescription>
                </div>
                <Button variant="outline" size="sm" onClick={fetchLogs}>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Refresh
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {loadingLogs ? (
                <div className="space-y-3">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <Skeleton key={i} className="h-12 w-full" />
                  ))}
                </div>
              ) : logs.length === 0 ? (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  No email logs found.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>To</TableHead>
                      <TableHead>Subject</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Sent At</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {logs.map((log) => (
                      <TableRow key={log.id}>
                        <TableCell className="font-medium">{log.to_email}</TableCell>
                        <TableCell className="max-w-xs truncate text-muted-foreground">
                          {log.subject}
                        </TableCell>
                        <TableCell>
                          <Badge variant={logStatusVariant(log.status)}>
                            {log.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {new Date(log.sent_at).toLocaleString()}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
