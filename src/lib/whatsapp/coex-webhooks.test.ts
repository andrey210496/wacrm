import { describe, it, expect } from "vitest";
import {
  parseMessageEchoes,
  parseHistory,
  parseAppStateSync,
  coexContentType,
  extractCoexContent,
  mapHistoryStatus,
} from "./coex-webhooks";

describe("coexContentType / extractCoexContent / mapHistoryStatus", () => {
  it("normaliza tipos e mapeia sticker→image, desconhecido→text", () => {
    expect(coexContentType("text")).toBe("text");
    expect(coexContentType("sticker")).toBe("image");
    expect(coexContentType("contacts")).toBe("text");
    expect(coexContentType(undefined)).toBe("text");
  });
  it("extrai texto/legenda e marcador pra mídia sem legenda", () => {
    expect(extractCoexContent({ type: "text", text: { body: "oi" } })).toBe("oi");
    expect(extractCoexContent({ type: "image", image: { caption: "foto" } })).toBe("foto");
    expect(extractCoexContent({ type: "image" })).toBe("[image]");
    expect(extractCoexContent({ type: "document", document: { filename: "nf.pdf" } })).toBe("nf.pdf");
  });
  it("mapeia status do history", () => {
    expect(mapHistoryStatus("READ")).toBe("read");
    expect(mapHistoryStatus("DELIVERED")).toBe("delivered");
    expect(mapHistoryStatus(undefined)).toBe("delivered");
  });
});

describe("parseMessageEchoes", () => {
  it("normaliza echoes (outbound, contato = to)", () => {
    const value = {
      metadata: { phone_number_id: "PN" },
      message_echoes: [
        { from: "5511999", to: "5511888", id: "wamid.A", timestamp: "1739321024", type: "text", text: { body: "olá" } },
        { from: "5511999", to: "5511777", id: "wamid.B", timestamp: "1739321099", type: "image", image: { caption: "veja" } },
      ],
    };
    const out = parseMessageEchoes(value);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ metaId: "wamid.A", contactPhone: "5511888", contentType: "text", contentText: "olá" });
    expect(out[1]).toMatchObject({ metaId: "wamid.B", contactPhone: "5511777", contentType: "image", contentText: "veja" });
  });
  it("ignora echo sem id ou sem to", () => {
    expect(parseMessageEchoes({ message_echoes: [{ from: "x", type: "text" }] })).toEqual([]);
    expect(parseMessageEchoes({})).toEqual([]);
  });
});

describe("parseHistory", () => {
  it("direção in/out pelo from, contato = thread.id, status do history_context", () => {
    const value = {
      history: [
        {
          metadata: { phase: 0, chunk_order: 1, progress: 50 },
          threads: [
            {
              id: "5511888",
              messages: [
                { from: "5511999", id: "wamid.OUT", timestamp: "1739230955", type: "text", text: { body: "resposta" }, history_context: { status: "READ" } },
                { from: "5511888", id: "wamid.IN", timestamp: "1739230900", type: "text", text: { body: "pergunta" } },
              ],
            },
          ],
        },
      ],
    };
    const out = parseHistory(value, "5511999");
    expect(out).toHaveLength(2);
    const bizMsg = out.find((m) => m.metaId === "wamid.OUT")!;
    expect(bizMsg.direction).toBe("out");
    expect(bizMsg.contactPhone).toBe("5511888");
    expect(bizMsg.status).toBe("read");
    const userMsg = out.find((m) => m.metaId === "wamid.IN")!;
    expect(userMsg.direction).toBe("in");
  });
  it("history vazio → []", () => {
    expect(parseHistory({}, "5511999")).toEqual([]);
  });
});

describe("parseAppStateSync", () => {
  it("só action add vira contato; remove é ignorado", () => {
    const value = {
      state_sync: [
        { type: "contact", action: "add", contact: { full_name: "Pablo Morales", first_name: "Pablo", phone_number: "16505551234" } },
        { type: "contact", action: "remove", contact: { phone_number: "16505550000" } },
      ],
    };
    const out = parseAppStateSync(value);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ phone: "16505551234", name: "Pablo Morales" });
  });
  it("sem telefone → ignora", () => {
    expect(parseAppStateSync({ state_sync: [{ type: "contact", action: "add", contact: {} }] })).toEqual([]);
  });
});
