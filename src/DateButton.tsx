import { useEffect, useRef, useState, type ReactNode, type Ref } from "react";

interface Props {
  label: string; // the date field's name, used when it has to be shown
  className: string; // the button's: "chip" or "button"
  pressed?: boolean;
  value?: string; // "" when no date; leave out for a field that holds nothing
  min: string;
  onPick: (date: string) => void; // "" when the date is cleared
  children: ReactNode;
  ref?: Ref<HTMLButtonElement>;
}

// A button that opens the browser's date picker. A tap or click lands on the real date field, laid transparent over the
// button, so phones open their native picker without showPicker(): iOS WebViews can accept that call and show nothing,
// leaving no error to fall back on. The button is the keyboard and screen-reader path; where showPicker() is missing or
// refuses there, the date field itself is shown and focused instead: a visible, labelled input rather than a hidden one.
export function DateButton({ label, className, pressed, value, min, onPick, children, ref }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [manual, setManual] = useState(false);
  useEffect(() => {
    if (manual) input.current?.focus();
  }, [manual]);
  const typing = useTyping();

  return (
    <span className="date-button">
      <button
        ref={ref}
        type="button"
        className={className}
        aria-pressed={pressed}
        onClick={() => {
          if (typing) return (document.activeElement as HTMLElement).blur(); // the first tap only puts the keyboard away
          try {
            input.current!.showPicker();
          } catch {
            setManual(true);
          }
        }}
      >
        {children}
      </button>
      <input
        ref={input}
        type="date"
        className={manual ? "field" : typing ? "date-input waiting" : "date-input"}
        tabIndex={manual ? undefined : -1}
        aria-hidden={manual ? undefined : true}
        aria-label={label}
        min={min}
        value={value}
        onClick={(e) => {
          try {
            e.currentTarget.showPicker(); // desktop Chrome opens only from its icon otherwise
          } catch {
            // the tap already reached the native field
          }
        }}
        onChange={(e) => onPick(e.target.value)}
        onBlur={() => setManual(false)}
      />
    </span>
  );
}

// On a touch screen with the keyboard up (Natalie, 2026-10-07): one tap moved focus from the text field straight to the
// date field, so iOS dropped the keyboard, slid the sheet down and opened its calendar mid-slide. Now the first tap only
// puts the keyboard away and the second opens the calendar in place. A delayed showPicker() can't stand in for the
// second tap: iOS opens its picker only from a tap.
function useTyping() {
  const [typing, setTyping] = useState(false);
  useEffect(() => {
    const coarse = matchMedia("(pointer: coarse)");
    const check = () => setTyping(coarse.matches && !!document.activeElement?.matches("textarea, input:not([type]), input[type=text], input[type=search]"));
    document.addEventListener("focusin", check);
    document.addEventListener("focusout", check);
    check();
    return () => {
      document.removeEventListener("focusin", check);
      document.removeEventListener("focusout", check);
    };
  }, []);
  return typing;
}
