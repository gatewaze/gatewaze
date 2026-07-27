import { useState } from 'react';
import { MagnifyingGlassIcon } from '@heroicons/react/24/outline';
import { toast } from 'sonner';
import { Button, Input } from '@/components/ui';
import { supabase } from '@/lib/supabase';

export interface PersonSearchResult {
  id: string;
  email: string;
  name: string;
  company?: string;
  jobTitle?: string;
}

interface PersonRow {
  id: string;
  email: string;
  attributes: {
    first_name?: string;
    last_name?: string;
    company?: string;
    job_title?: string;
  } | null;
}

interface PersonSearchInputProps {
  onSelect: (person: PersonSearchResult) => void;
  placeholder?: string;
  autoFocus?: boolean;
  disabled?: boolean;
}

/**
 * Email-based people search — same approach as events/AddPersonModal
 * (ilike on people.email via Supabase), but decoupled from event
 * registration so it can drive MCP group membership and the People tab.
 */
export function PersonSearchInput({
  onSelect,
  placeholder = 'Search people by email…',
  autoFocus,
  disabled,
}: PersonSearchInputProps) {
  const [query, setQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<PersonSearchResult[]>([]);
  const [searched, setSearched] = useState(false);

  const search = async () => {
    if (!query.trim()) {
      toast.error('Enter an email address to search');
      return;
    }
    setSearching(true);
    setResults([]);
    try {
      const { data, error } = await supabase
        .from('people')
        .select('id, email, attributes')
        .ilike('email', `%${query.trim()}%`)
        .limit(10);

      if (error) {
        console.error('Error searching people:', error);
        toast.error('Failed to search people');
        return;
      }

      const rows = (data ?? []) as PersonRow[];
      setResults(
        rows.map((row) => {
          const first = row.attributes?.first_name ?? '';
          const last = row.attributes?.last_name ?? '';
          return {
            id: row.id,
            email: row.email,
            name: `${first} ${last}`.trim() || row.email,
            company: row.attributes?.company,
            jobTitle: row.attributes?.job_title,
          };
        }),
      );
      setSearched(true);
    } catch (error) {
      console.error('Error searching people:', error);
      toast.error('Failed to search people');
    } finally {
      setSearching(false);
    }
  };

  const pick = (person: PersonSearchResult) => {
    onSelect(person);
    setResults([]);
    setSearched(false);
    setQuery('');
  };

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <div className="flex-1">
          <Input
            type="email"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                if (!searching) search();
              }
            }}
            placeholder={placeholder}
            autoFocus={autoFocus}
            disabled={disabled || searching}
          />
        </div>
        <Button
          variant="soft"
          type="button"
          onClick={search}
          disabled={disabled || searching || !query.trim()}
          className="flex items-center gap-2"
        >
          <MagnifyingGlassIcon className="size-4" />
          {searching ? 'Searching…' : 'Search'}
        </Button>
      </div>

      {results.length > 0 && (
        <div className="border border-[var(--gray-a6)] rounded-lg divide-y divide-[var(--gray-a4)] max-h-64 overflow-y-auto">
          {results.map((person) => (
            <button
              key={person.id}
              type="button"
              onClick={() => pick(person)}
              disabled={disabled}
              className="w-full text-left p-3 hover:bg-[var(--gray-a3)] transition-colors cursor-pointer"
            >
              <p className="text-sm font-medium text-[var(--gray-12)] truncate">{person.name}</p>
              <p className="text-xs text-[var(--gray-11)] truncate">{person.email}</p>
              {(person.jobTitle || person.company) && (
                <p className="text-xs text-[var(--gray-10)] truncate">
                  {[person.jobTitle, person.company].filter(Boolean).join(' • ')}
                </p>
              )}
            </button>
          ))}
        </div>
      )}

      {searched && results.length === 0 && !searching && (
        <p className="text-sm text-[var(--gray-11)]">No people found matching that email.</p>
      )}
    </div>
  );
}
