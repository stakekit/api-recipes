import "cross-fetch/polyfill";

const normalizeKey = (key: string) => key.toLowerCase().replace(/[-_]/g, "");

const SENSITIVE_KEYS = new Set([
  "signedpayload",
  "signedtransaction",
  "signature",
  "privatekey",
  "mnemonic",
  "secret",
  "password",
  "accesstoken",
  "authtoken",
  "authorization",
  "refreshtoken",
]);

function redactSensitive(obj: unknown): unknown {
  if (typeof obj !== "object" || obj === null) return obj;
  if (Array.isArray(obj)) return obj.map(redactSensitive);

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (SENSITIVE_KEYS.has(normalizeKey(key))) {
      result[key] = "[REDACTED]";
    } else if (typeof value === "object" && value !== null) {
      result[key] = redactSensitive(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

export interface RequestOptions {
  /** Throw ApiError without logging the raw error body. */
  silentError?: boolean;
}

/**
 * Generic HTTP request helper with logging
 */
export async function request<T>(
  baseUrl: string,
  apiKey: string,
  method: string,
  path: string,
  body?: any,
  options?: RequestOptions,
): Promise<T> {
  const url = `${baseUrl}${path}`;

  console.log(`...calling ${method} ${url}...`);
  if (body) {
    console.log(`...with body ${JSON.stringify(redactSensitive(body))}...`);
  }

  const headers: Record<string, string> = {
    "x-api-key": apiKey,
    "Content-Type": "application/json",
  };

  const init: RequestInit = {
    method,
    headers,
  };

  if (body) {
    init.body = JSON.stringify(body);
  }

  try {
    const response = await fetch(url, init);

    if (!response.ok) {
      const errorText = await response.text();
      let parsed: unknown = errorText;
      try {
        parsed = JSON.parse(errorText);
      } catch {
        parsed = errorText;
      }

      if (options?.silentError) {
        const message =
          parsed &&
          typeof parsed === "object" &&
          "message" in parsed &&
          typeof parsed.message === "string"
            ? parsed.message
            : `Request failed (${response.status})`;
        throw new ApiError(response.status, parsed, message);
      }

      console.error("API Error Response:", errorText);
      throw new Error(`${errorText} (Status: ${response.status})`);
    }

    return response.json();
  } catch (error) {
    if (!options?.silentError) {
      console.error(`${method} request to ${path} failed:`, error);
    }
    throw error;
  }
}
