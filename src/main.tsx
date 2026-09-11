import { createRoot } from "react-dom/client";
import "./styles.css";
import { Dashboard } from "./client/Dashboard";
import { applyTheme, storedTheme } from "./client/theme";

const root = document.getElementById("root");
if (!root) throw new Error("missing #root element");

// Before the first render, so a dark-mode dashboard never flashes light.
applyTheme(storedTheme());

createRoot(root).render(<Dashboard />);
