import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { setHostLoadingIndicator } from '@/embed/hostLoadingIndicator';

vi.mock('../../../config/brands', () => ({ getBrandConfig: () => ({ ui: {} }) }));

const { default: LoadingSpinner } = await import('../LoadingSpinner');

const hostSpinner = () => {
  const i = document.createElement('i');
  i.className = 'fa-spinner-third';
  return i;
};

afterEach(() => setHostLoadingIndicator(null));

describe('LoadingSpinner with a host loadingIndicator', () => {
  it('draws its own loader when there is no host spinner (standalone), unchanged', () => {
    const { container } = render(<LoadingSpinner size="small" />);
    expect(container.firstElementChild).toHaveClass('loader', 'loader-small');
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it.each(['small', 'medium', 'large'] as const)('shows the host spinner at size %s, in the loader\'s box', (size) => {
    setHostLoadingIndicator(hostSpinner);
    const { container } = render(<LoadingSpinner size={size} />);
    const status = screen.getByRole('status');
    expect(status).toHaveClass('gw-loader-host', `loader-${size}`);
    expect(status.querySelector('i.fa-spinner-third')).not.toBeNull();
    expect(status).toHaveTextContent('Loading');
    expect(container.querySelector('.loader')).toBeNull();
  });

  it.each(['xs', 'sm'] as const)('keeps its own loader at the inline size %s', (size) => {
    setHostLoadingIndicator(hostSpinner);
    const { container } = render(<LoadingSpinner size={size} />);
    expect(container.firstElementChild).toHaveClass('loader', `loader-${size}`);
    expect(container.querySelector('i.fa-spinner-third')).toBeNull();
  });

  it('falls back to its own loader when the host factory throws', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    setHostLoadingIndicator(() => {
      throw new Error('host bug');
    });
    const { container } = render(<LoadingSpinner />);
    expect(container.querySelector('.loader.loader-medium')).not.toBeNull();
  });
});
