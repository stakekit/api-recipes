import * as dotenv from 'dotenv';
import fetch from 'node-fetch';

dotenv.config();

const ENDPOINT = process.env.YIELD_API_ENDPOINT;

/**
 * Makes a POST request to the StakeKit API
 * @param path - API endpoint path
 * @param data - Request body data
 * @returns Promise with the response data
 * @throws Error if the request fails
 */
export const post = async (path: string, data: object) => {
  console.log(`...calling POST ${ENDPOINT}${path}...`);
  console.log(`...with body ${JSON.stringify(data)}...`);

  try {
    const response = await fetch(`${ENDPOINT}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': process.env.YIELD_API_KEY,
      },
      body: JSON.stringify(data),
    });

    const parsed = await response.json();

    if (!response.ok) {
      console.error('API Error:', parsed);
      throw new Error(
        `Request failed: ${response.status} ${response.statusText}`,
      );
    }

    return parsed;
  } catch (error) {
    console.error(`POST request to ${path} failed:`, error);
    throw error;
  }
};

/**
 * Makes a PATCH request to the StakeKit API
 * @param path - API endpoint path
 * @param data - Request body data
 * @returns Promise with the response data
 * @throws Error if the request fails
 */
export const patch = async (path: string, data: object) => {
  console.log(`...calling PATCH ${ENDPOINT}${path}...`);
  console.log(`...with body ${JSON.stringify(data)}...`);
  try {
    const response = await fetch(`${ENDPOINT}${path}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': process.env.API_KEY,
      },
      body: JSON.stringify(data),
    });

    const parsed = await response.json();

    if (!response.ok) {
      console.error('API Error:', parsed);
      throw new Error(
        `Request failed: ${response.status} ${response.statusText}`,
      );
    }

    return parsed;
  } catch (error) {
    console.error(`PATCH request to ${path} failed:`, error);
    throw error;
  }
};

/**
 * Makes a GET request to the StakeKit API
 * @param path - API endpoint path
 * @returns Promise with the response data
 * @throws Error if the request fails
 */
export const get = async (path: string) => {
  console.log(`...calling GET ${ENDPOINT}${path}...`);

  try {
    const response = await fetch(`${ENDPOINT}${path}`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'X-API-KEY': process.env.API_KEY,
      },
    });

    const parsed = await response.json();

    if (!response.ok) {
      console.error('API Error:', parsed);
      throw new Error(
        `Request failed: ${response.status} ${response.statusText}`,
      );
    }

    return parsed;
  } catch (error) {
    console.error(`GET request to ${path} failed:`, error);
    throw error;
  }
};
