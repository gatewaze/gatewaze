import { useState, useRef, useCallback } from 'react';
import { Database, Loader2, CheckCircle2, XCircle, AlertTriangle, Play, Plug, Info } from 'lucide-react';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { Skeleton } from '@/components/ui/skeleton';
import { getApiBaseUrl } from '@/config/brands';

interface TableStatus {
  name: string;
  sourceCount: number;
  status: 'pending' | 'copying' | 'done' | 'error' | 'skipped';
  copiedCount?: number;
  error?: string;
}

interface CopyProgress {
  type: 'start' | 'table_start' | 'table_done' | 'table_error' | 'done' | 'error';
  table?: string;
  count?: number;
  total?: number;
  current?: number;
  message?: string;
}

export default function DatabaseCopyPage() {
  const [sourceUrl, setSourceUrl] = useState('');
  const [sourceKey, setSourceKey] = useState('');
  const [testing, setTesting] = useState(false);
  const [connected, setConnected] = useState(false);
  const [tables, setTables] = useState<TableStatus[]>([]);
  const [selectedTables, setSelectedTables] = useState<Set<string>>(new Set());
  const [copying, setCopying] = useState(false);
  const [copyComplete, setCopyComplete] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const apiBaseUrl = getApiBaseUrl();

  const handleTestConnection = useCallback(async () => {
    if (!sourceUrl || !sourceKey) {
      toast.error('Please enter both the source URL and service role key');
      return;
    }

    setTesting(true);
    setConnected(false);
    setTables([]);
    setCopyComplete(false);

    try {
      const res = await fetch(`${apiBaseUrl}/api/db-copy/test-connection`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceUrl, sourceServiceRoleKey: sourceKey }),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data.error || 'Connection failed');
        return;
      }

      const tableCounts: Record<string, number> = data.tableCounts;
      const tableList: TableStatus[] = Object.entries(tableCounts)
        .map(([name, sourceCount]) => ({
          name,
          sourceCount,
          status: 'pending' as const,
        }));

      setTables(tableList);
      setSelectedTables(new Set(tableList.filter((t) => t.sourceCount > 0).map((t) => t.name)));
      setConnected(true);
      toast.success('Connected to source database');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to connect');
    } finally {
      setTesting(false);
    }
  }, [sourceUrl, sourceKey, apiBaseUrl]);

  const toggleTable = (name: string) => {
    setSelectedTables((prev) => {
      const next = new Set(prev);
      if (next.has(name)) {
        next.delete(name);
      } else {
        next.add(name);
      }
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedTables.size === tables.length) {
      setSelectedTables(new Set());
    } else {
      setSelectedTables(new Set(tables.map((t) => t.name)));
    }
  };

  const handleStartCopy = useCallback(async () => {
    if (selectedTables.size === 0) {
      toast.error('Please select at least one table');
      return;
    }

    setCopying(true);
    setCopyComplete(false);

    // Reset table statuses
    setTables((prev) =>
      prev.map((t) => ({
        ...t,
        status: selectedTables.has(t.name) ? 'pending' as const : 'skipped' as const,
        copiedCount: undefined,
        error: undefined,
      }))
    );

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(`${apiBaseUrl}/api/db-copy/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceUrl,
          sourceServiceRoleKey: sourceKey,
          tables: Array.from(selectedTables),
        }),
        signal: controller.signal,
      });

      const reader = res.body?.getReader();
      if (!reader) throw new Error('No response body');

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          try {
            const event: CopyProgress = JSON.parse(line.slice(6));

            switch (event.type) {
              case 'table_start':
                setTables((prev) =>
                  prev.map((t) =>
                    t.name === event.table ? { ...t, status: 'copying' } : t
                  )
                );
                break;

              case 'table_done':
                setTables((prev) =>
                  prev.map((t) =>
                    t.name === event.table
                      ? { ...t, status: 'done', copiedCount: event.count }
                      : t
                  )
                );
                break;

              case 'table_error':
                setTables((prev) =>
                  prev.map((t) =>
                    t.name === event.table
                      ? { ...t, status: 'error', error: event.message }
                      : t
                  )
                );
                break;

              case 'done':
                setCopyComplete(true);
                toast.success(event.message || 'Database copy complete');
                break;

              case 'error':
                toast.error(event.message || 'Copy failed');
                break;
            }
          } catch {
            // Skip malformed SSE lines
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        toast.error(err instanceof Error ? err.message : 'Copy failed');
      }
    } finally {
      setCopying(false);
      abortRef.current = null;
    }
  }, [selectedTables, sourceUrl, sourceKey, apiBaseUrl]);

  const handleCancel = () => {
    abortRef.current?.abort();
    setCopying(false);
    toast.info('Copy cancelled');
  };

  const completedCount = tables.filter((t) => t.status === 'done').length;
  const errorCount = tables.filter((t) => t.status === 'error').length;
  const totalSelected = selectedTables.size;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Database Copy</h1>
        <p className="text-muted-foreground">
          Copy data from a remote Supabase instance to your local development database.
        </p>
      </div>

      {/* Warning */}
      <Card className="border-amber-200 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30">
        <CardContent className="flex items-start gap-3 pt-6">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
          <div className="text-sm text-amber-800 dark:text-amber-200">
            <p className="font-medium">This will overwrite local data</p>
            <p className="mt-1">
              Selected tables in your local database will be cleared and replaced with data from the
              source. This is intended for development use only. Schema is not copied &mdash; only
              table content.
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Connection */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Plug className="h-5 w-5" />
            Source Connection
          </CardTitle>
          <CardDescription>
            Enter the Supabase URL and service role key for the source database you want to copy from.
            This can be a Supabase Cloud project or a self-hosted Supabase instance.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="source-url">Supabase URL</Label>
            <Input
              id="source-url"
              placeholder="https://your-project.supabase.co"
              value={sourceUrl}
              onChange={(e) => {
                setSourceUrl(e.target.value);
                setConnected(false);
              }}
              disabled={copying}
            />
            <p className="text-xs text-muted-foreground">
              The URL of your Supabase project (e.g. https://xyzcompany.supabase.co or https://supabase.yourserver.com)
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="source-key">Service Role Key</Label>
            <Input
              id="source-key"
              type="password"
              placeholder="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..."
              value={sourceKey}
              onChange={(e) => {
                setSourceKey(e.target.value);
                setConnected(false);
              }}
              disabled={copying}
            />
            <p className="text-xs text-muted-foreground">
              The service_role key (not the anon key). Found in your Supabase project settings under API keys.
              This key bypasses Row Level Security to read all data.
            </p>
          </div>

          <Button onClick={handleTestConnection} disabled={testing || copying || !sourceUrl || !sourceKey}>
            {testing ? (
              <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Testing...</>
            ) : connected ? (
              <><CheckCircle2 className="mr-2 h-4 w-4" /> Connected</>
            ) : (
              <><Plug className="mr-2 h-4 w-4" /> Test Connection</>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Table Selection & Progress */}
      {connected && tables.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="h-5 w-5" />
              Tables
            </CardTitle>
            <CardDescription>
              Select which tables to copy. Tables with 0 rows in the source are unchecked by default.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Select all / summary */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Button variant="outline" size="sm" onClick={toggleAll} disabled={copying}>
                  {selectedTables.size === tables.length ? 'Deselect All' : 'Select All'}
                </Button>
                <span className="text-sm text-muted-foreground">
                  {totalSelected} of {tables.length} tables selected
                </span>
              </div>
              {copyComplete && (
                <div className="flex items-center gap-2 text-sm">
                  <CheckCircle2 className="h-4 w-4 text-green-600" />
                  <span className="text-green-700 dark:text-green-400">
                    {completedCount} copied
                  </span>
                  {errorCount > 0 && (
                    <>
                      <XCircle className="h-4 w-4 text-red-500" />
                      <span className="text-red-600 dark:text-red-400">{errorCount} failed</span>
                    </>
                  )}
                </div>
              )}
            </div>

            <Separator />

            {/* Table list */}
            <div className="space-y-1">
              {tables.map((table) => (
                <div
                  key={table.name}
                  className={`flex items-center justify-between rounded-md px-3 py-2 text-sm transition-colors ${
                    table.status === 'copying'
                      ? 'bg-blue-50 dark:bg-blue-950/30'
                      : table.status === 'done'
                        ? 'bg-green-50 dark:bg-green-950/20'
                        : table.status === 'error'
                          ? 'bg-red-50 dark:bg-red-950/20'
                          : 'hover:bg-muted/50'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      checked={selectedTables.has(table.name)}
                      onChange={() => toggleTable(table.name)}
                      disabled={copying}
                      className="h-4 w-4 rounded border-gray-300"
                    />
                    <span className="font-mono text-sm">{table.name}</span>
                    <Badge variant="outline" className="text-xs font-normal">
                      {table.sourceCount >= 0 ? `${table.sourceCount} rows` : 'unknown'}
                    </Badge>
                  </div>

                  <div className="flex items-center gap-2">
                    {table.status === 'copying' && (
                      <div className="flex items-center gap-1.5 text-blue-600 dark:text-blue-400">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        <span className="text-xs">Copying...</span>
                      </div>
                    )}
                    {table.status === 'done' && (
                      <div className="flex items-center gap-1.5 text-green-600 dark:text-green-400">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        <span className="text-xs">
                          {table.copiedCount !== undefined ? `${table.copiedCount} rows` : 'Done'}
                        </span>
                      </div>
                    )}
                    {table.status === 'error' && (
                      <div className="flex items-center gap-1.5 text-red-600 dark:text-red-400" title={table.error}>
                        <XCircle className="h-3.5 w-3.5" />
                        <span className="text-xs max-w-[200px] truncate">{table.error || 'Failed'}</span>
                      </div>
                    )}
                    {table.status === 'skipped' && (
                      <span className="text-xs text-muted-foreground">Skipped</span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <Separator />

            {/* Progress bar when copying */}
            {copying && (
              <div className="space-y-2">
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary transition-all duration-300"
                    style={{
                      width: `${totalSelected > 0 ? ((completedCount + errorCount) / totalSelected) * 100 : 0}%`,
                    }}
                  />
                </div>
                <p className="text-xs text-muted-foreground text-center">
                  {completedCount + errorCount} of {totalSelected} tables processed
                </p>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center gap-3">
              {!copying ? (
                <Button onClick={handleStartCopy} disabled={selectedTables.size === 0}>
                  <Play className="mr-2 h-4 w-4" />
                  {copyComplete ? 'Copy Again' : 'Start Copy'}
                </Button>
              ) : (
                <Button variant="destructive" onClick={handleCancel}>
                  Cancel
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Help */}
      <Card>
        <CardContent className="flex items-start gap-3 pt-6">
          <Info className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
          <div className="text-sm text-muted-foreground space-y-2">
            <p className="font-medium text-foreground">How it works</p>
            <ul className="list-disc pl-4 space-y-1">
              <li>Connects to the source Supabase using the service role key (bypasses RLS)</li>
              <li>For each selected table, reads all rows from the source</li>
              <li>Clears the corresponding local table, then inserts the source data</li>
              <li>Tables are processed in order to respect foreign key constraints</li>
              <li>Only table content is copied &mdash; schema, functions, and policies are not affected</li>
              <li>Auth users are not copied &mdash; you'll need to create local admin accounts separately</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
