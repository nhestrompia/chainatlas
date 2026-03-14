import { describe, expect, it } from "vitest";
import { formatTokenAmount } from "./format-token-amount";

describe("formatTokenAmount", () => {
  it("caps decimals to 3", () => {
    expect(formatTokenAmount("0.7892402774")).toBe("0.789");
  });

  it("formats large values with readable unit names", () => {
    expect(formatTokenAmount("1234567.8912")).toBe("1.235 Million");
    expect(formatTokenAmount("1234000000000")).toBe("1.234 Trillion");
  });

  it("returns source value when input is not numeric", () => {
    expect(formatTokenAmount("not-a-number")).toBe("not-a-number");
  });
});
