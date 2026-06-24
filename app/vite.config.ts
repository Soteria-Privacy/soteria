import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { nodePolyfills } from "vite-plugin-node-polyfills";
import wasm from "vite-plugin-wasm";
import topLevelAwait from "vite-plugin-top-level-await";

// Solana web3, circomlibjs (blake-hash) and snarkjs reference Node globals
// (Buffer/process/global) at module load — polyfill them for the browser.
// wasm + topLevelAwait load @solana/zk-sdk (confidential-transfer proofs).
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    wasm(),
    topLevelAwait(),
    nodePolyfills({ globals: { Buffer: true, global: true, process: true } }),
  ],
  // The background sweeper runs as a module worker and transitively loads the
  // zk-sdk wasm, so the worker bundle needs the same wasm handling.
  worker: {
    format: "es",
    plugins: () => [
      wasm(),
      topLevelAwait(),
      nodePolyfills({ globals: { Buffer: true, global: true, process: true } }),
    ],
  },
});
