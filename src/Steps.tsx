import { useEffect, useRef, useState } from "react";
import { addChunk, childrenOf, deleteChunk, move, moveTo, renameChunk, setLeafStates, stateOf, tick, topLevel, type Chunk } from "../core/chunk";
import type { State } from "../core/task";
import { closeOnBackdrop, ConfirmDialog, TextDialog } from "./dialogs";
import { refocus } from "./refocus";

interface Props {
  state: State;
  update: (fn: (s: State) => State) => void;
  taskId: string;
  onStart: (chunkId: string) => void;
}

// UX_Flows.md §3.3 and Wireframes.md §6 (Steps).
export function Steps({ state, update, taskId, onStart }: Props) {
  const [addingTo, setAddingTo] = useState<string | null>(null); // the parent whose "Add a smaller step" field is open
  const [menuFor, setMenuFor] = useState<Chunk | null>(null);
  const [lastParentTick, setLastParentTick] = useState<{ id: string; ids: string[] } | null>(null);
  const menu = useRef<HTMLDialogElement>(null);
  const renameDialog = useRef<HTMLDialogElement>(null);
  const deleteDialog = useRef<HTMLDialogElement>(null);
  const startDrag = useDragReorder((id, index) => act((s) => moveTo(s, id, index, Date.now())));

  // Any other change closes the window in which unticking a parent restores its smaller steps (rule 2).
  function act(fn: (s: State) => State) {
    setLastParentTick(null);
    update(fn);
  }

  function onTick(c: Chunk, done: boolean) {
    const kids = childrenOf(state, c.id);
    if (kids.length && done) {
      setLastParentTick({ id: c.id, ids: kids.filter((k) => k.state !== "done").map((k) => k.id) });
      update((s) => tick(s, c.id, true, Date.now()));
    } else if (kids.length && lastParentTick?.id === c.id) {
      const ids = lastParentTick.ids;
      setLastParentTick(null);
      update((s) => setLeafStates(s, ids, "todo", Date.now()));
    } else {
      act((s) => tick(s, c.id, done, Date.now()));
    }
  }

  // The step goes: focus moves to the next step's checkbox, else the one above, else its parent's, else the heading.
  function deleteStep(c: Chunk) {
    const li = document.querySelector(`[data-step="${CSS.escape(c.id)}"]`)?.closest("li");
    const near = li?.nextElementSibling ?? li?.previousElementSibling ?? li?.parentElement?.closest("li");
    act((s) => deleteChunk(s, c.id, Date.now()));
    refocus(() => near?.querySelector<HTMLElement>("input[type=checkbox]") ?? document.getElementById("h-steps"));
  }

  function fromMenu(fn: () => void) {
    menu.current!.close();
    fn();
  }

  const row = (c: Chunk) => (
    <div data-step={c.id} className={`row step${stateOf(state, c) === "done" ? " done" : ""}`} onPointerDown={(e) => startDrag(e, c.id)}>
      <label className="check">
        <input type="checkbox" checked={stateOf(state, c) === "done"} aria-label={c.title} onChange={(e) => onTick(c, e.target.checked)} />
      </label>
      <span className="step-title">{c.title}</span>
      {/* Rule 3: no start button on a parent; Focus runs on one smaller step. */}
      {!childrenOf(state, c.id).length && c.state !== "done" && (
        <button className="icon-button" aria-label={`Start ${c.title}`} onClick={() => onStart(c.id)}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" aria-hidden="true">
          <path d="M8 5l11 7-11 7z" />
        </svg>
        </button>
      )}
      <button
        className="icon-button"
        aria-label={`More actions for ${c.title}`}
        onClick={() => {
          setMenuFor(c);
          menu.current!.showModal();
        }}
      >
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="5" cy="12" r="1.8" />
          <circle cx="12" cy="12" r="1.8" />
          <circle cx="19" cy="12" r="1.8" />
        </svg>
      </button>
    </div>
  );

  const top = topLevel(state, taskId);
  const menuKids = menuFor ? childrenOf(state, menuFor.id) : [];

  return (
    <section className="section" aria-labelledby="h-steps">
      <h2 id="h-steps" tabIndex={-1}>
        Steps
      </h2>
      {top.length > 0 && (
        <ul className="list">
          {top.map((c) => {
            const kids = childrenOf(state, c.id);
            return (
              <li key={c.id}>
                {row(c)}
                {(kids.length > 0 || addingTo === c.id) && (
                  <div className="substeps" role="group" aria-label={`Smaller steps of ${c.title}`}>
                    {kids.length > 0 && (
                      <ul className="list">
                        {kids.map((k) => (
                          <li key={k.id}>{row(k)}</li>
                        ))}
                      </ul>
                    )}
                    {addingTo === c.id && (
                      <AddField
                        label={`Add a smaller step to ${c.title}`}
                        placeholder="Add a smaller step"
                        button="Add smaller step"
                        autoFocus
                        onAdd={(title) => act((s) => addChunk(s, taskId, title, c.id, Date.now()))}
                        onBlurEmpty={() => setAddingTo(null)}
                      />
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <AddField
        label="What's the very next physical action?"
        visibleLabel
        placeholder="Type one step"
        button="Add step"
        onAdd={(title) => act((s) => addChunk(s, taskId, title, null, Date.now()))}
      />

      <dialog ref={menu} className="sheet" aria-label={menuFor ? `Actions for ${menuFor.title}` : "Step actions"} onClick={closeOnBackdrop}>
        {menuFor && (
          <div className="sheet-body menu-sheet">
            <p className="prompt-title">{menuFor.title}</p>
            {!menuKids.length && menuFor.state !== "done" && <button onClick={() => fromMenu(() => onStart(menuFor.id))}>Start this step</button>}
            {/* Rule 6: no third level, so a smaller step can't be broken down. A parent offers more smaller steps instead. */}
            {!menuFor.parent_id && (
              <button onClick={() => fromMenu(() => setAddingTo(menuFor.id))}>{menuKids.length ? "Add a smaller step" : "Break this step down"}</button>
            )}
            <button onClick={() => fromMenu(() => act((s) => move(s, menuFor.id, -1, Date.now())))}>Move up</button>
            <button onClick={() => fromMenu(() => act((s) => move(s, menuFor.id, 1, Date.now())))}>Move down</button>
            <button onClick={() => fromMenu(() => renameDialog.current!.showModal())}>Rename</button>
            <button
              onClick={() => fromMenu(() => (menuKids.length ? deleteDialog.current!.showModal() : deleteStep(menuFor)))}
            >
              Delete step
            </button>
            <button className="cancel" onClick={() => menu.current!.close()}>
              Cancel
            </button>
          </div>
        )}
      </dialog>
      <TextDialog dialog={renameDialog} label="Rename step" value={menuFor?.title ?? ""} onSave={(t) => menuFor && act((s) => renameChunk(s, menuFor.id, t, Date.now()))} />
      <ConfirmDialog
        dialog={deleteDialog}
        question={menuKids.length === 1 ? "Delete this step and its smaller step?" : `Delete this step and its ${menuKids.length} smaller steps?`}
        keep="Keep it"
        confirm="Delete"
        onConfirm={() => menuFor && deleteStep(menuFor)}
      />
    </section>
  );
}

// Enter or the round (+) adds; the field clears and stays ready; an empty entry is ignored.
function AddField(props: { label: string; visibleLabel?: boolean; placeholder: string; button: string; autoFocus?: boolean; onAdd: (title: string) => void; onBlurEmpty?: () => void }) {
  const [text, setText] = useState("");
  return (
    <form
      className="question"
      onSubmit={(e) => {
        e.preventDefault();
        if (!text.trim()) return;
        props.onAdd(text);
        setText("");
      }}
    >
      <label className="question">
        <span className={props.visibleLabel ? "question-label" : "sr-only"}>{props.label}</span>
        <span className="field-row">
          <input
            className="field step-field"
            placeholder={props.placeholder}
            autoFocus={props.autoFocus}
            autoComplete="off"
            enterKeyHint="done"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => !text.trim() && props.onBlurEmpty?.()}
          />
          <button className="send" aria-label={props.button}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        </span>
      </label>
    </form>
  );
}

// Wireframes.md §6: hold about half a second on touch, or press and drag with a mouse. No handle.
// Rows move among their own siblings only (rule 5); Move up / Move down cover keyboard and screen readers.
function useDragReorder(onDrop: (id: string, index: number) => void) {
  const dragging = useRef(false);
  useEffect(() => {
    // Once a hold has started a drag, stop the page from scrolling under the finger.
    const block = (e: TouchEvent) => dragging.current && e.preventDefault();
    document.addEventListener("touchmove", block, { passive: false });
    return () => document.removeEventListener("touchmove", block);
  }, []);

  return (e: React.PointerEvent<HTMLElement>, id: string) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button, input, label")) return;
    const li = e.currentTarget.closest("li")!;
    const items = [...li.parentElement!.children] as HTMLElement[];
    const rects = items.map((el) => el.getBoundingClientRect());
    const self = items.indexOf(li);
    const { clientX: x0, clientY: y0 } = e;
    const touch = e.pointerType !== "mouse";
    let started = false;
    const timer = touch ? window.setTimeout(begin, 500) : 0;

    function begin() {
      started = true;
      dragging.current = true;
      li.classList.add("dragging");
    }
    function onMove(ev: PointerEvent) {
      if (!started) {
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < (touch ? 8 : 4)) return;
        if (touch) return end(); // moved before the hold finished: it's a scroll
        begin();
      }
      li.style.transform = `translateY(${ev.clientY - y0}px)`;
    }
    function end(ev?: PointerEvent) {
      clearTimeout(timer);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      li.style.transform = "";
      li.classList.remove("dragging");
      dragging.current = false;
      if (!started || ev?.type !== "pointerup") return;
      const center = (rects[self].top + rects[self].bottom) / 2 + ev.clientY - y0;
      onDrop(id, rects.filter((r, i) => i !== self && (r.top + r.bottom) / 2 < center).length);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
  };
}
