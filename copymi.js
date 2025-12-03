import express from "express";
import axios from "axios";
import "dotenv/config";
import { Connection, VersionedTransaction, Keypair } from "@solana/web3.js";

const app = express();
app.use(express.json());

const connection = new Connection("https://api.mainnet-beta.solana.com");

// ------------------ WALLET ------------------

const PRIVATE_KEY = Uint8Array.from(JSON.parse(process.env.PRIVATE_KEY));
const wallet = Keypair.fromSecretKey(PRIVATE_KEY);

// ------------------ CONSTANTES ------------------

const SOL_MINT = "So11111111111111111111111111111111111111112";

const AMOUNT_IN_SOL = 0.015; // 1.5 - 2 dólares
const TELEGRAM_URL = `https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendMessage`;

// ------------------ FUNÇÕES ------------------

async function sendTelegram(msg) {
  await axios.post(TELEGRAM_URL, {
    chat_id: process.env.TELEGRAM_CHAT,
    text: msg,
    parse_mode: "Markdown"
  });
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

    const quote = await axios.get(
      `https://quote-api.jup.ag/v6/quote?inputMint=${inputMint}&outputMint=${outputMint}&amount=${amount}&slippageBps=300`
    );

    const swapTx = await axios.post(
      "https://quote-api.jup.ag/v6/swap",
      {
        route: quote.data,
        userPublicKey: wallet.publicKey.toBase58(),
      }
    );

    const tx = VersionedTransaction.deserialize(
      Buffer.from(swapTx.data.swapTransaction, "base64")
    );

    tx.sign([wallet]);

    const sig = await connection.sendRawTransaction(tx.serialize());
    return sig;
  } catch (err) {
    console.log("Erro swap:", err);
    return null;
  }
}

// ------------------ WEBHOOK HELIUS ------------------

app.post("/helius", async (req, res) => {
  const tx = req.body[0];

  if (!tx || !tx.tokenTransfers) {
    return res.send("OK");
  }

  const transfers = tx.tokenTransfers;

  const isSwap = tx.instructions.some(i =>
    i.programId.includes("JUP") ||
    i.programId.includes("orca") ||
    i.programId.includes("rayd")
  );

  if (!isSwap) return res.send("OK");

  const mint = transfers[0].mint;

  const info = await getTokenInfo(mint);

  // ------------------ COMPRA ------------------
  if (transfers[0]?.fromUserAccount && transfers[0]?.toUserAccount !== undefined) {

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

🌀 MIROMA ONLINE – Operação replicada.
`
    );
  }

  // ------------------ VENDA ------------------
  if (transfers[0]?.toUserAccount && transfers[0]?.fromUserAccount !== undefined) {

    const sig = await executeSwap(mint, SOL_MINT);

    await sendTelegram(
`💸 *MIROMA SELL MIRROR – VENDA EXECUTADA*

🎨 Token vendido: *$${info.symbol}*
🪙 Mint: \`${mint}\`

💵 Preço: $${info.price}
💧 Liquidez: $${info.liquidity}

🔗 Tx: https://solscan.io/tx/${sig}
🔗 Tx original: https://solscan.io/tx/${tx.signature}

🌀 MIROMA ONLINE – Venda espelhada.
`
    );
  }

  res.send("OK");
});

// ------------------ START ------------------

const PORT = process.env.PORT || 4000;

app.listen(PORT, () => {
  console.log(`🔥 MIROMA COPY BOT ONLINE – PORTA ${PORT} 🔥`);
});


