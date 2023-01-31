import { getSigningWallet, ImportableWallets } from "@steakwallet/signers";
import fetch from "node-fetch";

require("dotenv").config();

const main = async () => {
  const API_URL = process.env.API_URL;

  const walletConfig = {
    mnemonic: process.env.SEED_PHRASE,
    walletType: ImportableWallets.Steakwallet,
    index: 0,
  };

  //Set up the signing wallet instance with mnemonic seed
  const wallet = await getSigningWallet("ethereum" as any, walletConfig);
  const balances = await fetch(`${API_URL}/v1/balances`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      addresses: [
        {
          network: "ethereum",
          address: await wallet.getAddress(),
          tokenAddress: "0x6b3595068778dd592e39a122f4f5a5cf09c90fe2", //sushi balance
        },
      ],
    }),
  }).then((res) => res.json());

  console.log("Available:", balances[0].balances.available);
  for (const derivative of balances[0].derivatives) {
    console.log(derivative.yield.id, derivative.balances);
  }
};

main();
