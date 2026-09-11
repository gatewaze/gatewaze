/**
 * The composer as it appears on every destination that is not the coach.
 *
 * The member asked to be able to talk to the coach from anywhere, so the
 * field and the mode track are present at the bottom of every screen. What
 * this bar does NOT do is own a conversation: it collects a message or a
 * mode choice and hands both to the coach, which is where the thread, the
 * send queue and the mode surfaces already live. Pressing send moves to the
 * coach and the message goes out there, so there is one thread and one place
 * a reply can arrive.
 *
 * It looks like the composer on the coach because it IS the composer on the
 * coach. Everything below is the handover.
 */

import React, { useState } from 'react';
import { Composer } from './Composer';
import { requestCoachHandoff } from './coachHandoff';

export function CoachBar({
  enabled,
  onHandoff,
  onHeight,
}: {
  /** Which modules the member is entitled to, for the mode track. */
  enabled: Record<string, boolean>;
  /** Move to the coach. Called after the handover has been left. */
  onHandoff: () => void;
  /** Measured height, so the destination underneath can clear it. */
  onHeight?: (h: number) => void;
}) {
  const [draft, setDraft] = useState('');

  /**
   * Leave the handover and move. A mode pill is a request to go to the coach
   * whether or not anything has been typed; the send button needs text, which
   * the composer enforces by disabling itself.
   */
  const hand = (mode: string | null) => {
    requestCoachHandoff({ text: draft.trim(), mode });
    setDraft('');
    onHandoff();
  };

  return (
    <Composer
      enabled={enabled}
      draft={draft}
      onChangeDraft={setDraft}
      // No mode surface opens here, so nothing is ever the active one. Chat
      // is what this bar does, and showing it selected says so.
      activeMode={null}
      onSelectMode={(key) => hand(key)}
      onSend={() => hand(null)}
      onHeight={onHeight}
    />
  );
}
