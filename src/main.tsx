import { Component, StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

// A crash anywhere below would leave a blank page. This keeps the one way out on screen; the list in localStorage is
// untouched, so a reload gets it back.
class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: unknown) {
    console.error("Ember crashed", error);
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main className="main">
        <h1>Something went wrong</h1>
        <p>Your list is still on this device. Reload to carry on.</p>
        <button className="button primary" onClick={() => location.reload()}>
          Reload
        </button>
      </main>
    );
  }
}

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch((e) => console.error("Service worker failed to register", e));
}
// Ask the browser not to evict the list under storage pressure. It may say no; it can only help (tech-spike.md §3).
navigator.storage?.persist?.().catch(() => {});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
