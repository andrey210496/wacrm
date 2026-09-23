import { describe, it, expect, vi } from "vitest";
import { resolveCoexMediaUrl } from "./coex-media";

const info = { url: "https://cdn/x", mimeType: "image/jpeg", fileSize: 1000 };

describe("resolveCoexMediaUrl", () => {
  it("espelha e retorna a URL durável do bucket quando accountId presente", async () => {
    const getInfo = vi.fn(async () => info);
    const mirror = vi.fn(async () => "https://bucket/mirrored.jpg");
    const url = await resolveCoexMediaUrl({
      mediaId: "M1",
      accessToken: "tok",
      accountId: "acc",
      storage: {} as never,
      fileName: "nf.pdf",
      messageTimestamp: 123,
      getInfo: getInfo as never,
      mirror: mirror as never,
    });
    expect(url).toBe("https://bucket/mirrored.jpg");
    expect(getInfo).toHaveBeenCalledWith({ mediaId: "M1", accessToken: "tok" });
    expect(mirror).toHaveBeenCalledTimes(1);
  });

  it("fallback pro proxy quando o espelho retorna null", async () => {
    const url = await resolveCoexMediaUrl({
      mediaId: "M2",
      accessToken: "tok",
      accountId: "acc",
      storage: {} as never,
      getInfo: (async () => info) as never,
      mirror: (async () => null) as never,
    });
    expect(url).toBe("/api/whatsapp/media/M2");
  });

  it("sem accountId (espelho desligado) → proxy direto, não chama mirror", async () => {
    const mirror = vi.fn(async () => "x");
    const url = await resolveCoexMediaUrl({
      mediaId: "M3",
      accessToken: "tok",
      accountId: null,
      storage: {} as never,
      getInfo: (async () => info) as never,
      mirror: mirror as never,
    });
    expect(url).toBe("/api/whatsapp/media/M3");
    expect(mirror).not.toHaveBeenCalled();
  });

  it("getInfo lança → null (best-effort, nunca derruba o webhook)", async () => {
    const url = await resolveCoexMediaUrl({
      mediaId: "M4",
      accessToken: "tok",
      accountId: "acc",
      storage: {} as never,
      getInfo: (async () => {
        throw new Error("boom");
      }) as never,
      mirror: (async () => "x") as never,
    });
    expect(url).toBeNull();
  });
});
