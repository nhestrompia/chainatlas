import { usePrivyWallet } from "./use-privy-wallet";

export function usePrivySession() {
  const { address, authenticated, disconnect, ready, wallet, walletConnected } =
    usePrivyWallet();

  return {
    ready,
    authenticated,
    walletConnected,
    wallet,
    address,
    disconnect,
  };
}
