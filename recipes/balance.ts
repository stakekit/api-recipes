import "cross-fetch/polyfill";

const [, , integrationId, address] = process.argv;

const main = async () => {
  const balances = await fetch(
    `${process.env.API_ENDPOINT}/yields/balances/${integrationId}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": process.env.API_KEY,
      },
      body: JSON.stringify({
        address,
      }),
    }
  ).then((res) => res.json());

  console.log(balances);
};

main();
