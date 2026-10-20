import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./ds/tokens.css";
import "./ds-app/fonts.css";
import "./ds/bundle.css";
import "./ds-app/markdown.css";
import "./index.css";
import App from "./App";
import { initTheme } from "./lib/theme";

// Set data-theme before the first render so there is no flash of the wrong theme.
initTheme();

const root = document.getElementById("root");

if (!root) {
  throw new Error("Proteus root element was not found");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
