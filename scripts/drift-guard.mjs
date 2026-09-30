#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const frontendConfigPath = path.resolve(__dirname, "../frontend/src/config/contracts.ts");
const frontendRoot = path.resolve(__dirname, "../frontend");

function walk(dir, exts, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (["node_modules", ".git", "dist", "build", ".cache"].includes(entry.name)) continue;
      walk(path.join(dir, entry.name), exts, out);
    } else if (exts.includes(path.extname(entry.name))) {
      out.push(path.join(dir, entry.name));
    }
  }
  return out;
}

function findLegacyRefs() {
  const files = walk(frontendRoot, [".ts", ".tsx"]);
  const hits = [];
  for (const file of files) {
    const content = fs.readFileSync(file, "utf-8");
    if (content.includes("initializeContractClients")) {
      hits.push(file);
    }
  }
  return hits;
}

function parseContracts() {
  const content = fs.readFileSync(frontendConfigPath, "utf-8");
  const contracts = {};
  const regex = /(\w+_ID):\s*"(C[A-Z2-7]{55})"/g;
  let m;
  while ((m = regex.exec(content)) !== null) {
    contracts[m[1]] = m[2];
  }
  return contracts;
}
function validate(addr) {
  return /^C[A-Z2-7]{55}$/.test(addr);
}

const contracts = parseContracts();
console.log(`🔍 Drift guard: checking ${Object.keys(contracts).length} contract IDs...`);
let mismatches = [];

for (const [k, v] of Object.entries(contracts)) {
  if (!validate(v)) {
    console.error(`❌ Invalid address for ${k}: ${v}`);
    mismatches.push(k);
  }
}

try {
  const legacyRefs = findLegacyRefs();
  if (legacyRefs.length) {
    console.error("❌ Legacy initializer still present:\n" + legacyRefs.join("\n"));
    mismatches.push("legacy_initializer");
  } else {
    console.log("✓ No legacy initializer found");
  }
} catch {}

const legacyPath = path.resolve(__dirname, "../frontend/src/lib/contracts.ts");
if (fs.existsSync(legacyPath)) {
  console.error("❌ Legacy file still exists: frontend/src/lib/contracts.ts");
  mismatches.push("legacy_file");
} else {
  console.log("✓ Legacy file correctly deleted");
}

const clientPath = path.resolve(__dirname, "../frontend/src/lib/client.ts");
if (!fs.existsSync(clientPath)) {
  console.error("❌ Unified client missing");
  mismatches.push("client");
} else {
  console.log("✓ Unified client present");
}

const queuePath = path.resolve(__dirname, "../frontend/src/lib/offlineQueue.ts");
if (!fs.existsSync(queuePath)) {
  console.error("❌ Offline queue missing");
  mismatches.push("queue");
} else {
  console.log("✓ Offline queue present");
}

// ── Issue #556: URL config drift gate ──────────────────────────────────────
// Verify that the single-source env.ts exists and that no other .ts/.tsx file
// under frontend/src hard-codes one of the three service URLs directly.
console.log("🔍 Drift guard: checking URL config drift (issue #556)...");

const envConfigPath = path.resolve(__dirname, "../frontend/src/config/env.ts");
if (!fs.existsSync(envConfigPath)) {
  console.error("❌ frontend/src/config/env.ts (single URL config source) is missing");
  mismatches.push("url_config_source");
} else {
  console.log("✓ frontend/src/config/env.ts present");
}

// Patterns that indicate a hardcoded URL that should come from env.ts instead.
const hardcodedUrlPatterns = [
  /VITE_RELAYER_URL\s*\|\|\s*["']http:\/\/localhost:3001["']/,
  /const RELAYER_URL\s*=\s*import\.meta\.env\.VITE_RELAYER_URL/,
  /rpcUrl\s*:\s*["']https:\/\/soroban-testnet\.stellar\.org["']/,
  /["']https:\/\/horizon-testnet\.stellar\.org["']/,
];

const urlDriftFiles = [];
const frontendSrcFiles = walk(path.resolve(__dirname, "../frontend/src"), [".ts", ".tsx"]);
for (const file of frontendSrcFiles) {
  // Skip the canonical source itself
  if (file === envConfigPath) continue;
  const content = fs.readFileSync(file, "utf-8");
  for (const pat of hardcodedUrlPatterns) {
    if (pat.test(content)) {
      urlDriftFiles.push(path.relative(path.resolve(__dirname, ".."), file));
      break;
    }
  }
}

if (urlDriftFiles.length) {
  console.error("❌ Hardcoded service URLs found outside config/env.ts:");
  urlDriftFiles.forEach(f => console.error(`   ${f}`));
  mismatches.push("hardcoded_urls");
} else {
  console.log("✓ No hardcoded service URLs outside config/env.ts");
}
// ──────────────────────────────────────────────────────────────────────────

if (mismatches.length) {
  console.error(`\n❌ Drift guard FAILED: ${mismatches.join(", ")}`);
  process.exit(1);
} else {
  console.log("\n✅ Drift guard PASSED — no drift");
  process.exit(0);
}

// Check NUM_PUBLIC_SIGNALS mismatch (IDL source-of-truth drift)
try {
  const repoRoot = path.resolve(__dirname, "..");
  const votingLib = fs.readFileSync(path.resolve(repoRoot, "contracts/voting/src/lib.rs"), "utf-8");
  const voteCircom = fs.readFileSync(path.resolve(repoRoot, "circuits/vote.circom"), "utf-8");
  const frontendTypes = fs.readFileSync(
    path.resolve(repoRoot, "frontend/src/types/index.ts"),
    "utf-8",
  );

  const rustMatch = votingLib.match(/NUM_PUBLIC_SIGNALS:\s*u32\s*=\s*(\d+)/);
  const tsMatch = frontendTypes.match(/NUM_PUBLIC_SIGNALS\s*=\s*(\d+)/);
  // `component main {public [a, b, c]} = Vote(18);`
  const circomMatch = voteCircom.match(/component\s+main\s*\{public\s*\[([^\]]*)\]/);

  if (!rustMatch) NUM_PUBLIC_SIGNALS_DRIFT.push("could not parse NUM_PUBLIC_SIGNALS from contracts/voting/src/lib.rs");
  if (!tsMatch) NUM_PUBLIC_SIGNALS_DRIFT.push("could not parse NUM_PUBLIC_SIGNALS from frontend/src/types/index.ts");
  if (!circomMatch) NUM_PUBLIC_SIGNALS_DRIFT.push("could not parse the public signal list from circuits/vote.circom");

  if (rustMatch && tsMatch && rustMatch[1] !== tsMatch[1]) {
    NUM_PUBLIC_SIGNALS_DRIFT.push(
      `NUM_PUBLIC_SIGNALS mismatch between Rust (${rustMatch[1]}) and TypeScript (${tsMatch[1]})`,
    );
  }

  if (circomMatch) {
    const circomCount = circomMatch[1]
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean).length;
    if (rustMatch && circomCount !== Number(rustMatch[1])) {
      NUM_PUBLIC_SIGNALS_DRIFT.push(
        `vote.circom declares ${circomCount} public signals but the contract expects ${rustMatch[1]}. ` +
          `A verification key for this circuit has ${circomCount + 1} IC points and can never be registered.`,
      );
    }
  }

  // The checked-in key must be able to verify what the circuit produces.
  const vkeyPath = path.resolve(repoRoot, "frontend/public/circuits/verification_key.json");
  const expectedIcLen = rustMatch ? Number(rustMatch[1]) + 1 : null;

  if (!fs.existsSync(vkeyPath)) {
    // Deliberately a failure, not a pass. The artifacts are generated by the
    // trusted setup rather than committed (see
    // frontend/public/circuits/README.md), and a key generated for a different
    // public-signal count cannot be registered or can never verify — so a
    // missing key is a state a human has to resolve, not one to paper over.
    // Set ZK_VOTE_ALLOW_MISSING_VKEY=1 in an environment that generates the key
    // as part of its own pipeline.
    if (process.env.ZK_VOTE_ALLOW_MISSING_VKEY === "1") {
      console.log(
        "⚠ verification_key.json is absent (ZK_VOTE_ALLOW_MISSING_VKEY=1); " +
          `a key with ${expectedIcLen} IC points must be generated before voting works`,
      );
    } else {
      NUM_PUBLIC_SIGNALS_DRIFT.push(
        "checked-in verification_key.json is missing. The vote proving/verification " +
          "keys are generated by the trusted setup and must match the circuit's " +
          `${expectedIcLen}-element IC vector; see frontend/public/circuits/README.md. ` +
          "Set ZK_VOTE_ALLOW_MISSING_VKEY=1 only where the key is produced downstream.",
      );
    }
  } else if (rustMatch) {
    const vkey = JSON.parse(fs.readFileSync(vkeyPath, "utf-8"));
    if (typeof vkey.nPublic === "number" && vkey.nPublic !== Number(rustMatch[1])) {
      NUM_PUBLIC_SIGNALS_DRIFT.push(
        `checked-in verification_key.json has nPublic=${vkey.nPublic}, expected ${rustMatch[1]}. ` +
          `Regenerate it from the current r1cs via scripts/compile-circuits.sh; do not reuse a stale zkey.`,
      );
    }
    if (Array.isArray(vkey.IC) && vkey.IC.length !== expectedIcLen) {
      NUM_PUBLIC_SIGNALS_DRIFT.push(
        `checked-in verification_key.json has ${vkey.IC.length} IC points, expected ${expectedIcLen}`,
      );
    }
  }
} catch (e) {
  NUM_PUBLIC_SIGNALS_DRIFT.push(`public-signal drift check threw: ${e.message}`);
}

if (NUM_PUBLIC_SIGNALS_DRIFT.length) {
  mismatches.push(...NUM_PUBLIC_SIGNALS_DRIFT.map((m) => `public_signal_drift: ${m}`));
}

if (mismatches.length) {
  console.error(`\n❌ Drift guard FAILED: ${mismatches.join(", ")}`);
  process.exit(1);
} else {
  console.log("\n✅ Drift guard PASSED — no drift");
  process.exit(0);
}
