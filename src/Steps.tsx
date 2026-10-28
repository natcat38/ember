import { useEffect, useRef, useState, type ReactNode } from "react";
import { closestCenter, DndContext, KeyboardSensor, PointerSensor, useSensor, useSensors, type Modifier } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
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
  const moveStep = (id: string, index: number) => act((s) => moveTo(s, id, index, Date.now()));

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

  const row = (c: Chunk, drag: Handle) => (
    <div data-step={c.id} className={`row step${stateOf(state, c) === "done" ? " done" : ""}`}>
      <button type="button" className="icon-button grip" {...drag.attributes} {...drag.listeners} aria-label={`Reorder ${c.title}`}>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="9" cy="6" r="1.6" />
          <circle cx="15" cy="6" r="1.6" />
          <circle cx="9" cy="12" r="1.6" />
          <circle cx="15" cy="12" r="1.6" />
          <circle cx="9" cy="18" r="1.6" />
          <circle cx="15" cy="18" r="1.6" />
        </svg>
      </button>
      <label className="check">
        <input type="checkbox" checked={stateOf(state, c) === "done"} aria-label={c.title} onChange={(e) => onTick(c, e.target.checked)} />
      </label>
      <span className="step-title">{c.title}</span>
      {/* Rule 3: no start button on a parent; Focus runs on one smaller step. */}
      {!childrenOf(state, c.id).length && c.state !== "done" && (
        <button className="icon-button step-start" aria-label={`Start ${c.title}`} onClick={() => onStart(c.id)}>
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
        <SortableList ids={top.map((c) => c.id)} onMove={moveStep}>
          {top.map((c) => {
            const kids = childrenOf(state, c.id);
            return (
              <SortableStep key={c.id} id={c.id}>
                {(drag) => (
                  <>
                    {row(c, drag)}
                    {(kids.length > 0 || addingTo === c.id) && (
                      <div className="substeps" role="group" aria-label={`Smaller steps of ${c.title}`}>
                        {kids.length > 0 && (
                          <SortableList ids={kids.map((k) => k.id)} onMove={moveStep}>
                            {kids.map((k) => (
                              <SortableStep key={k.id} id={k.id}>
                                {(drag) => row(k, drag)}
                              </SortableStep>
                            ))}
                          </SortableList>
                        )}
                        {addingTo === c.id && (
                          <AddField
                            label={`Add a smaller step to ${c.title}`}
                            placeholder="Add a smaller step"
                            button="Add smaller step"
                            autoFocus
                            onAdd={(title) => act((s) => addChunk(s, taskId, title, c.id, Date.now()))}
                            onBlurEmpty={() => setAddingTo((now) => (now === c.id ? null : now))}
                          />
                        )}
                      </div>
                    )}
                  </>
                )}
              </SortableStep>
            );
          })}
        </SortableList>
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
  const input = useRef<HTMLInputElement>(null);
  const cancelCollapse = useRef<() => void>(undefined);
  useEffect(() => () => cancelCollapse.current?.(), []);

  // An empty field goes away when the user moves on, but not on the blur itself: that blur is the start of a tap, and
  // taking the field out of the page then moves the rows under the finger so the tap lands on nothing (Verify finding 1).
  // So it waits for the next click or key press, which has already been delivered by the time this runs.
  function collapseAfterNextPress() {
    cancelCollapse.current?.();
    const stop = () => {
      window.removeEventListener("click", go);
      window.removeEventListener("keydown", go);
    };
    const go = () => {
      stop();
      if (input.current && input.current !== document.activeElement && !input.current.value.trim()) props.onBlurEmpty?.();
    };
    cancelCollapse.current = stop;
    window.addEventListener("click", go);
    window.addEventListener("keydown", go);
  }

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
            ref={input}
            className="field step-field"
            placeholder={props.placeholder}
            autoFocus={props.autoFocus}
            autoComplete="off"
            enterKeyHint="done"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onBlur={() => !text.trim() && props.onBlurEmpty && collapseAfterNextPress()}
          />
          {/* Outlined: Start is the Task view's one primary button (restraint rule 2). */}
          <button className="send quiet" aria-label={props.button}>
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>
        </span>
      </label>
    </form>
  );
}

// Wireframes.md §6, revised 2026-10-07 to match the shadcn/dnd-kit sortable list Natalie pointed at: a grip handle on
// each row drags at once (4 px of movement, no hold), the rest of the row scrolls and taps as usual, and the dragged row
// goes half-transparent while the others slide aside. The handle is a real button, so the keyboard lifts a row with
// Space, moves it with the arrows and drops it with Space. Rows move among their own siblings only (rule 5): each list
// is its own context.
type Handle = Pick<ReturnType<typeof useSortable>, "attributes" | "listeners">;
const vertical: Modifier = ({ transform }) => ({ ...transform, x: 0 });

function SortableList({ ids, onMove, children }: { ids: string[]; onMove: (id: string, index: number) => void; children: ReactNode }) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), // a tap on the handle is not a drag
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[vertical]}
      onDragEnd={({ active, over }) => over && active.id !== over.id && onMove(String(active.id), ids.indexOf(String(over.id)))}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        <ul className="list">{children}</ul>
      </SortableContext>
    </DndContext>
  );
}

// The whole <li> moves, so a parent carries its smaller steps with it.
function SortableStep({ id, children }: { id: string; children: (drag: Handle) => ReactNode }) {
  const { setNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id });
  return (
    <li ref={setNodeRef} className={isDragging ? "dragging" : undefined} style={{ transform: transform ? `translate3d(0, ${transform.y}px, 0)` : undefined, transition }}>
      {children({ attributes, listeners })}
    </li>
  );
}
