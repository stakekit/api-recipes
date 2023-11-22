import * as dotenv from "dotenv";

dotenv.config();

const ENDPOINT = process.env.API_ENDPOINT;

export const post = async (path: string, data: object) => {
  console.log(`...calling POST ${ENDPOINT}${path}...`)
  return fetch(`${ENDPOINT}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": process.env.API_KEY,
    },
    body: JSON.stringify(data),
  }).then(async (res) => {
    const parsed = await res.json()
    if (!res.ok) {
      console.log(parsed)
      throw new Error(res.statusText)
    }
    return parsed
  });
}


export const patch = async (path: string, data: object) => {
  console.log(`...calling PATCH ${ENDPOINT}${path}...`)
  return fetch(`${ENDPOINT}${path}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": process.env.API_KEY,
    },
    body: JSON.stringify(data),
  }).then(async (res) => {
    const parsed = await res.json()

    if (!res.ok) {
      console.log(parsed)
      throw new Error(res.statusText)
    }
    return parsed
  });
}


export const get = async (path: string) => {
  console.log(`...calling GET ${ENDPOINT}${path}...`)
  return fetch(`${ENDPOINT}${path}`, {
    method: "GET",
    headers: {
      Accept: "application/json",
      "X-API-KEY": process.env.API_KEY,
    },
  }).then(async (res) => {
    const parsed = await res.json()

    if (!res.ok) {
      console.log(parsed)
      throw new Error(res.statusText)
    }
    return parsed
  });
}

