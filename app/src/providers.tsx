import { useMemo, type ReactNode } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { RPC_URL } from "./lib/soteria";
import "@solana/wallet-adapter-react-ui/styles.css";

// Wallets that support the Wallet Standard (Phantom, Solflare, Backpack, …)
// register themselves, so an empty adapter list auto-detects them.
export function SolanaProviders({ children }: { children: ReactNode }) {
  const endpoint = useMemo(() => RPC_URL, []);
  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={[]} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
