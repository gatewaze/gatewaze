import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { RepliesWorkspace, type WorkspaceReply } from '../RepliesWorkspace';

const updateMock = vi.fn();

vi.mock('@/lib/supabase', () => ({
  supabase: {
    from: () => ({
      update: (fields: Record<string, unknown>) => ({
        eq: (_col: string, id: string) => updateMock(fields, id),
      }),
    }),
  },
}));

function makeReply(overrides: Partial<WorkspaceReply> = {}): WorkspaceReply {
  return {
    id: 'reply-1',
    from_email: 'person@example.com',
    from_name: 'Person Example',
    subject: 'Re: newsletter',
    body_text: 'hello',
    body_html: null,
    is_read: false,
    is_starred: false,
    is_archived: false,
    is_auto_reply: false,
    auto_reply_reason: null,
    forwarded_to: null,
    forwarded_at: null,
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

function renderWorkspace(replies: WorkspaceReply[]) {
  return render(
    <MemoryRouter>
      <RepliesWorkspace
        kind="newsletter"
        replies={replies}
        sent={[]}
        personByEmail={{}}
        onReload={() => {}}
      />
    </MemoryRouter>,
  );
}

describe('RepliesWorkspace', () => {
  beforeEach(() => {
    updateMock.mockReset();
  });

  it('rolls back the optimistic star toggle when the write is rejected', async () => {
    // Hold the write pending so the optimistic state is observable before it
    // resolves — mockResolvedValue settles immediately, which lets the
    // rollback run before the assertion below even sees the optimistic state.
    let resolveUpdate: (value: { error: { message: string } | null }) => void;
    updateMock.mockReturnValue(new Promise((resolve) => { resolveUpdate = resolve; }));
    renderWorkspace([makeReply()]);

    const starButton = screen.getByTitle('Star');
    await userEvent.click(starButton);

    // Optimistic update applies immediately, before the write resolves.
    expect(screen.queryByTitle('Unstar')).not.toBeNull();

    resolveUpdate!({ error: { message: 'permission denied for table newsletter_replies' } });

    // Once the rejected write resolves, the override is rolled back.
    await waitFor(() => expect(screen.queryByTitle('Star')).not.toBeNull());
    expect(updateMock).toHaveBeenCalledWith({ is_starred: true }, 'reply-1');
  });

  it('keeps the optimistic star toggle when the write succeeds', async () => {
    updateMock.mockResolvedValue({ error: null });
    renderWorkspace([makeReply()]);

    const starButton = screen.getByTitle('Star');
    await userEvent.click(starButton);

    expect(screen.queryByTitle('Unstar')).not.toBeNull();
    await waitFor(() => expect(updateMock).toHaveBeenCalled());
    expect(screen.queryByTitle('Unstar')).not.toBeNull();
  });
});
