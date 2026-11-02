import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { setHostLoadingIndicator } from '@/embed/hostLoadingIndicator';

import { PageLoadingSpinner } from '../PageLoadingSpinner';

function hostSpinner(): HTMLElement {
  const i = document.createElement('i');
  i.className = 'fa-light fa-spinner-third fa-spin text-2xl text-gray-400';
  i.setAttribute('aria-hidden', 'true');
  return i;
}

afterEach(() => {
  setHostLoadingIndicator(null);
  vi.restoreAllMocks();
});

describe('PageLoadingSpinner', () => {
  it('draws the list pages\' ring in a py-16 centred status region with a hidden label', () => {
    const { container } = render(<PageLoadingSpinner />);
    const status = screen.getByRole('status');
    expect(status).toHaveClass('flex', 'justify-center', 'py-16');
    expect(status).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByText('Loading')).toHaveClass('sr-only');
    const ring = container.querySelector('.animate-spin');
    expect(ring).toHaveClass('rounded-full', 'h-8', 'w-8', 'border-b-2', 'border-[var(--accent-9)]');
    expect(ring).toHaveAttribute('aria-hidden', 'true');
  });

  it('lets a page replace the padding', () => {
    render(<PageLoadingSpinner className="py-4" />);
    expect(screen.getByRole('status')).toHaveClass('py-4');
    expect(screen.getByRole('status')).not.toHaveClass('py-16');
  });

  it('mounts a fresh host element in place of the ring when the host gave a loadingIndicator', () => {
    const factory = vi.fn(hostSpinner);
    setHostLoadingIndicator(factory);
    const first = render(<PageLoadingSpinner />);
    const second = render(<PageLoadingSpinner />);

    const icons = document.querySelectorAll('i.fa-spinner-third');
    expect(icons).toHaveLength(2);
    expect(icons[0]).not.toBe(icons[1]);
    expect(factory).toHaveBeenCalledTimes(2);
    expect(document.querySelector('.animate-spin')).toBeNull();
    // Same centred box as the ring; the label still comes from the embed.
    const status = first.getAllByRole('status')[0];
    expect(status).toHaveClass('flex', 'justify-center', 'py-16');
    expect(status.querySelector('span[aria-hidden="true"]')).toHaveClass('h-8');
    expect(status).toHaveTextContent('Loading');

    first.unmount();
    second.unmount();
    expect(document.querySelectorAll('i.fa-spinner-third')).toHaveLength(0);
  });

  it.each([
    ['throws', () => { throw new Error('host bug'); }],
    ['returns something other than an element', () => 'nope' as unknown as HTMLElement],
  ])('falls back to the ring when the factory %s', (_label, factory) => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    setHostLoadingIndicator(factory);
    const { container } = render(<PageLoadingSpinner />);
    expect(container.querySelector('.animate-spin')).not.toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
  });

  it('ignores a loadingIndicator that is not a function', () => {
    setHostLoadingIndicator('nope' as unknown as () => HTMLElement);
    const { container } = render(<PageLoadingSpinner />);
    expect(container.querySelector('.animate-spin')).not.toBeNull();
  });
});
