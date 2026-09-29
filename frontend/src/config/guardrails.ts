import { CONTRACTS, NETWORK_CONFIG } from "./contracts";

const CONTRACT_ID_REGEX = /^C[A-Z2-7]{55}$/;

/**
 * Known deployments: full (network + core contract) tuples that this frontend
 * build is allowed to talk to. Placeholder strings that merely look like
 * StrKey contract IDs (e.g. CTREASURYYY… / CRRRRR…) are rejected (#646).
 */
const KNOWN_DEPLOYMENTS: Array<{
  networkName: string;
  networkPassphrase: string;
  rpcUrlIncludes?: string;
  contracts: Partial<Record<keyof typeof CONTRACTS, string>>;
}> = [
  {
    networkName: "testnet",
    networkPassphrase: "Test SDF Network ; September 2015",
    rpcUrlIncludes: "testnet",
    contracts: {
      REGISTRY_ID: "CBGK5YFR5544QNHUNR4WKB5ECL75DAY3R4M5UNALA42ZBPKOFNL5RM43",
      SBT_ID: "CCHLRCF47DJFQY6AR2PE3WRDRT7SDKSQJSJUGU77COW7GZMY5YTEUWYX",
      TREE_ID: "CAZC3WSRGE3PI6AZ3NHRKIZFVBEOOLFDP7RD6BMHIMRYV4VEYC42ARQZ",
      VOTING_ID: "CCYGWEUNWOBHJ6JIHDMTK2XSSDVMQ7ZGBJQE6QR2VYD4FRQGZR5EYKJ2",
      COMMENTS_ID: "CCUZNVADC24GEOPRD5A6PBCZGOQ6QOKJU6E5UBXI6RKDC7AWN5ATXNFF",
    },
  },
];

const PLACEHOLDER_CONTRACT_IDS = new Set([
  "CTREASURYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYYY",
  "CRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRRR",
]);

export function validateStaticConfig() {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Contract IDs must look like Soroban contract addresses
  Object.entries(CONTRACTS).forEach(([key, value]) => {
    if (!value) {
      // Optional reward/treasury may be unset — only error if set to placeholder
      if (key === "TREASURY_ID" || key === "REWARDS_ID") {
        return;
      }
      errors.push(`${key} is missing`);
      return;
    }
    if (!CONTRACT_ID_REGEX.test(value)) {
      errors.push(`${key} is not a valid contract id (got "${value}")`);
      return;
    }
    if (PLACEHOLDER_CONTRACT_IDS.has(value)) {
      errors.push(
        `${key} is a placeholder contract id and must be set to a known deployment`,
      );
    }
  });

  if (!NETWORK_CONFIG.rpcUrl) {
    errors.push("rpcUrl is missing");
  }
  if (!NETWORK_CONFIG.networkPassphrase) {
    errors.push("networkPassphrase is missing");
  }

  // Match the configured core contracts + network against the allow-list
  const matched = KNOWN_DEPLOYMENTS.some((deployment) => {
    if (deployment.networkPassphrase !== NETWORK_CONFIG.networkPassphrase) {
      return false;
    }
    if (
      deployment.networkName &&
      deployment.networkName !== NETWORK_CONFIG.networkName
    ) {
      return false;
    }
    if (
      deployment.rpcUrlIncludes &&
      !NETWORK_CONFIG.rpcUrl.includes(deployment.rpcUrlIncludes)
    ) {
      return false;
    }
    return Object.entries(deployment.contracts).every(
      ([key, expected]) =>
        CONTRACTS[key as keyof typeof CONTRACTS] === expected,
    );
  });

  if (!matched) {
    errors.push(
      "CONTRACTS/NETWORK_CONFIG do not match a known deployment allow-list entry",
    );
  }

  // Simple sanity: avoid accidental mainnet use unless explicit
  if (
    NETWORK_CONFIG.networkPassphrase.includes("Public Global Stellar Network")
  ) {
    warnings.push("Config is pointing at mainnet — ensure this is intentional");
  }

  return { errors, warnings };
}
