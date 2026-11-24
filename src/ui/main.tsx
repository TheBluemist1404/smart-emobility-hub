import { createRoot } from "react-dom/client";
import "./assets/ds.css";
import "./assets/app.css";
import { MobileApp } from "./student/MobileApp";
import { OperatorConsole } from "./operator/OperatorConsole";
import { Stage, Landing } from "./demo/Stage";

const path = window.location.pathname.replace(/\/+$/, "") || "/";
document.body.classList.add("app");

function App() {
  if (path.startsWith("/student")) return <div className={`student-page${new URLSearchParams(location.search).get("tools") === "0" ? "" : " tools"}`}><MobileApp /></div>;
  if (path.startsWith("/operator")) return <OperatorConsole />;
  if (path.startsWith("/stage")) return <Stage />;
  return <Landing />;
}

createRoot(document.getElementById("root")!).render(<App />);
