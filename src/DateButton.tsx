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

  return (
    <span className="date-button">
      <button
        ref={ref}
        type="button"
        className={className}
        aria-pressed={pressed}
        onClick={() => {
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
        className={manual ? "field" : "date-input"}
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
