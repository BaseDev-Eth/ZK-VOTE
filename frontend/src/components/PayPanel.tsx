import { useState } from "react";
import { Button } from "./ui/Button";
import { sendPayment, sendBatchPayment } from "../lib/payments";
import { classifyStellarAddress, describeStellarAddress } from "../lib/stellar-address";

type Asset = "XLM" | "USDC" | "EURC";

export default function PayPanel() {
  const [asset, setAsset] = useState<Asset>("XLM");
  const [dest, setDest] = useState("");
  const [amount, setAmount] = useState("5");
  const [memo, setMemo] = useState("");
  const [loading, setLoading] = useState(false);

  const send = async () => {
    if (!dest) return alert("Destination required (G... or M...)");
    if (!classifyStellarAddress(dest)) {
      return alert("Invalid destination: must be G... (56 chars) or M... (69 chars). M... and G... are not interchangeable.");
    }
    setLoading(true);
    try {
      const j = await sendPayment({ asset, destination: dest.trim(), amount, memo: memo || undefined });
      alert(j.hash ? `Payment sent: ${j.hash}` : JSON.stringify(j));
    } catch (e: any) { alert(e.message); } finally { setLoading(false); }
  };

  const sendBatch = async () => {
    const destination = dest.trim() || "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
    if (!classifyStellarAddress(destination)) {
      return alert("Invalid destination: must be G... or M...");
    }
    const ops = Array.from({ length: 3 }, () => ({ destination, asset, amount }));
    setLoading(true);
    try {
      const j = await sendBatchPayment(ops);
      alert(j.hash ? `Batch ${j.ops} sent: ${j.hash}` : JSON.stringify(j));
    } catch (e: any) { alert(e.message); } finally { setLoading(false); }
  };

  return (
    <div className="rounded-xl border p-6 bg-card space-y-4">
      <h3 className="text-lg font-semibold">Pay XLM / USDC / EURC (real, high-volume)</h3>
      <div className="grid grid-cols-2 gap-3">
        <select value={asset} onChange={e => setAsset(e.target.value as Asset)} className="border rounded px-3 py-2 bg-background">
          <option>XLM</option><option>USDC</option><option>EURC</option>
        </select>
        <input value={amount} onChange={e => setAmount(e.target.value)} placeholder="Amount (7 decimals)" className="border rounded px-3 py-2 bg-background" />
      </div>
      <input value={dest} onChange={e => setDest(e.target.value)} placeholder="Destination G... or M... (muxed for inflow)" className="w-full border rounded px-3 py-2 bg-background font-mono text-sm" />
      {dest && (
        <p className={`text-xs ${classifyStellarAddress(dest) ? "text-muted-foreground" : "text-red-500"}`}>
          {describeStellarAddress(dest)}
          {classifyStellarAddress(dest) === "G" && " — warning: if the recipient gave you M..., paying the bare G... base loses the funds to the shared balance."}
        </p>
      )}
      <input value={memo} onChange={e => setMemo(e.target.value)} placeholder="Memo (optional)" className="w-full border rounded px-3 py-2 bg-background" />
      <div className="flex gap-2">
        <Button onClick={send} disabled={loading} className="flex-1">{loading ? "..." : "Send (withSequenceLock)"}</Button>
        <Button onClick={sendBatch} disabled={loading} variant="outline" className="flex-1">Batch 3× (100/tx)</Button>
      </div>
      <p className="text-xs text-muted-foreground">Muxed M... for inflow, 100 ops/tx, fee-bump, idempotency via payment_jobs.</p>
    </div>
  );
}
