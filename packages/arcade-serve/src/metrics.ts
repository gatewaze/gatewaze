// Minimal in-process counters exposed on /metrics in Prometheus text format.
// Cluster-internal only — the ingress must not publish this path (spec §13).

export class Metrics {
  private readonly requests = new Map<string, number>();
  private readonly counters = new Map<string, number>();
  private readonly startedAt = Date.now();

  request(route: string, status: number): void {
    const key = `${route}|${status}`;
    this.requests.set(key, (this.requests.get(key) ?? 0) + 1);
  }

  incr(name: string, by = 1): void {
    this.counters.set(name, (this.counters.get(name) ?? 0) + by);
  }

  render(): string {
    const lines: string[] = [
      '# HELP arcade_serve_requests_total Requests handled, by route and status.',
      '# TYPE arcade_serve_requests_total counter',
    ];
    for (const [key, value] of [...this.requests.entries()].sort()) {
      const [route, status] = key.split('|');
      lines.push(`arcade_serve_requests_total{route="${route}",status="${status}"} ${value}`);
    }
    lines.push('# HELP arcade_serve_events_total Internal event counters.');
    lines.push('# TYPE arcade_serve_events_total counter');
    for (const [name, value] of [...this.counters.entries()].sort()) {
      lines.push(`arcade_serve_events_total{event="${name}"} ${value}`);
    }
    lines.push('# HELP arcade_serve_uptime_seconds Seconds since process start.');
    lines.push('# TYPE arcade_serve_uptime_seconds gauge');
    lines.push(`arcade_serve_uptime_seconds ${Math.floor((Date.now() - this.startedAt) / 1000)}`);
    return `${lines.join('\n')}\n`;
  }
}
