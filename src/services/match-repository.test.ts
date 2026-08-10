import { describe, expect, it } from "vitest";
import { NUMBER_PACKS } from "../content/number-packs";
import { createMatch } from "../domain/game";
import { MatchRepository, type StorageLike } from "./match-repository";

function memoryStorage(): StorageLike {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
    removeItem: (key) => values.delete(key),
  };
}

describe("本機對局保存", () => {
  it("透過公開 repository 介面保存並還原進行中的對局與事件", () => {
    const repository = new MatchRepository(memoryStorage());
    const state = createMatch({ seed: 1234, numberPack: NUMBER_PACKS[0] });
    const record = {
      version: 1 as const,
      state,
      events: [{ sequence: 0, at: 1000, event: { type: "match-created" as const } }],
      savedAt: 1000,
    };

    repository.saveActive(record);

    expect(repository.loadActive()).toEqual(record);
    repository.clearActive();
    expect(repository.loadActive()).toBeNull();
  });

  it("只保留最近 20 場，並能以版本化 JSON 匯出與匯入", () => {
    const repository = new MatchRepository(memoryStorage());
    for (let index = 0; index < 21; index += 1) {
      const state = createMatch({ seed: index, numberPack: NUMBER_PACKS[index % 30] });
      state.id = `match-${index}`;
      repository.saveCompleted({ version: 1, state, events: [], savedAt: index });
    }

    const records = repository.listCompleted();
    expect(records).toHaveLength(20);
    expect(records[0].state.id).toBe("match-20");
    expect(records.at(-1)?.state.id).toBe("match-1");

    const exported = repository.exportRecord(records[0]);
    const importedRepository = new MatchRepository(memoryStorage());
    const imported = importedRepository.importRecord(exported);
    expect(imported.state.id).toBe("match-20");
    expect(importedRepository.listCompleted()).toHaveLength(1);
  });

  it("拒絕版本正確但缺少必要對局結構的損壞匯入檔", () => {
    const repository = new MatchRepository(memoryStorage());

    expect(() =>
      repository.importRecord(JSON.stringify({
        version: 1,
        state: { version: 1, id: "broken" },
        events: [],
        savedAt: 1,
      })),
    ).toThrow("不支援或損壞");
  });
});
