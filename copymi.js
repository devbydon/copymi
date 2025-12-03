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
   CONFIG
============================================================ */
const HELIUS_RPC = `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API}`;
const connection = new Connection(HELIUS_RPC);

const BOT_PRIVATE_KEY = Uint8Array.from(JSON.parse(process.env.PRIVATE_KEY));
const BOT_KEYPAIR = Keypair.fromSecretKey(BOT_PRIVATE_KEY);
const BOT_PUBLIC = BOT_KEYPAIR.publicKey.toBase58();

const MONITORED_WALLETS = process.env.WALLETS
  ? process.env.WALLETS.split(",").map(w => w.trim())
  : [];

// NOVOS ENDPOINTS CORRETOS DA JUPITER
const JUPITER_QUOTE = "https://api.jup.ag/swap/v1/quote";
const JUPITER_SWAP = "https://api.jup.ag/swap/v1/swap";

let processedSignatures = new Set();

/* ============================================================
   LOG
============================================================ */
function log(...msg) {
  console.log("\n>>>", ...msg);
}

/* ============================================================
   FUNÇÃO DE COMPRA — BUY 1 USDC EM QUALQUER TOKEN
============================================================ */
async function buy1USDC(mint) {
  try {
    log(`🔍 Copiando compra: 1 USDC → ${mint}`);

    const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
    const amount = 1_000_000; // 1 USDC

    // QUOTE
    const { data: quote } = await axios.get(JUPITER_QUOTE, {
      params: {
        inputMint: USDC,
        outputMint: mint,
        amount,
        slippageBps: 1500, // 15% slippage universal para tokens novos
      },
    });

    if (!quote || !quote.outAmount) {
      log("❌ Sem rota disponível para compra desse token");
      return;
    }

    // BUILT TX
    const { data: swap } = await axios.post(JUPITER_SWAP, {
      quoteResponse: quote,
      userPublicKey: BOT_PUBLIC,
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      dynamicSlippage: true,
    });

    const raw = Buffer.from(swap.swapTransaction, "base64");
    const tx = VersionedTransaction.deserialize(raw);
    tx.sign([BOT_KEYPAIR]);

    const signature = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: true,
      maxRetries: 5,
    });

    log(`🚀 COMPRA EFETUADA: https://solscan.io/tx/${signature}`);
  } catch (err) {
    log("❌ ERRO NA COMPRA:", err.message);
  }
}

/* ============================================================
   DETECTAR COMPRA FUNGÍVEL EM QUALQUER DEX
============================================================ */
function detectTokenBuy(event) {
  try {
    let result = [];

    for (const acc of event.accountData) {
      if (!acc.tokenBalanceChanges || acc.tokenBalanceChanges.length === 0)
        continue;

      for (const change of acc.tokenBalanceChanges) {
        const user = change.userAccount;
        const amount = Number(change.rawTokenAmount.tokenAmount);
        const mint = change.mint;

        // Apenas tokens fungíveis
        const decimals = change.rawTokenAmount.decimals;
        const isFungible = decimals >= 0 && decimals <= 12;

        if (!isFungible) continue;

        // Wallet monitorada recebeu token?
        if (MONITORED_WALLETS.includes(user) && amount > 0) {
          result.push({ mint, user, amount });
        }
      }
    }
    return result;
  } catch (err) {
    log("❌ Erro parser:", err.message);
    return [];
  }
}

/* ============================================================
   WEBHOOK HELIUS
============================================================ */
app.post("/helius", async (req, res) => {
  res.sendStatus(200);

  const data = req.body;
  if (!Array.isArray(data)) return;

  for (const event of data) {
    const sig = event.signature;

    if (processedSignatures.has(sig)) continue;
    processedSignatures.add(sig);

    log("===================================================");
    log(">>> RECEBI WEBHOOK");
    log("TX:", sig);

    const buys = detectTokenBuy(event);

    if (buys.length === 0) {
      log("Nenhuma compra fungível detectada.");
      continue;
    }

    for (const b of buys) {
      log(`📥 Wallet ${b.user} comprou ${b.amount} do token ${b.mint}`);
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


