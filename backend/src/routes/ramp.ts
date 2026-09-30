// @ts-nocheck
import { Router } from "express";
import { sep6Deposit, sep6Withdraw } from "../services/anchor.js";
import {
  queryLimiter,
  csrfOriginGuard,
  masterKeyGuard,
} from "../middleware/index.js";

const router = Router();

function parseRampQuery(query: Record<string, unknown>) {
  const asset = query.asset;
  const account = query.account;
  const amount = query.amount;
  if (asset !== "USDC" && asset !== "EURC") {
    throw new Error("asset must be USDC or EURC");
  }
  if (typeof account !== "string" || !/^G[A-Z2-7]{55}$/.test(account)) {
    throw new Error("account must be a valid Stellar G address");
  }
  if (typeof amount !== "string") throw new Error("amount is required");
  return { asset, account, amount };
}

router.get("/ramp/deposit", masterKeyGuard, queryLimiter, async (req, res) => {
  let input: ReturnType<typeof parseRampQuery>;
  try {
    input = parseRampQuery(req.query as Record<string, unknown>);
  } catch (e: any) {
    return res.status(400).json({ error: e.message });
  }
  try {
    const r = await sep6Deposit(input.asset, input.account, input.amount);
    res.json(r);
  } catch (e: any) {
    res.status(502).json({ error: e.message });
  }
});

router.get(
  "/ramp/withdraw",
  masterKeyGuard,
  csrfOriginGuard,
  queryLimiter,
  async (req, res) => {
    let input: ReturnType<typeof parseRampQuery>;
    try {
      input = parseRampQuery(req.query as Record<string, unknown>);
    } catch (e: any) {
      return res.status(400).json({ error: e.message });
    }
    try {
      const dest = typeof req.query.dest === "string" ? req.query.dest : "bank";
      const r = await sep6Withdraw(
        input.asset,
        input.account,
        input.amount,
        dest,
      );
      res.json(r);
    } catch (e: any) {
      res.status(502).json({ error: e.message });
    }
  },
);

export default router;
