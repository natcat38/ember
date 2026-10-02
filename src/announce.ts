import { createContext, useContext, useEffect } from "react";

// App's one polite live region (Design_Direction.md §6). A status that mounts together with its text is often skipped
// by screen readers, so screens say theirs through here and show the text as plain text.
export const AnnounceContext = createContext<(text: string) => void>(() => {});

// Say `text` whenever it changes to something non-empty.
export function useAnnounce(text: string | null | undefined) {
  const announce = useContext(AnnounceContext);
  useEffect(() => {
    if (text) announce(text);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- announce once per new text, not per render
  }, [text]);
}
