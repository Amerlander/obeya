// A button that copies a text says so for a moment after.

import { useState } from 'react';

/** Whether the text was just copied, and `copy`, which copies it and says so for `ms`. */
export function useCopy(ms: number): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false);
  const copy = (text: string) =>
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), ms);
    }, console.error);
  return [copied, copy];
}
