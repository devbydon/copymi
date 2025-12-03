import express from "express";
import axios from "axios";
import "dotenv/config";
import { Connection, VersionedTransaction, Keypair } from "@solana/web3.js";

const app = express();
app.use(express.json({ limit: "5mb" }));

// ------------------ SOLANA CONNECTION ------------------

const connection = new Connection("https://api.mainnet-beta.solana.com");

// ------------------ WALLET DO COPYMI ------------------

const PRIVATE_KEY = Uint8Array.from(JSON.parse(process.env.PRIVATE_KEY));
const wallet = Keypair.fromSecretKey(PRIVATE_KEY);

// ------------------ CONSTANTES ------------------

const SOL_MINT = "So11111111111111111111111111111111111111112";

// Valor da cópia: ~1 a 2 dólares
const AMOUNT_IN_SOL = 0.015;

// Telegram
const TELEGRAM_URL = `https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendMessage`;

// ------------------ FUNÇÕES UTILITÁRIAS ------------------

async function sendTelegram(msg) {
  try {
    await axios.post(TELEGRAM_URL, {
      chat_id: process.env.TELEGRAM_CHAT,
      text: msg,
      parse_mode: "Markdown"
    });
  } catch (err) {
    console.error("Erro Telegram:", err);
  }
}

async function getTokenInfo(mint) {
  try {
    const { data } = await axios.get(
      `https://public-api.birdeye.so/defi/token_overview?address=${mint}`,
      { headers: { "X-API-KEY": "public" } }
    );

    return {
      price: data?.data?.price || "N/A",
      liquidity: data?.data?.liquidity || "N/A",
      mc: data?.data?.mc || "N/A",
      vol5m: data?.data?.v_5m || "N/A",
      symbol: data?.data?.symbol || "???"
    };
  } catch {
    return { price: "N/A", liquidity: "N/A", mc: "N/A", vol5m: "N/A", symbol: "???" };
  }
}

async function executeSwap(inputMint, outputMint) {
  try {
    const amount = AMOUNT_IN_SOL * 1e9;

    const { data: quote } = await axios.get(
      `https://quote-api.jup.ag/v6/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=300`
    );

    const { data: swap } = await axios.post(
      "https://quote-api.jup.ag/v6/swap",
      {
        route: quote,
        userPublicKey: wallet.publicKey.toBase58(),
      }
    );

    const tx = VersionedTransaction.deserialize(
      Buffer.from(swap.swapTransaction, "base64")
    );

    tx.sign([wallet]);

    const sig = await connection.sendRawTransaction(tx.serialize());
    return sig;

  } catch (err) {
    console.error("Erro no swap:", err.message);
    return null;
  }
}

// ------------------ WEBHOOK HELIUS ------------------

app.post("/helius", async (req, res) => {
  try {
    const tx = Array.isArray(req.body) ? req.body[0] : req.body;

    console.log(">>> RECEBI WEBHOOK");
    console.log("RAW BODY:", JSON.stringify(req.body, null, 2));
    console.log("TX:", JSON.stringify(tx, null, 2));

    if (!tx) return res.status(200).send("NO_TX");

    const transfers = tx.tokenTransfers || [];
    const instructions = tx.instructions || [];

    console.log(">>> TRANSFERS:", transfers);
    console.log(">>> INSTRUCTIONS:", instructions);

    const isSwap = instructions.some(i =>
      `${i.programId}`.toLowerCase().includes("jup") ||
      `${i.programId}`.toLowerCase().includes("rayd") ||
      `${i.programId}`.toLowerCase().includes("orca")
    );

    console.log(">>> ISSWAP:", isSwap);

    if (!isSwap) return res.status(200).send("NOT_SWAP");

    if (transfers.length === 0) return res.status(200).send("NO_TRANSFERS");

    const mint = transfers[0].mint;

    console.log(">>> MINT DETECTADO:", mint);

    const info = await getTokenInfo(mint);

    const fromUser = transfers[0]?.fromUserAccount;
    const toUser = transfers[0]?.toUserAccount;

    // COMPRA
    if (fromUser && toUser) {
      console.log(">>> DETECTEI COMPRA");
      const sig = await executeSwap(SOL_MINT, mint);
      console.log(">>> SWAP EXECUTADO:", sig);
    }

    // VENDA
    if (toUser && fromUser) {
      console.log(">>> DETECTEI VENDA");
      const sig = await executeSwap(mint, SOL_MINT);
      console.log(">>> SWAP EXECUTADO:", sig);
    }

    return res.status(200).send("OK");

  } catch (err) {
    console.error("Webhook Error:", err);
    return res.status(200).send("ERROR");
  }
});


    // ------------------ COMPRA ------------------
    if (fromUser && toUser) {
      const sig = await executeSwap(SOL_MINT, mint);

      await sendTelegram(
`⚡ *MIROMA COPY TRADE – COMPRA EXECUTADA* ⚡

🎨 Token: *$${info.symbol}*
🪙 Mint: \`${mint}\`

💵 Preço: $${info.price}
📊 Market Cap: $${info.mc}
💧 Liquidez: $${info.liquidity}
📈 Volume (5m): $${info.vol5m}

💰 Cópia: *~$2*
🔗 Tx: https://solscan.io/tx/${sig}
🔗 Tx original: https://solscan.io/tx/${tx.signature}

🌀 MIROMA ONLINE – Operação replicada.`
      );
    }

    // ------------------ VENDA ------------------
    if (toUser && fromUser) {
      const sig = await executeSwap(mint, SOL_MINT);

      await sendTelegram(
`💸 *MIROMA SELL MIRROR – VENDA EXECUTADA*

🎨 Token vendido: *$${info.symbol}*
🪙 Mint: \`${mint}\`

💵 Preço: $${info.price}
💧 Liquidez: $${info.liquidity}

🔗 Tx: https://solscan.io/tx/${sig}
🔗 Tx original: https://solscan.io/tx/${tx.signature}

🌀 MIROMA ONLINE – Venda espelhada.`
      );
    }

    return res.status(200).send("OK");

  } catch (err) {
    console.error("Webhook Error:", err);
    return res.status(200).send("ERROR");
  }
});

// ------------------ START ------------------

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`🔥 MIROMA COPY BOT ONLINE – PORTA ${PORT} 🔥`);
});



