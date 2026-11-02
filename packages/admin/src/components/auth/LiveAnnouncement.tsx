import { useEffect, useState } from 'react';

/**
 * A polite live region for status changes. Screen readers only announce
 * changes to a region that already exists, so it mounts empty and the
 * message is set after mount (and on every change after that).
 */
export function LiveAnnouncement({ message }: { message: string }) {
  const [text, setText] = useState('');
  useEffect(() => {
    setText(message);
  }, [message]);
  return (
    <p role="status" aria-live="polite" className="sr-only">
      {text}
    </p>
  );
}
