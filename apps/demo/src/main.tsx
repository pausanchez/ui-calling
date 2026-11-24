import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { Chat } from "./chat";
import { SurfacePage } from "./surface-page";
import "./styles.css";

const match = location.pathname.match(/^\/s\/([^/]+)/);

createRoot(document.getElementById("root")!).render(
  <StrictMode>{match ? <SurfacePage token={match[1]} /> : <Chat />}</StrictMode>,
);
