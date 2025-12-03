import express from "express";
import bodyParser from "body-parser";
import axios from "axios";
import {
  Connection,
  Keypair,
  VersionedTransaction
} from "@solana/web3.js";

const app = express();
app.use(bodyParser.json());

/* ============================================================
   CONFIGURAÇÕES
============================================================ */
const HELIUS_RPC = `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API}`;
const connection = new Connection(HELIUS_RPC);

const BOT_PRIVATE_KEY = Uint8Array.from(JSON.parse(process.env.PRIVATE_KEY));
const BOT_KEYPAIR = Keypair.fromSecretKey(BOT_PRIVATE_KEY);
const BOT_PUBLIC = BOT_KEYPAIR.publicKey.toBase58();

const MONITORED_WALLETS = process.env.WALLETS
  ? process.env.WALLETS.split(",").map(w => w.trim())
  : [];

const JUP_API_KEY = process.env.JUP_API_KEY;

// ENDPOINT ULTRA (o mais rápido e grátis)
const JUP_ULTRA = "https://api.jup.ag/ultra/";

/* ============================================================
   LOG
============================================================ */
function log(...msg) {
  console.log("\n>>>", ...msg);
}

/* ============================================================
   COMPRAR 1 USDC DO TOKEN DETECTADO
============================================================ */
async function buy1USDC(mint) {
  try {
    log(`🔍 Copiando compra: 1 USDC → ${mint}`);

    const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
    const amount = 1_000_000; // 1 USDC

    /* ------------------------------
       1) QUOTE (Ultra API)
    ------------------------------ */
    const quoteRes = await axios.get(`${JUP_ULTRA}quote`, {
      params: {
        inputMint: USDC,
        outputMint: mint,
        amount,
        slippageBps: 1500,
      },
      headers: {
        Authorization: `Bearer ${JUP_API_KEY}`,
      }
    });

    const quote = quoteRes.data;

    if (!quote || !quote.routePlan) {
      log("❌ Nenhuma rota encontrada.");
      return;
    }

    /* ------------------------------
       2) SWAP (Ultra API)
    ------------------------------ */
    const swapRes = await axios.post(
      `${JUP_ULTRA}swap`,
      {
        quoteResponse: quote,
        userPublicKey: BOT_PUBLIC,
        dynamicSlippage: true,
        dynamicComputeUnitLimit: true,
        prioritizationFeeLamports: "auto"
      },
      {
        headers: { Authorization: `Bearer ${JUP_API_KEY}` }
      }
    );

    const swapTx = swapRes.data.swapTransaction;
    const rawTx = Buffer.from(swapTx, "base64");
    const tx = VersionedTransaction.deserialize(rawTx);

    tx.sign([BOT_KEYPAIR]);

    const sig = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: true,
      maxRetries: 5,
    });

    log(`🚀 SWAP EXECUTADO | https://solscan.io/tx/${sig}`);
  } catch (err) {
    log("❌ ERRO NA COMPRA:", err.message);
  }
}

/* ============================================================
   DETECTAR TOKEN RECEBIDO (swap buy)
============================================================ */
function detectTokenBuys(event) {
  const out = [];

  try {
    for (const acc of event.accountData) {
      if (!acc.tokenBalanceChanges) continue;

      for (const t of acc.tokenBalanceChanges) {
        const user = t.userAccount;
        const mint = t.mint;
        const amount = Number(t.rawTokenAmount.tokenAmount);

        // Fungível no pump.fun / jupiter
        const isFungible = t.rawTokenAmount.decimals <= 12;

        if (!isFungible) continue;
        if (!MONITORED_WALLETS.includes(user)) continue;
        if (amount <= 0) continue;

        out.push({ user, mint, amount });
      }
    }
  } catch (err) {
    log("Erro parser:", err.message);
  }

  return out;
}

/* ============================================================
   WEBHOOK HELIUS
============================================================ */
const seen = new Set();

app.post("/helius", async (req, res) => {
  res.sendStatus(200);

  const data = req.body;
  if (!Array.isArray(data)) return;

  for (const ev of data) {
    const sig = ev.signature;

    // evitar duplicado
    if (seen.has(sig)) continue;
    seen.add(sig);

    log("===================================================");
    log(">>> RECEBI WEBHOOK");
    log("TX:", sig);

    const buys = detectTokenBuys(ev);

    if (buys.length === 0) {
      log("Nenhum swap de compra detectado.");
      continue;
    }

    for (const b of buys) {
      log(`📥 Wallet ${b.user} comprou ${b.amount} do token ${b.mint}`);
      await buy1USDC(b.mint);
    }
  }
});

/* ============================================================
   START
============================================================ */
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`🔥 MIROMA COPY BOT ONLINE – PORTA ${PORT} 🔥`);
});




