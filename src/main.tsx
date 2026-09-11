import { createRoot } from "react-dom/client";
import "./styles.css";
import { Dashboard } from "./client/Dashboard";

const root = document.getElementById("root");
if (!root) throw new Error("missing #root element");

createRoot(root).render(<Dashboard />);
