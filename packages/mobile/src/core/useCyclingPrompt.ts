/**
 * The composer's placeholder, when there is more than one thing to say.
 *
 * A static "Ask me anything..." tells a member the field exists but not what
 * it is for. Showing the coach's own openers, one at a time, shows them what
 * they can actually ask, which is the difference between an empty box and a
 * prompt.
 *
 * Each one types on, holds long enough to read, deletes faster than it typed,
 * and the next follows. Deleting runs at about half the typing speed because
 * nobody needs to read a sentence on its way out, and a slow delete is the
 * part that starts to feel like waiting.
 *
 * ── WHY THIS IS A HOOK AND NOT A COMPONENT ────────────────────────────────
 *
 * It was a component that drew the text over the field, on the grounds that
 * TextInput's `placeholder` cannot be animated. That was true of the earlier
 * cross-fade and irrelevant here: a typewriter only changes a string, and a
 * string is exactly what `placeholder` takes.
 *
 * Overlaying cost an alignment that could never quite be right. The overlay
 * repeated the field's padding, but a multiline TextInput on iOS adds its own
 * text container inset on top of that, so the suggestion sat a couple of
 * points above the line its words would occupy and visibly dropped the moment
 * it was adopted. Handing the string to the field removes the question: the
 * placeholder is drawn by the same view, in the same font, on the same line
 * as the text that replaces it.
 */

import { useEffect, useState } from 'react';

/** Per keystroke, going on and coming off. */
const TYPE_MS = 42;
const DELETE_MS = 22;
/** How long a finished prompt stands before it is taken away. */
const HOLD_MS = 2200;
/** A beat on the empty field, so two prompts do not run together. */
const GAP_MS = 420;

export interface CyclingPrompt {
  /** However much of the current prompt has been typed. For the field. */
  text: string;
  /** The whole prompt. What adopting it takes, mid-keystroke or not. */
  full: string;
  /** True only while a finished sentence is standing. */
  complete: boolean;
}

export function useCyclingPrompt(prompts: string[]): CyclingPrompt {
  const [index, setIndex] = useState(0);
  const [shown, setShown] = useState('');

  const full = prompts.length ? prompts[index % prompts.length] : '';

  useEffect(() => {
    if (!full) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    let count = 0;
    let phase: 'typing' | 'holding' | 'deleting' = 'typing';

    const tick = () => {
      if (!alive) return;
      if (phase === 'typing') {
        count += 1;
        setShown(full.slice(0, count));
        if (count < full.length) {
          timer = setTimeout(tick, TYPE_MS);
        } else {
          phase = 'holding';
          timer = setTimeout(tick, HOLD_MS);
        }
        return;
      }
      if (phase === 'holding') {
        // One prompt and nothing to move on to: leave it standing rather than
        // erase it to type the same words again.
        if (prompts.length < 2) return;
        phase = 'deleting';
        timer = setTimeout(tick, DELETE_MS);
        return;
      }
      count -= 1;
      setShown(full.slice(0, Math.max(0, count)));
      if (count > 0) {
        timer = setTimeout(tick, DELETE_MS);
      } else {
        // Advancing re-runs this effect against the next prompt.
        timer = setTimeout(() => {
          if (alive) setIndex((n) => n + 1);
        }, GAP_MS);
      }
    };

    timer = setTimeout(tick, TYPE_MS);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [full, prompts.length]);

  return { text: shown, full, complete: shown.length > 0 && shown.length === full.length };
}
