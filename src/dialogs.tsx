import type { RefObject } from "react";

// A tap on the dimmed area closes a dialog with nothing changed. Content sits in an inner box, so only the backdrop matches.
export const closeOnBackdrop = (e: React.MouseEvent<HTMLDialogElement>) => e.target === e.currentTarget && e.currentTarget.close();

// One text field with Cancel and a confirm button: renaming, and asking for the next action before a start.
export function TextDialog({ dialog, label, value = "", placeholder, confirm = "Save", onSave }: { dialog: RefObject<HTMLDialogElement | null>; label: string; value?: string; placeholder?: string; confirm?: string; onSave: (title: string) => void }) {
  return (
    <dialog ref={dialog} className="prompt" aria-label={label} onClick={closeOnBackdrop}>
      <form method="dialog" className="capture-form prompt-body" onSubmit={(e) => onSave(new FormData(e.currentTarget).get("title") as string)}>
        <label className="capture-form">
          <span className="prompt-title">{label}</span>
          <input name="title" className="field" defaultValue={value} key={value} placeholder={placeholder} autoComplete="off" />
        </label>
        <div className="actions prompt-actions">
          <button type="button" className="button" onClick={() => dialog.current!.close()}>
            Cancel
          </button>
          <button className="button primary">{confirm}</button>
        </div>
      </form>
    </dialog>
  );
}

// Focus lands on the first button, the choice that changes nothing (Wireframes.md §6).
export function ConfirmDialog({ dialog, question, keep, confirm, onConfirm }: { dialog: RefObject<HTMLDialogElement | null>; question: string; keep: string; confirm: string; onConfirm: () => void }) {
  return (
    <dialog ref={dialog} className="prompt" role="alertdialog" aria-label={question} onClick={closeOnBackdrop}>
      <div className="prompt-body">
        <p className="prompt-title">{question}</p>
        <div className="actions prompt-actions">
          <button className="button" onClick={() => dialog.current!.close()}>
            {keep}
          </button>
          <button
            className="button primary"
            onClick={() => {
              dialog.current!.close();
              onConfirm();
            }}
          >
            {confirm}
          </button>
        </div>
      </div>
    </dialog>
  );
}
