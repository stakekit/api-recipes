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

  //Specify which yield opportunity and how we want to stake, retrieve the address from our signing wallet instance.
  //Send the stake object to API to construct transactions.
  const response: any = await fetch(`${API_URL}/yields/enter`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": API_KEY,
    },
    body: JSON.stringify({
      integrationId: "ethereum-sushi-xsushi-staking",
      addresses: {
        address: await wallet.getAddress(),
        additionalAddresses: {},
      },
      arguments: {
        amount: "1",
      },
      gasPriceStep: {
        gasMode: "average",
        gasArgs: {},
      },
    }),
  }).then((res) => res.json());

  //In case there are multiple transactions required in order to perform staking operation. We loop over them.
  for (const { tx, network } of response.txs) {
    //Sign transaction with our signing wallet instance
    const signed = await wallet.signTransaction(tx);
    //Submit signed transaction to API
    const result = await fetch(`${API_URL}/chains/submit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        network,
        signed: signed,
      }),
    }).then((res) => res.json());

    //API returns submitted transaction hash and etherscan link
    console.log(result);
  }
};

main();
