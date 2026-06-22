import React from "react";
import ReactDOM from "react-dom/client";
import { Buffer } from "buffer";
import App from "./App";
import { SolanaProviders } from "./providers";
import "./styles.css";

// Solana web3 / snarkjs expect Node globals in the browser.
(globalThis as { Buffer?: typeof Buffer }).Buffer ??= Buffer;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <SolanaProviders>
      <App />
    </SolanaProviders>
  </React.StrictMode>
);
