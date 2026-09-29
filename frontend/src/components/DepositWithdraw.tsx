import { useState, useEffect } from "react";
import { Button } from "./ui/Button";
import { relayerFetch } from "../lib/api";
import { isAllowedMessageOrigin } from "../lib/messageOrigin";

type Asset = "USDC" | "EURC";

export default function DepositWithdraw() {
  const [asset, setAsset] = useState<Asset>("USDC");
  const [amount, setAmount] = useState("100");
  const [account, setAccount] = useState("");
  const [info, setInfo] = useState<any>(null);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      // Security: Strictly enforce same-origin for ramps/deposits (blocks evil.com and external embedders)
      if (!isAllowedMessageOrigin(event.origin, "ramp")) {
        console.warn("Dropped ramp postMessage from untrusted or non-same origin:", event.origin);
        return;
      }

      const data = event.data;
      if (!data || typeof data !== "object") return;

      if (data.type === "SET_RAMP" && data.payload) {
        if (data.payload.asset && ["USDC", "EURC"].includes(data.payload.asset)) {
          setAsset(data.payload.asset);
        }
        if (typeof data.payload.amount === "string") {
          setAmount(data.payload.amount);
        }
        if (typeof data.payload.account === "string") {
          setAccount(data.payload.account);
        }
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  const deposit = async () => {
    try {
      const res = await relayerFetch(`/ramp/deposit?asset=${asset}&account=${account || "G..."}&amount=${amount}`);
      const text = await res.text();
      let j: any = {};
      try { j = text ? JSON.parse(text) : {}; } catch { j = { raw: text }; }
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}: ${text.slice(0, 200)}`);
      setInfo(j);
    } catch (e: any) { setInfo({ error: e.message }); }
  };
  const withdraw = async () => {
    try {
      const res = await relayerFetch(`/ramp/withdraw?asset=${asset}&account=${account || "G..."}&amount=${amount}&dest=bank`);
      const text = await res.text();
      let j: any = {};
      try { j = text ? JSON.parse(text) : {}; } catch { j = { raw: text }; }
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}: ${text.slice(0, 200)}`);
      setInfo(j);
    } catch (e: any) { setInfo({ error: e.message }); }
  };

  return (
    <div className="rounded-xl border p-6 bg-card space-y-4">
      <h3 className="text-lg font-semibold">Inflow / Outflow — SEP-6/24/31 (real anchors)</h3>
      <div className="flex gap-3">
        <select value={asset} onChange={e => setAsset(e.target.value as Asset)} className="border rounded px-3 py-2 bg-background flex-1">
          <option>USDC</option><option>EURC</option>
        </select>
        <input value={amount} onChange={e => setAmount(e.target.value)} className="border rounded px-3 py-2 bg-background flex-1" placeholder="Amount" />
      </div>
      <input value={account} onChange={e => setAccount(e.target.value)} placeholder="Stellar account G..." className="w-full border rounded px-3 py-2 bg-background font-mono text-sm" />
      <div className="flex gap-2">
        <Button onClick={deposit} variant="outline" className="flex-1">Deposit (SEP-6)</Button>
        <Button onClick={withdraw} variant="outline" className="flex-1">Withdraw (SEP-6 → bank)</Button>
      </div>
      {info && <pre className="text-xs bg-muted p-3 rounded overflow-auto max-h-40">{JSON.stringify(info, null, 2)}</pre>}
      <p className="text-xs text-muted-foreground">Circle USDC/EURC anchors via ANCHOR_USDC_URL / ANCHOR_EURC_URL. High-volume via claimableBalance.</p>
    </div>
  );
}
