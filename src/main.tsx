import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

if (import.meta.env.PROD && "serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch((e) => console.error("Service worker failed to register", e));
}
// Ask the browser not to evict the list under storage pressure. It may say no; it can only help (tech-spike.md §3).
navigator.storage?.persist?.().catch(() => {});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
