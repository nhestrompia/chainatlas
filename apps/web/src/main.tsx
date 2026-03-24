import React from "react";
import ReactDOM from "react-dom/client";
import { Buffer } from "buffer";
import { AppRouterProvider } from "./app/router";
import "./styles/index.css";

if (!(globalThis as { Buffer?: typeof Buffer }).Buffer) {
  (globalThis as { Buffer?: typeof Buffer }).Buffer = Buffer;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppRouterProvider />
  </React.StrictMode>,
);
