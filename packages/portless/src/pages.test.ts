import { describe, expect, it } from "vitest";
import * as vm from "node:vm";
import { renderRouteRow } from "./internal-pages.js";
import { APP_FILTER_CONTROLS, APP_FILTER_NO_MATCH, APP_FILTER_SCRIPT, appList } from "./pages.js";
import type { RouteInfo } from "./types.js";

const NOW = 1_700_000_000_000;

describe("renderRouteRow uptime", () => {
  const row = (route: RouteInfo): string =>
    renderRouteRow(route, { url: "http://x.localhost:1355", now: NOW });

  it("shows an uptime badge and a data-registered-at attribute for a registered app", () => {
    const html = row({
      hostname: "myapp.localhost",
      port: 4001,
      pid: 123,
      registeredAt: NOW - 5 * 60_000,
    });
    expect(html).toContain("up 5m");
    expect(html).toContain(`data-registered-at="${NOW - 5 * 60_000}"`);
  });

  it("omits uptime for aliases and for routes without a usable registration time", () => {
    expect(
      row({ hostname: "a.localhost", port: 1, pid: 0, registeredAt: NOW - 60_000 })
    ).not.toContain("up ");
    expect(row({ hostname: "b.localhost", port: 2, pid: 5 })).not.toContain("up ");
    expect(row({ hostname: "b.localhost", port: 2, pid: 5 })).not.toContain("data-registered-at");
    expect(
      row({ hostname: "c.localhost", port: 3, pid: 5, registeredAt: "soon" as unknown as number })
    ).not.toContain("up ");
  });
});

interface FakeElement {
  hidden: boolean;
  textContent: string;
  value: string;
  children: FakeElement[];
  attrs: Map<string, string>;
  listeners: Map<string, Array<() => void>>;
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
  addEventListener(type: string, fn: () => void): void;
  appendChild(child: FakeElement): FakeElement;
  querySelector(selector: string): FakeElement | null;
  fire(type: string): void;
}

function fakeElement(
  init: {
    hidden?: boolean;
    textContent?: string;
    children?: FakeElement[];
    attrs?: Record<string, string>;
  } = {}
): FakeElement {
  return {
    hidden: init.hidden ?? false,
    textContent: init.textContent ?? "",
    value: "",
    children: init.children ?? [],
    attrs: new Map(Object.entries(init.attrs ?? {})),
    listeners: new Map(),
    getAttribute(name) {
      return this.attrs.get(name) ?? null;
    },
    setAttribute(name, value) {
      this.attrs.set(name, value);
    },
    addEventListener(type, fn) {
      this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
    },
    appendChild(child) {
      this.children = this.children.filter((c) => c !== child);
      this.children.push(child);
      return child;
    },
    querySelector() {
      return null;
    },
    fire(type) {
      for (const fn of this.listeners.get(type) ?? []) fn();
    },
  };
}

/** Build the filter page DOM the script expects and run the real script against it. */
function runFilterScript(hosts: Array<{ name: string; registeredAt?: number }>) {
  const rows = hosts.map(({ name, registeredAt }) => {
    const nameEl = fakeElement({ textContent: name });
    const row = fakeElement({
      attrs: registeredAt === undefined ? {} : { "data-registered-at": String(registeredAt) },
    });
    row.querySelector = (selector) => (selector === ".app-name" ? nameEl : null);
    return row;
  });
  const list = fakeElement({ children: rows });
  const input = fakeElement({ attrs: {} });
  const sort = fakeElement({ attrs: { "aria-pressed": "false" } });
  const bar = fakeElement({ hidden: true });
  bar.querySelector = (selector) =>
    selector === "input" ? input : selector === "button" ? sort : null;
  const none = fakeElement({ hidden: true });
  const document = {
    querySelector(selector: string) {
      if (selector === ".filter") return bar;
      if (selector === ".app-list") return list;
      if (selector === ".empty[role=status]") return none;
      return null;
    },
  };
  vm.runInNewContext(APP_FILTER_SCRIPT, { document, Array, Number, String });
  return { rows, list, input, sort, bar, none };
}

describe("404 page filter markup and script", () => {
  it("targets selectors that the shared app row markup actually produces", () => {
    const rowHtml = renderRouteRow(
      { hostname: "myapp.localhost", port: 1, pid: 2, registeredAt: NOW },
      { url: "http://myapp.localhost:1355", now: NOW }
    );
    const listHtml = appList([rowHtml]);
    expect(listHtml).toContain('class="card app-list"');
    expect(rowHtml).toContain('class="app-item"');
    expect(rowHtml).toContain('class="app-name"');
    expect(APP_FILTER_SCRIPT).toContain(".app-list");
    expect(APP_FILTER_SCRIPT).toContain(".app-name");
    expect(APP_FILTER_SCRIPT).toContain("data-registered-at");
    expect(APP_FILTER_CONTROLS).toContain('class="filter"');
    expect(APP_FILTER_NO_MATCH).toContain('role="status"');
  });

  it("filters rows by hostname and reveals the controls", () => {
    const { rows, input, none, bar } = runFilterScript([
      { name: "alpha.localhost" },
      { name: "beta.localhost" },
      { name: "alphabet.localhost" },
    ]);
    expect(bar.hidden).toBe(false);
    expect(rows.map((r) => r.hidden)).toEqual([false, false, false]);

    input.value = " ALPHA ";
    input.fire("input");
    expect(rows.map((r) => r.hidden)).toEqual([false, true, false]);
    expect(none.hidden).toBe(true);

    input.value = "zzz";
    input.fire("input");
    expect(rows.every((r) => r.hidden)).toBe(true);
    expect(none.hidden).toBe(false);
  });

  it("sorts newest first by data-registered-at and restores the original order", () => {
    const { rows, list, sort } = runFilterScript([
      { name: "old.localhost", registeredAt: 100 },
      { name: "legacy.localhost" },
      { name: "new.localhost", registeredAt: 300 },
      { name: "mid.localhost", registeredAt: 200 },
    ]);
    const order = (): string[] => list.children.map((r) => rows.indexOf(r).toString());

    sort.fire("click");
    expect(sort.getAttribute("aria-pressed")).toBe("true");
    // new (2), mid (3), old (0), then the row without a time (1).
    expect(order()).toEqual(["2", "3", "0", "1"]);

    sort.fire("click");
    expect(sort.getAttribute("aria-pressed")).toBe("false");
    expect(order()).toEqual(["0", "1", "2", "3"]);
  });
});
