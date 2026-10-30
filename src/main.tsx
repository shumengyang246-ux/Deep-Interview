import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";
ReactDOM.createRoot(document.getElementById("root")!).render(
  location.hash === "#capture-backdrop" ? (
    <div style={{ position: "fixed", inset: 0, background: "#e8eddf" }}>
      Synthetic capture background
    </div>
  ) : (
    <React.StrictMode>
      <App />
    </React.StrictMode>
  ),
);
