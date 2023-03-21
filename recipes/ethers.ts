import { Wallet } from "ethers";
import * as dotenv from "dotenv";
import "cross-fetch/polyfill";
import cli from "cli-ux";

dotenv.config();

const ENDPOINT = process.env.API_ENDPOINT;
const INTEGRATION_ID = "ethereum-matic-native-staking";

const post = async (path: string, data: object) =>
  fetch(`${ENDPOINT}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": process.env.API_KEY,
    },
    body: JSON.stringify(data),
  }).then((res) => res.json());

const get = async (path: string) =>
  fetch(`${ENDPOINT}${path}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "X-API-KEY": process.env.API_KEY,
    },
  }).then((res) => res.json());

async function main() {
  const wallet = await Wallet.fromPhrase(process.env.MNEMONIC);
  const address = await wallet.getAddress();

  const config = await get(`/yields/${INTEGRATION_ID}`);

  console.log("=== Configuration === ");
  console.log("ID:", config.id);
  console.log(`APY: ${(config.apy * 100).toFixed(2)}%`);
  console.log(`Token: ${config.token.symbol} on ${config.token.network}`);
  console.log("=== Configuration end === ");

  const [validators, gas, balance] = await Promise.all([
    get(`/yields/validators/${INTEGRATION_ID}`),
    get(`/network/gas/${config.token.network}`),
    post(`/chains/token_balances`, {
      addresses: [
        {
          network: config.token.network,
          address,
          tokenAddress: config.token.address,
        },
      ],
    }),
  ]);

  const stakedBalance = await post(`/yields/balances/${INTEGRATION_ID}`, {
    address,
    options: { validatorAddresses: validators.map((x) => x.address) },
  });

  console.log("=== Balances ===");

  console.log("Available", config.token.symbol, balance[0].amount);
  console.log("Staked");
  validators.forEach((x) => {
    const balance = stakedBalance.find((y) => y.validatorAddress === x.address);
    console.log(" ", x.name, balance.amount);
  });
  console.log("=== Balances end ===");

  validators.forEach((x, index) => {
    console.log(`(${index}) ${x.name}`);
  });

  const index = await cli.prompt(
    "Which validator would you like to stake with?"
  );

  const validator = validators[index];
  if (!validator) {
    console.log("Invalid validator");
    return;
  }

  const amount = await cli.prompt("How much would you like to stake?");

  let gasPriceStep = {};
  [...gas.modes.values, { name: "custom" }].forEach((g, i) => {
    if (g.name === "custom") {
      console.log(`(${i}) ${g.name}`);
    } else {
      console.log(`(${i}) ${g.name} (${g.value} ${gas.modes.denom})`);
    }
  });
  const gasModeIndex = await cli.prompt(
    `Which gas mode would you like to execute with (${gas.modes.denom})?`
  );
  const gasMode = gas.modes.values[gasModeIndex];

  if (gasMode.name === "custom") {
    const opts = { gasMode: gasMode.name, gasArgs: {} };
    for (let i = 0; i < gas.suggestedValues.length; i++) {
      const { name, recommendValue, units } = gas.suggestedValues[i];
      const input = await cli.prompt(`Input ${name} (${units})`, {
        default: recommendValue,
      });
      opts.gasArgs[name] = input;
    }
    gasPriceStep = opts;
  } else {
    gasPriceStep = { gasMode: gasMode.name };
  }

  const enter = await post("/yields/enter", {
    integrationId: INTEGRATION_ID,
    addresses: {
      address: await wallet.getAddress(),
    },
    arguments: {
      amount,
      validatorAddress: validator.address,
    },
    gasPriceStep,
  });

  console.log(enter.txs.length, "transactions to sign");

  let lastTx = null;
  for (const { tx, network } of enter.txs) {
    const signed = await wallet.signTransaction(JSON.parse(tx));
    const result = await post(`/chains/submit`, {
      network,
      signed,
    });
    lastTx = result;
  }
  while (true) {
    const result = await get(
      `/transaction/status/${config.token.network}/${lastTx.transactionHash}`
    );
    if (result.status === "SUCCESS") {
      console.log(lastTx.link);
      break;
    } else {
      console.log("Pending...");
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}
main();
