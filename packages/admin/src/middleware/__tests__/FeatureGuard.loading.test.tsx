import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { setHostLoadingIndicator } from '@/embed/hostLoadingIndicator';

// What FeatureGuard shows while auth or the permission check is still loading.
let embedded = false;
let authLoading = true;
let permissionLoading = false;

vi.mock('@/embed/embedMode', () => ({ isEmbedded: () => embedded }));
vi.mock('@/app/contexts/auth/context', () => ({
  useAuthContext: () => ({ user: authLoading ? null : { id: 'p1', role: 'admin' }, isLoading: authLoading }),
}));
vi.mock('@/hooks/usePermissions', () => ({
  useHasPermission: () => ({ hasPermission: true, loading: permissionLoading }),
}));

const { FeatureGuard } = await import('../FeatureGuard');

function renderGuard(props: { showLoading?: boolean } = {}) {
  return render(
    <MemoryRouter>
      <FeatureGuard feature="newsletters" {...props}>
        <div>PAGE</div>
      </FeatureGuard>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  embedded = false;
  authLoading = true;
  permissionLoading = false;
  setHostLoadingIndicator(null);
});

describe('FeatureGuard loading state', () => {
  it('embedded, auth loading: the page spinner, never a blank pane', () => {
    embedded = true;
    const { container } = renderGuard();
    expect(screen.getByRole('status')).toHaveClass('py-16');
    expect(container.querySelector('.animate-spin.h-8.w-8')).not.toBeNull();
    expect(screen.queryByText('Checking permissions...')).not.toBeInTheDocument();
    expect(screen.queryByText('PAGE')).not.toBeInTheDocument();
  });

  it('embedded, permission check loading: the page spinner', () => {
    embedded = true;
    authLoading = false;
    permissionLoading = true;
    renderGuard();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByText('PAGE')).not.toBeInTheDocument();
  });

  it('embedded with a host loadingIndicator: the host spinner', () => {
    embedded = true;
    setHostLoadingIndicator(() => {
      const i = document.createElement('i');
      i.className = 'fa-spinner-third';
      return i;
    });
    const { container } = renderGuard();
    expect(screen.getByRole('status').querySelector('i.fa-spinner-third')).not.toBeNull();
    expect(container.querySelector('.animate-spin')).toBeNull();
  });

  it('standalone: the full-screen "Checking permissions" loader, unchanged', () => {
    renderGuard();
    expect(screen.getByText('Checking permissions...')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('showLoading={false} still renders nothing, embedded or not', () => {
    embedded = true;
    const { container } = renderGuard({ showLoading: false });
    expect(container).toBeEmptyDOMElement();
  });

  it('renders the page once loading is done', () => {
    embedded = true;
    authLoading = false;
    renderGuard();
    expect(screen.getByText('PAGE')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
