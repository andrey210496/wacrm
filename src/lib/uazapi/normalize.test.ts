import { describe, it, expect } from "vitest";
import { normalizeUazapiInbound } from "./normalize";

describe("normalizeUazapiInbound", () => {
  it("mensagem de texto (envelope { message })", () => {
    const r = normalizeUazapiInbound({
      message: {
        messageid: "M1",
        sender: "5511999998888@s.whatsapp.net",
        sender_pn: "+55 11 99999-8888",
        senderName: "Ana",
        fromMe: false,
        messageType: "conversation",
        text: "oi",
        messageTimestamp: "1700000000",
      },
    });
    expect(r).toMatchObject({
      fromPhone: "5511999998888",
      fromName: "Ana",
      fromMe: false,
      type: "text",
      text: "oi",
      messageId: "M1",
      timestamp: 1700000000,
    });
  });

  it("Message direta (sem envelope) + mídia imagem", () => {
    const r = normalizeUazapiInbound({
      id: "M2",
      sender: "5511888887777",
      messageType: "imageMessage",
      content: "legenda",
      fileURL: "https://cdn/x.jpg",
      fromMe: false,
    });
    expect(r).toMatchObject({
      type: "image",
      text: "legenda",
      mediaUrl: "https://cdn/x.jpg",
      messageId: "M2",
      fromPhone: "5511888887777",
    });
  });

  it("echo (fromMe) é marcado — inbound deve ignorar", () => {
    const r = normalizeUazapiInbound({ message: { fromMe: true, sender: "551199", messageType: "conversation", text: "x" } });
    expect(r?.fromMe).toBe(true);
  });

  it("payload inválido → null", () => {
    expect(normalizeUazapiInbound(null)).toBeNull();
    expect(normalizeUazapiInbound("nope")).toBeNull();
  });

  it("prioriza sender_pn sobre sender pro telefone", () => {
    const r = normalizeUazapiInbound({
      message: { sender: "abc@lid", sender_pn: "5511777776666", messageType: "conversation", text: "y" },
    });
    expect(r?.fromPhone).toBe("5511777776666");
  });
});
