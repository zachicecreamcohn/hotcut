import ms from "ms";
import { z } from "zod";

export const Duration = z
  .string()
  .refine((v) => safeMs(v) !== null, {
    message: "must be a duration like '200ms', '5s', or '30s'",
  });

export function toMs(value: string): number {
  const result = safeMs(value);
  if (result === null) {
    throw new Error(`invalid duration: ${JSON.stringify(value)}`);
  }
  return result;
}

function safeMs(value: string): number | null {
  try {
    const result = ms(value as ms.StringValue);
    return typeof result === "number" ? result : null;
  } catch {
    return null;
  }
}
