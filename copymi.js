import express from "express";
import bodyParser from "body-parser";
import axios from "axios";
import {
  Connection,
  Keypair,
  VersionedTransaction,
} from "@solana/web3.js";

const app = express();
app.use(bodyParser.json());

/* ============================================================
   CONFIGURAÇÃO
============================================================ */
const HELIUS_RPC = `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API}`;
const connection = new Connection(HELIUS_RPC);

const BOT_PRIVATE_KEY = Uint8Array.from(JSON.parse(process.env.PRIVATE_KEY));
const BOT_KEYPAIR = Keypair.fromSecretKey(BOT_PRIVATE_KEY);
const BOT_PUBLIC = BOT_KEYPAIR.publicKey.toBase58();

const MONITORED_WALLETS = process.env.WALLETS
  ? process.env.WALLETS.split(",").map((w) => w.trim())
  : [];

// Jupiter endpoints corretos
const JUPITER_QUOTE = "https://api.jup.ag/quote";
const JUPITER_SWAP = "https://api.jup.ag/swap";

let processedSignatures = new Set();

/* ============================================================
   LOG
============================================================ */
function log(...msg) {
  console.log("\n>>>", ...msg);
}

/* ============================================================
   FUNÇÃO PARA COMPRAR 1 USDC DO TOKEN DETECTADO
============================================================ */
async function buy1USDC(mint) {
  try {
    log(`🔍 Copiando compra: 1 USDC → ${mint}`);

    const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
    const amount = 1_000_000; // 1 USDC

    /* =====================
       1 - QUOTE
    ====================== */
    const { data: quote } = await axios.get(JUPITER_QUOTE, {
      params: {
        inputMint: USDC,
        outputMint: mint,
        amount,
        slippageBps: 2000, // 20% para memecoins voláteis
      },
      headers: {
        "x-api-key": process.env.JUPITER_API_KEY,
      },
    });

    if (!quote || !quote.outAmount) {
      log("❌ Nenhuma rota encontrada para essa compra.");
      return;
    }

    /* =====================
       2 - SWAP
    ====================== */
    const { data: swap } = await axios.post(
      JUPITER_SWAP,
      {
        quoteResponse: quote,
        userPublicKey: BOT_PUBLIC,
        dynamicSlippage: true,
        wrapAndUnwrapSol: true,
      },
      {
        headers: {
          "x-api-key": process.env.JUPITER_API_KEY,
        },
      }
    );

    const raw = Buffer.from(swap.swapTransaction, "base64");
    const tx = VersionedTransaction.deserialize(raw);

    tx.sign([BOT_KEYPAIR]);

    const sig = await connection.sendRawTransaction(tx.serialize(), {
      skipPreflight: true,
      maxRetries: 5,
    });

    log(`🚀 Compra executada com sucesso!`);
    log(`🔗 https://solscan.io/tx/${sig}`);
  } catch (err) {
    if (err.response?.data)
      log("❌ ERRO NA COMPRA:", err.response.data);
    else log("❌ ERRO NA COMPRA:", err.message);
  }
}

/* ============================================================
   DETECTAR COMPRAS DE TOKENS FUNGÍVEIS NAS WALLETS
============================================================ */
function detectTokenBuy(event) {
  try {
    const accounts = event.accountData;

    let results = [];

    for (const acc of accounts) {
      if (!acc.tokenBalanceChanges?.length) continue;

      for (const c of acc.tokenBalanceChanges) {
        const user = c.userAccount;
        const mint = c.mint;
        const amount = Number(c.rawTokenAmount.tokenAmount);

        const fungible = c.rawTokenAmount.decimals <= 12;

        if (fungible && amount > 0 && MONITORED_WALLETS.includes(user)) {
          results.push({ user, mint, amount });
        }
      }
    }

    return results;
  } catch (err) {
    log("Erro detectTokenBuy:", err.message);
    return [];
  }
}

/* ============================================================
   WEBHOOK HELIUS
============================================================ */
app.post("/helius", async (req, res) => {
  res.sendStatus(200);

  const events = req.body;
  if (!Array.isArray(events)) return;

  for (const event of events) {
    const sig = event.signature;

    // Proteção anti duplicação
    if (processedSignatures.has(sig)) continue;
    processedSignatures.add(sig);

    log("===================================================");
    log(">>> RECEBI WEBHOOK");
    log("TX:", sig);

    const buys = detectTokenBuy(event);

    if (!buys.length) {
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
   START SERVER
============================================================ */
const PORT = process.env.PORT || 8080;
app.listen(PORT, () =>
  console.log(`🔥 MIROMA COPY BOT ONLINE – PORTA ${PORT} 🔥`)
);





