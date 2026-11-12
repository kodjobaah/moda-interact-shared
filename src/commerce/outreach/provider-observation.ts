import { createHash } from "node:crypto";

/** Meta observations contain provider components, not the authoring/binding envelope. */
export function providerObservationHash(value: unknown): string | null {
    function canonical(input: unknown, depth = 0): string {
        if (depth > 16) throw new Error("Observation nesting exceeds bound");
        if (Array.isArray(input)) return `[${input.map(item => canonical(item, depth + 1)).join(",")}]`;
        if (input !== null && typeof input === "object") {
            const record = input as Record<string, unknown>;
            return `{${Object.keys(record).filter(key => key !== "example").sort()
                .map(key => `${JSON.stringify(key)}:${canonical(record[key], depth + 1)}`).join(",")}}`;
        }
        const encoded = JSON.stringify(input);
        if (encoded === undefined) throw new Error("Invalid observation value");
        return encoded;
    }
    try {
        const content = canonical(value);
        if (content.length > 32768) return null;
        return createHash("sha256").update(content, "utf8").digest("hex");
    } catch { return null; }
}
