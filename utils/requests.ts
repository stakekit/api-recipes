import "cross-fetch/polyfill";

/**
 * Generic HTTP request helper with logging
 */
export async function request<T>(
  baseUrl: string,
  apiKey: string,
  method: string,
  path: string,
  body?: any,
): Promise<T> {
  const url = `${baseUrl}${path}`;

  console.log(`...calling ${method} ${url}...`);
  if (body) {
    console.log(`...with body ${JSON.stringify(body)}...`);
  }

  const headers: Record<string, string> = {
    "x-api-key": apiKey,
    "Content-Type": "application/json",
  };

  const options: RequestInit = {
    method,
    headers,
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  try {
    const response = await fetch(url, options);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("API Error Response:", errorText);

      try {
        const errorJson = JSON.parse(errorText);
        throw new Error(`${JSON.stringify(errorJson)} (Status: ${response.status})`);
      } catch (parseError) {
        throw new Error(`${errorText} (Status: ${response.status})`);
      }
    }

    return response.json();
  } catch (error) {
    console.error(`${method} request to ${path} failed:`, error);
    throw error;
  }
}
