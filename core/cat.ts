// Which pose the cat takes (UX_Flows.md §6). Pure: the caller works out the flags from what the app already knows.
// The rule under it: the cat reflects what the user is doing right now, never how the day went.
export type CatPose = "asleep" | "watching" | "stretching" | "purring" | "door";

export interface CatInput {
  // Where the cat is drawn (Design_Direction.md §4). Reward is the moment a step has just been finished.
  screen: "today" | "focus" | "reward" | "shutdown";
  session?: "running" | "paused" | null; // the focus session, if any
  shutdownDone?: boolean; // days.shutdown_at is set for today
  firstOpen?: boolean; // the day's first open, and the wake-up has not happened yet
  lapseReturn?: boolean; // the welcome back after 3+ days away, and nobody has tapped since
}

export function catPose({ screen, session, shutdownDone, firstOpen, lapseReturn }: CatInput): CatPose {
  switch (screen) {
    case "shutdown":
      return "asleep"; // "You're done": falling asleep
    case "reward":
      return "purring";
    case "focus":
      // Pause or exit leaves stretching for watching.
      return session === "running" ? "stretching" : "watching";
    case "today":
      // After shutdown the cat stays asleep even if Ember is reopened to capture something at 11pm.
      if (shutdownDone) return "asleep";
      // The lapse return is also a first open of the day; the door is the more specific of the two.
      if (lapseReturn) return "door";
      return firstOpen ? "asleep" : "watching";
  }
}
