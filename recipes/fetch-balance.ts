import { getSigningWallet, ImportableWallets } from "@steakwallet/signers";
import fetch from "node-fetch";

require("dotenv").config();

const main = async () => {
  const API_URL = process.env.API_URL;
  const API_KEY = process.env.API_KEY;

  const walletConfig = {
    mnemonic: process.env.SEED_PHRASE,
    walletType: ImportableWallets.Steakwallet,
    index: 0,
  };

  //Set up the signing wallet instance with mnemonic seed
  const wallet = await getSigningWallet("ethereum" as any, walletConfig);
  const balances = await fetch(
    `${API_URL}/yields/balances/ethereum-ape-native-staking`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": API_KEY,
      },
      body: JSON.stringify({
        address: await wallet.getAddress(),
      }),
    }
  ).then((res) => res.json());

  console.log(balances);
};

main();
