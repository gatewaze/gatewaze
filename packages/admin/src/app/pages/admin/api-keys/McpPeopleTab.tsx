import { useState } from 'react';
import { Link } from 'react-router';
import { UserCircleIcon, XMarkIcon } from '@heroicons/react/24/outline';
import { Button, Card } from '@/components/ui';
import { PersonSearchInput, type PersonSearchResult } from '@/components/mcp/PersonSearchInput';
import { PersonMcpAccessPanel } from '@/components/mcp/PersonMcpAccessPanel';

export function McpPeopleTab() {
  const [person, setPerson] = useState<PersonSearchResult | null>(null);

  return (
    <div className="space-y-4">
      <p className="text-sm text-[var(--gray-11)] max-w-2xl">
        Look up a person to see their effective MCP scopes (and where each one comes from), edit
        their personal grants, and manage their sessions. Access can be configured before their
        first MCP connection.
      </p>

      <Card className="p-4">
        <PersonSearchInput onSelect={setPerson} autoFocus placeholder="Search people by email…" />
      </Card>

      {person ? (
        <div className="space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <UserCircleIcon className="size-8 text-[var(--gray-a9)] shrink-0" />
            <div className="flex-1 min-w-0">
              <Link
                to={`/people/${person.id}/mcp`}
                className="text-sm font-semibold text-[var(--gray-12)] hover:underline"
                title="Open person page"
              >
                {person.name}
              </Link>
              <p className="text-xs text-[var(--gray-11)] truncate">{person.email}</p>
            </div>
            <Button variant="ghost" size="1" onClick={() => setPerson(null)} className="gap-1">
              <XMarkIcon className="size-4" />
              Clear
            </Button>
          </div>

          <PersonMcpAccessPanel
            personId={person.id}
            personLabel={person.email}
            activityTo={`/admin/api-keys?tab=activity&person_id=${person.id}`}
          />
        </div>
      ) : (
        <p className="text-sm text-[var(--gray-10)] italic">
          Search for a person above to view and manage their MCP access.
        </p>
      )}
    </div>
  );
}
