import { describe, it, expect } from "vitest";
import { parseSendResult } from "./central-client";

describe("parseSendResult", () => {
  it("lê messageId string", () => {
    expect(parseSendResult({ ok: true, messageId: "UZ1" })).toEqual({ messageId: "UZ1" });
  });
  it("sem messageId → undefined", () => {
    expect(parseSendResult({ ok: true })).toEqual({ messageId: undefined });
    expect(parseSendResult({ messageId: 123 })).toEqual({ messageId: undefined });
  });
});
