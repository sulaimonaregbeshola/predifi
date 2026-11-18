"use client";

import { useEffect, useState, useCallback } from "react";
import { classifyWalletError } from "@/lib/walletErrors";
import {
  verifyContractIdentity,
  type ContractIdentityDiagnostic,
} from "@/lib/deploymentManifest";

/** Stellar / Soroban — no canonical EVM chain for this app.
 *  Set to the chain you actually target; null means "any chain is wrong
 *  unless ethereum is absent", which lets us show the modal only when a
 *  wallet IS connected but on the wrong chain. */
export const REQUIRED_CHAIN_ID = "0x1"; // Ethereum mainnet placeholder
export const REQUIRED_CHAIN_NAME = "Ethereum Mainnet";

/** Contract environment the app is configured to talk to. Surfaced in the
 *  mismatch UI so users can confirm they are pointed at the intended
 *  deployment before submitting anything. */
export const EXPECTED_CONTRACT_ENV =
  process.env.NEXT_PUBLIC_CONTRACT_ENV ?? "production";

/** How long to keep polling the provider after a switch request, since some
 *  wallets update `eth_chainId` asynchronously after resolving the switch. */
const RECHECK_TIMEOUT_MS = 5000;
const RECHECK_INTERVAL_MS = 250;

export interface NetworkMismatchError {
  currentNetwork: string;
  requiredNetwork: string;
  message: string;
}

/** Diagnostic describing why the configured contract identity could not be
 *  verified against the pinned deployment manifest. */
export interface ContractIdentityDiagnostic {
  /** Machine-readable reason code. */
  code:
    | "manifest-unavailable"
    | "manifest-stale"
    | "contract-mismatch"
    | "network-mismatch"
    | "interface-unsupported";
  /** Human-readable explanation surfaced to the user. */
  message: string;
  /** Contract ID the app is configured with (if any). */
  configuredContractId: string | null;
  /** Contract ID pinned in the manifest (if any). */
  expectedContractId: string | null;
  /** Network the app is configured for. */
  configuredNetwork: string | null;
  /** Network pinned in the manifest (if any). */
  expectedNetwork: string | null;
}

export interface NetworkGuardState {
  /** True when wallet is connected on the wrong chain. */
  isWrongNetwork: boolean;
  /** Alias for isWrongNetwork — true while the wallet is on an unsupported network. */
  isMismatch: boolean;
  /** Human-readable name of the chain the user is currently on. */
  currentChainName: string;
  /** Expected network the app requires. */
  expectedNetwork: string;
  /** Contract environment the app is configured for. */
  expectedContractEnv: string;
  /** True while a mismatch persists — economic actions must stay disabled. */
  isEconomicActionDisabled: boolean;
  /** True when the configured contract identity could not be verified against
   *  the pinned deployment manifest. Mutations must stay disabled. */
  isContractIdentityInvalid: boolean;
  /** Diagnostic for the contract identity failure, or null when verified. */
  contractIdentityDiagnostic: ContractIdentityDiagnostic | null;
  /** True when any guard condition (network or contract identity) disables mutations. */
  isMutationDisabled: boolean;
  /** Trigger the programmatic network switch; resolves when done or rejects on user cancel. */
  switchNetwork: () => Promise<void>;
  /** Re-read the wallet's current chain and update mismatch state. */
  recheckNetwork: () => Promise<void>;
  /** Error message from the last failed switch attempt. */
  switchError: string | null;
  /** Structured recovery hint when switch fails. */
  switchRecoveryAction: string | null;
  /** 
   * Check network immediately before transaction submission.
   * Returns null if network is correct, or NetworkMismatchError if wrong.
   * Call this just before submitting any transaction to catch mid-session network switches.
   */
  checkNetworkBeforeSubmit: () => Promise<NetworkMismatchError | null>;
}
=======

const CHAIN_NAMES: Record<string, string> = {
  "0x1": "Ethereum Mainnet",
  "0x38": "BNB Smart Chain",
  "0x89": "Polygon",
  "0xa4b1": "Arbitrum One",
  "0xa": "Optimism",
  "0x2105": "Base",
  "0xe708": "Linea",
  "0xaa36a7": "Sepolia Testnet",
  "0x13882": "Polygon Amoy",
};

function chainName(hexId: string): string {
  return CHAIN_NAMES[hexId.toLowerCase()] ?? `Chain ${parseInt(hexId, 16)}`;
}

export function useNetworkGuard(): NetworkGuardState {
  const [currentChainId, setCurrentChainId] = useState<string | null>(null);
  const [switchError, setSwitchError] = useState<string | null>(null);
  const [switchRecoveryAction, setSwitchRecoveryAction] = useState<
    string | null
  >(null);
  const [contractIdentityDiagnostic, setContractIdentityDiagnostic] =
    useState<ContractIdentityDiagnostic | null>(null);

  /** Verify the configured contract identity against the pinned manifest.
   *  Never falls back to an unverified contract: on any failure the
   *  diagnostic is set and mutations stay disabled. */
  const verifyIdentity = useCallback(async () => {
    try {
      const diagnostic = await verifyContractIdentity();
      setContractIdentityDiagnostic(diagnostic);
    } catch {
      // A thrown verification is treated as an unavailable manifest rather
      // than silently trusting the configured contract.
      setContractIdentityDiagnostic({
        code: "manifest-unavailable",
        message:
          "Deployment manifest could not be loaded. Contract identity is unverified.",
        configuredContractId: null,
        expectedContractId: null,
        configuredNetwork: null,
        expectedNetwork: null,
      });
    }
  }, []);

  useEffect(() => {
    // Verify on startup regardless of wallet presence.
    void verifyIdentity();

    const eth = window.ethereum;
    if (!eth) return;

    eth.request({ method: "eth_chainId" }).then(setCurrentChainId).catch(() => {});

    const handler = (chainId: string) => {
      setCurrentChainId(chainId);
      // Re-verify contract identity on every network change.
      void verifyIdentity();
    };
    eth.on("chainChanged", handler);
    return () => eth.removeListener("chainChanged", handler);
  }, [verifyIdentity]);

  const isWrongNetwork =
    currentChainId !== null &&
    currentChainId.toLowerCase() !== REQUIRED_CHAIN_ID.toLowerCase();

  const isContractIdentityInvalid = contractIdentityDiagnostic !== null;
  const isMutationDisabled = isWrongNetwork || isContractIdentityInvalid;

  /** Poll the provider until it reports the expected chain or we time out.
   *  Some wallets resolve `wallet_switchEthereumChain` before `eth_chainId`
   *  reflects the new chain, so we must not trust the switch resolution alone. */
  const waitForExpectedChain = useCallback(async (): Promise<string | null> => {
    const eth = window.ethereum;
    if (!eth) return null;
    const deadline = Date.now() + RECHECK_TIMEOUT_MS;
    let last: string | null = null;
    while (Date.now() < deadline) {
      try {
        const id = (await eth.request({ method: "eth_chainId" })) as string;
        last = id;
        if (id.toLowerCase() === REQUIRED_CHAIN_ID.toLowerCase()) {
          return id;
        }
      } catch {
        // Ignore transient provider errors and keep polling.
      }
      await new Promise((resolve) => setTimeout(resolve, RECHECK_INTERVAL_MS));
    }
    return last;
  }, []);

  const recheckNetwork = useCallback(async () => {
    const eth = window.ethereum;
    if (!eth) {
      setCurrentChainId(null);
      return;
    }
    try {
      const id = (await eth.request({ method: "eth_chainId" })) as string;
      setCurrentChainId(id);
    } catch {
      // Leave the last known chain in place; mismatch state is preserved.
    }
  }, []);

  const switchNetwork = useCallback(async () => {
    const eth = window.ethereum;
    if (!eth) {
      const classified = classifyWalletError(
        new Error("wallet extension not found")
      );
      setSwitchError(classified.message);
      setSwitchRecoveryAction(classified.recoveryAction);
      return;
    }
    setSwitchError(null);
    setSwitchRecoveryAction(null);
    try {
      await eth.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: REQUIRED_CHAIN_ID }],
      });
    } catch (err) {
      // Rejected switch or unsupported network: keep mismatch state intact
      // and surface a recovery action. Do not optimistically clear anything.
      const classified = classifyWalletError(err);
      setSwitchError(classified.message);
      setSwitchRecoveryAction(classified.recoveryAction);
      await recheckNetwork();
      return;
    }

    // Switch resolved — but the provider may lag. Poll until it actually
    // reports the expected chain before clearing the mismatch.
    const observed = await waitForExpectedChain();
    if (observed !== null) {
      setCurrentChainId(observed);
    } else {
      await recheckNetwork();
    }
    if (
      observed === null ||
      observed.toLowerCase() !== REQUIRED_CHAIN_ID.toLowerCase()
    ) {
      setSwitchError(
        `Wallet has not reported ${REQUIRED_CHAIN_NAME} yet. Please confirm the network in your wallet and try again.`
      );
      setSwitchRecoveryAction(
        `Open your wallet and manually switch to ${REQUIRED_CHAIN_NAME}.`
      );
    }
  }, [recheckNetwork, waitForExpectedChain]);

  const checkNetworkBeforeSubmit = useCallback(async (): Promise<NetworkMismatchError | null> => {
    const eth = window.ethereum;
    if (!eth) {
      // No wallet installed - let the transaction submission handle this
      return null;
    }

    try {
      // Re-fetch the current chain ID to catch mid-session network switches
      const freshChainId = (await eth.request({ method: "eth_chainId" })) as string;
      
      if (freshChainId.toLowerCase() !== REQUIRED_CHAIN_ID.toLowerCase()) {
        const current = chainName(freshChainId);
        const required = REQUIRED_CHAIN_NAME;
        return {
          currentNetwork: current,
          requiredNetwork: required,
          message: `Network mismatch: You are on ${current} but this transaction requires ${required}. Please switch networks and try again.`,
        };
      }
      
      return null;
    } catch (err) {
      // If we can't check the network, allow the transaction to proceed
      // The wallet or RPC will likely fail with a more specific error
      console.error("Failed to check network before submit:", err);
      return null;
    }
  }, []);

  return {
    isWrongNetwork,
    isMismatch: isWrongNetwork,
    currentChainName: currentChainId ? chainName(currentChainId) : "",
    expectedNetwork: REQUIRED_CHAIN_NAME,
    expectedContractEnv: EXPECTED_CONTRACT_ENV,
    isEconomicActionDisabled: isMutationDisabled,
    isContractIdentityInvalid,
    contractIdentityDiagnostic,
    isMutationDisabled,
    switchNetwork,
    recheckNetwork,
    switchError,
    switchRecoveryAction,
    checkNetworkBeforeSubmit,
  };
}
