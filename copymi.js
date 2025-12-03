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

const JUPITER_QUOTE = "https://api.jup.ag/quote";
const JUPITER_SWAP = "https://api.jup.ag/swap";

/* ============================================================
   LOG
============================================================ */
function log(...msg) {
  console.log("\n>>>", ...msg);
}

/* ============================================================
   SWAP GENÉRICO (com retry automático)
============================================================ */
async function executeSwap(inputMint, outputMint, amount, mode) {
  try {
    const { data: quote } = await axios.get(JUPITER_QUOTE, {
      params: {
        inputMint,
        outputMint,
        amount,
        slippageBps: 2000,
      },
      headers: {
        "x-api-key": process.env.JUPITER_API_KEY,
      },
    });

    if (!quote || !quote.outAmount) {
      log(`❌ Nenhuma rota encontrada (${mode})`);
      return null;
    }

    const { data: swap } = await axios.post(
      JUPITER_SWAP,
      {
        quoteResponse: quote,
        userPublicKey: BOT_PUBLIC,
        wrapAndUnwrapSol: true,
        dynamicSlippage: true,
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

    log(`🚀 SWAP EXECUTADO (${mode}): https://solscan.io/tx/${sig}`);
    return sig;

  } catch (err) {
    log(`Erro (${mode}):`, err.response?.data || err.message);
    return null;
  }
}

/* ============================================================
   COMPRAR O TOKEN COPIADO (LÓGICA HÍBRIDA)
============================================================ */
async function copyTrade(mint) {
  log(`🔍 Tentando copiar compra do token: ${mint}`);

  const USDC = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
  const SOL = "So11111111111111111111111111111111111111112";

  /* ======================
     1 - TENTAR USDC → token
  ======================= */
  const sigUSDC = await executeSwap(
    USDC,
    mint,
    1_000_000,       // 1 USDC
    "USDC → TOKEN"
  );

  if (sigUSDC) return; // deu certo!

  /* ======================
     2 - TENTAR SOL → token
  ======================= */
  const sigSOL = await executeSwap(
    SOL,
    mint,
    10000000,         // 0.01 SOL
    "SOL → TOKEN"
  );

  if (sigSOL) return;

  log("⚠ Nenhuma rota encontrada nem com USDC, nem com SOL. Ignorando.");
}

/* ============================================================
   DETECTAR COMPRAS FUNGÍVEIS
============================================================ */
function detectTokenBuy(event) {
  const results = [];

  try {
    for (const acc of event.accountData) {
      if (!acc.tokenBalanceChanges) continue;

      for (const c of acc.tokenBalanceChanges) {
        const isFungible = c.rawTokenAmount.decimals <= 12;
        const amount = Number(c.rawTokenAmount.tokenAmount);
        const user = c.userAccount;

        if (isFungible && amount > 0 && MONITORED_WALLETS.includes(user)) {
          results.push({
            user,
            mint: c.mint,
            amount,
          });
        }
      }
    }
  } catch (err) {
    log("Erro detectTokenBuy:", err.message);
  }

  return results;
}

/* ============================================================
   WEBHOOK HELIUS
============================================================ */
const seen = new Set();

app.post("/helius", async (req, res) => {
  res.sendStatus(200);

  const events = req.body;
  if (!Array.isArray(events)) return;

  for (const event of events) {
    const sig = event.signature;

    if (seen.has(sig)) continue;
    seen.add(sig);

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
      await copyTrade(b.mint);
    }
  }
});

/* ============================================================
   START
============================================================ */
const PORT = process.env.PORT || 8080;
app.listen(PORT, () =>
  console.log(`🔥 MIROMA COPY BOT ONLINE – PORTA ${PORT} 🔥`)
);






