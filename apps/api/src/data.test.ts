import { describe, expect, it } from "vitest";
import { listProtocolRegistry } from "./data";

describe("api data adapters", () => {
  it("returns the protocol registry", () => {
    expect(listProtocolRegistry().length).toBeGreaterThan(0);
  });
});
