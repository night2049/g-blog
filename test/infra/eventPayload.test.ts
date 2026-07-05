import { test, expect } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEventSource, mapIssue } from "../../src/infra/eventPayload.ts";

function writeEvent(obj: unknown): string {
  const d = mkdtempSync(join(tmpdir(), "gblog-ev-"));
  const p = join(d, "event.json");
  writeFileSync(p, JSON.stringify(obj), "utf8");
  return p;
}

test("读取事件 issue 并映射字段", () => {
  const p = writeEvent({
    action: "opened",
    issue: {
      node_id: "I_e1",
      number: 7,
      title: "t",
      body: "b",
      state: "open",
      labels: [{ name: "published" }],
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-01-02T00:00:00Z",
    },
  });
  const ev = createEventSource(p);
  expect(ev.readIssue().node_id).toBe("I_e1");
  expect(ev.readIssue().state).toBe("open");
  expect(ev.readAction()).toBe("opened");
});

test("readAction: 缺 action -> null", () => {
  const p = writeEvent({ issue: { node_id: "I_e3", number: 1, title: "t", state: "open", labels: [], created_at: "x", updated_at: "y" } });
  expect(createEventSource(p).readAction()).toBeNull();
});

test("mapIssue 容错: 字符串标签与缺省 body", () => {
  const i = mapIssue({
    node_id: "I_e2",
    number: 1,
    title: "t",
    state: "closed",
    labels: ["a"],
    created_at: "x",
    updated_at: "y",
  });
  expect(i.state).toBe("closed");
  expect(i.labels[0]!.name).toBe("a");
  expect(i.body).toBeNull();
});

test("mapIssue 过滤非法 label, 不生成 name=undefined", () => {
  const i = mapIssue({
    node_id: "I_e4",
    number: 1,
    title: "t",
    state: "open",
    labels: ["a", { name: "b" }, { name: 123 }, {}, null],
    created_at: "x",
    updated_at: "y",
  });
  expect(i.labels).toEqual([{ name: "a" }, { name: "b" }]);
});

test("mapIssue 缺关键字段时抛错", () => {
  expect(() =>
    mapIssue({
      number: 1,
      title: "t",
      state: "open",
      labels: [],
      created_at: "x",
      updated_at: "y",
    }),
  ).toThrow("node_id");
  expect(() =>
    mapIssue({
      node_id: "I_bad",
      number: "1",
      title: "t",
      state: "open",
      labels: [],
      created_at: "x",
      updated_at: "y",
    }),
  ).toThrow("number");
});
