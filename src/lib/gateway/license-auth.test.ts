import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { isAuthorizedControlPlane } from "./license-auth";

describe("isAuthorizedControlPlane", () => {
  const ORIGINAL = process.env.LICENSE_CONTROL_SECRET;

  beforeEach(() => {
    process.env.LICENSE_CONTROL_SECRET = "s3cr3t-control-plane-value";
  });
  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.LICENSE_CONTROL_SECRET;
    else process.env.LICENSE_CONTROL_SECRET = ORIGINAL;
  });

  it("aceita o segredo correto", () => {
    expect(isAuthorizedControlPlane("s3cr3t-control-plane-value")).toBe(true);
  });

  it("rejeita segredo errado (mesmo tamanho)", () => {
    expect(isAuthorizedControlPlane("s3cr3t-control-plane-WRONG")).toBe(false);
  });

  it("rejeita segredo de tamanho diferente", () => {
    expect(isAuthorizedControlPlane("curto")).toBe(false);
  });

  it("rejeita header ausente (null)", () => {
    expect(isAuthorizedControlPlane(null)).toBe(false);
  });

  it("rejeita string vazia", () => {
    expect(isAuthorizedControlPlane("")).toBe(false);
  });

  it("fail-closed quando o segredo não está no ambiente", () => {
    delete process.env.LICENSE_CONTROL_SECRET;
    expect(isAuthorizedControlPlane("qualquer-coisa")).toBe(false);
  });
});
