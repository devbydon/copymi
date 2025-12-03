import express from "express";
import bodyParser from "body-parser";
import axios from "axios";
import {
  Connection,
  Keypair,
  PublicKey,
  VersionedTransaction,
} from "@solana/web3.js";

const app = express();
app.use(bodyParser.json());

const HELIUS_RPC = `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API}`;
const connection = new Connection(HELIUS_RPC);

const BOT_PRIVATE_KEY = Uint8Array.from(JSON.parse(process.env.PRIVATE_KEY));
const BOT_KEYPAIR = Keypair.fromSecretKey(BOT_PRIVATE_KEY);
const BOT_PUBLIC = BOT_KEYPAIR.publicKey.toBase58();

const MONITORED_WALLETS = process.env.WALLETS
  ? process.env.WALLETS.split(",").map(w => w.trim())
  : [];

const JUPITER_QUOTE = "https://quote-api.jup.ag/v6/quote";
const JUPITER_SWAP = "https://quote-api.jup.ag/v6/swap";

let processedSignatures = new Set();

/* ============================================================
   LOG
============================================================ */
function log(...msg) {
  console.log("\n>>>", ...msg);
}

/* ============================================================
   JUPITER - COMPRAR 1 USDC DO MINT
============================================================ */
async function buy1USDC(mint) {
  try {
    log(`🔍 Iniciando cópia: comprando 1 USDC de ${mint}`);

    // USDC SPL
    const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

    // 1 USDC
    const amount = 1_000_000; // 1 USDC = 1e6

    // Obter quote
    const quote = await axios.get(JUPITER_QUOTE, {
      params: {
        inputMint: USDC_MINT,
        outputMint: mint,
        amount,
        slippageBps: 300, // 3% slippage universal
      },
    });

    const quoteTx = quote.data;

    if (!quoteTx || !quoteTx.outAmount) {
      log("❌ Quote impossível — token sem rota ainda.");
      return;
    }

    log("📌 Quote OK:", quoteTx.outAmount, "tokens recebidos");

    // Build transaction
    const swap = await axios.post(JUPITER_SWAP, {
      quoteResponse: quoteTx,
      userPublicKey: BOT_PUBLIC,
      wrapAndUnwrapSol: true,
    });

    const swapTx = swap.data.swapTransaction;
    const rawTx = Buffer.from(swapTx, "base64");
    const tx = VersionedTransaction.deserialize(rawTx);

    tx.sign([BOT_KEYPAIR]);

    const sig = await connection.sendRawTransaction(tx.serialize(), {
      maxRetries: 5,
    });

    log(`🚀 COMPRA EXECUTADA | TX: https://solscan.io/tx/${sig}`);
  } catch (err) {
    log("❌ ERRO NA COMPRA:", err.message);
  }
}

/* ============================================================
   PROCESSAR WEBHOOK HELIUS
============================================================ */
function detectTokenBuy(event) {
  try {
    const accounts = event.accountData;
    const wallet = event.account || null;

    let result = [];

    for (const acc of accounts) {
      // Ignorar se não tem token change
      if (!acc.tokenBalanceChanges || acc.tokenBalanceChanges.length === 0)
        continue;

      for (const change of acc.tokenBalanceChanges) {
        const user = change.userAccount;
        const amount = Number(change.rawTokenAmount.tokenAmount);
        const mint = change.mint;

        // Somente fungível
        const isFungible =
          change.rawTokenAmount.decimals >= 0 &&
          change.rawTokenAmount.decimals <= 12;

        if (!isFungible) continue;

        // Wallet monitorada recebeu token?
        if (MONITORED_WALLETS.includes(user) && amount > 0) {
          result.push({ mint, user, amount });
        }
      }
    }

    return result;
  } catch (err) {
    log("Erro no parser:", err.message);
    return [];
  }
}

/* ============================================================
   WEBHOOK
============================================================ */
app.post("/helius", async (req, res) => {
  res.sendStatus(200);

  const data = req.body;

  if (!Array.isArray(data)) return;

  for (const event of data) {
    const sig = event.signature;

    // evitar loops e duplicados
    if (processedSignatures.has(sig)) continue;
    processedSignatures.add(sig);

    log("===================================================");
    log(">>> RECEBI WEBHOOK");
    log("TX:", sig);

    const buys = detectTokenBuy(event);

    if (buys.length === 0) {
      log("Nenhum token fungível recebido pelas wallets monitoradas.");
      continue;
    }

    for (const b of buys) {
      log(`📥 Wallet ${b.user} comprou token ${b.mint} (${b.amount})`);
      await buy1USDC(b.mint);
    }
  }
});

/* ============================================================
   START SERVER
============================================================ */
const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
  console.log(`🔥 MIROMA COPY BOT ONLINE – PORTA ${PORT} 🔥`);
});


