import { describe, it, expect } from "vitest";
import { acceptFilesForQueue, MAX_MEDIA_QUEUE } from "./media-queue";

function f(name: string, size: number): File {
  return new File([new Uint8Array(size)], name, { type: "image/png" });
}

describe("acceptFilesForQueue", () => {
  it("aceita dentro do tamanho e do teto", () => {
    const r = acceptFilesForQueue({
      files: [f("a.png", 10), f("b.png", 20)],
      kind: "image",
      currentCount: 0,
      maxBytes: 100,
    });
    expect(r.accepted.map((x) => x.name)).toEqual(["a.png", "b.png"]);
    expect(r.rejected).toEqual([]);
  });

  it("rejeita acima do tamanho, com motivo", () => {
    const r = acceptFilesForQueue({
      files: [f("big.png", 200)],
      kind: "image",
      currentCount: 0,
      maxBytes: 100,
    });
    expect(r.accepted).toEqual([]);
    expect(r.rejected).toHaveLength(1);
    expect(r.rejected[0].name).toBe("big.png");
    expect(r.rejected[0].reason).toContain("limite");
  });

  it("respeita o teto da fila (MAX_MEDIA_QUEUE), rejeitando o excedente", () => {
    const files = Array.from({ length: 3 }, (_, i) => f(`f${i}.png`, 1));
    const r = acceptFilesForQueue({
      files,
      kind: "image",
      currentCount: MAX_MEDIA_QUEUE - 1,
      maxBytes: 100,
    });
    expect(r.accepted).toHaveLength(1);
    expect(r.rejected).toHaveLength(2);
    expect(r.rejected[0].reason).toContain("máximo");
  });
});
