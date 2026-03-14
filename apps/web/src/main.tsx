import React from "react";
import ReactDOM from "react-dom/client";
import { AppRouterProvider } from "./app/router";
import "./styles/index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AppRouterProvider />
  </React.StrictMode>,
);
