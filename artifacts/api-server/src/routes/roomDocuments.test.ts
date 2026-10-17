import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import {
  buildCallHtml,
  buildSandboxHtml,
  buildSandboxHtmlWithAssistant,
} from "./roomDocuments.js";

type Handler = (...args: unknown[]) => void;

function createElement(id: string) {
  const handlers = new Map<string, Handler>();
  const classes = new Set<string>();
  const attributes: Record<string, string> = {};

  return {
    id,
    value: "",
    textContent: "",
    disabled: false,
    onclick: null as Handler | null,
    dataset: { tab: id },
    attributes,
    handlers,
    classList: {
      add(name: string) {
        classes.add(name);
      },
      remove(name: string) {
        classes.delete(name);
      },
      contains(name: string) {
        return classes.has(name);
      },
    },
    addEventListener(name: string, handler: Handler) {
      handlers.set(name, handler);
    },
    setAttribute(name: string, value: string) {
      attributes[name] = value;
    },
  };
}

function createBrowserHarness(connected: boolean) {
  const ids = [
    "sync-badge",
    "htmlEditor",
    "cssEditor",
    "jsEditor",
    "preview-pane",
    "html-pane",
    "css-pane",
    "js-pane",
    "previewFrame",
    "assistant-input",
    "assistant-output",
    "assistant-status",
    "assistant-send",
    "assistant-cancel",
    "assistant-retry",
    "assistant-clear",
  ];
  const elements = new Map(ids.map((id) => [id, createElement(id)]));
  const tabs = ["html", "css", "js", "preview"].map((name) => {
    const tab = createElement(name);
    tab.dataset.tab = name;
    return tab;
  });
  const panes = ["html-pane", "css-pane", "js-pane"].map((id) =>
    elements.get(id)!,
  );
  const listeners = new Map<string, Handler>();
  const emitted: Array<{ event: string; payload: unknown }> = [];
  const pendingTimeouts = new Map<number, Handler>();
  let timeoutId = 0;
  const socket = {
    connected,
    on(event: string, handler: Handler) {
      listeners.set(event, handler);
    },
    emit(event: string, payload: unknown) {
      emitted.push({ event, payload });
    },
  };
  const document = {
    getElementById(id: string) {
      return elements.get(id)!;
    },
    querySelectorAll(selector: string) {
      return selector === ".tab" ? tabs : panes;
    },
  };
  const context = {
    document,
    io: () => socket,
    setTimeout(handler: Handler) {
      const id = ++timeoutId;
      pendingTimeouts.set(id, handler);
      return id;
    },
    clearTimeout(id: number) {
      pendingTimeouts.delete(id);
    },
  };

  return {
    context,
    elements,
    emitted,
    listeners,
    pendingTimeouts,
    socket,
    tabs,
  };
}

function inlineScripts(html: string): string[] {
  return [
    ...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script(?:\s+[^>]*)?>/gi),
  ].map((match) => match[1]!);
}

function sandboxArguments(roomId = "test-room") {
  return { roomId, username: "Alice", capability: "capability-token" };
}

describe("room document HTML", () => {
  it("serializes values embedded in inline scripts without HTML delimiters", () => {
    const attack = "</script><script>alert(1)</script>";
    const callHtml = buildCallHtml({
      roomId: attack,
      userId: attack,
      username: "Alice",
      capability: attack,
    });
    const sandboxHtml = buildSandboxHtml(sandboxArguments(attack));

    expect(callHtml).toContain(
      'const ROOM_ID="\\u003c/script\\u003e\\u003cscript\\u003ealert(1)\\u003c/script\\u003e"',
    );
    expect(callHtml).not.toContain(`ROOM_ID="${attack}"`);
    expect(sandboxHtml).toContain(
      'const ROOM_ID="\\u003c/script\\u003e\\u003cscript\\u003ealert(1)\\u003c/script\\u003e"',
    );
    expect(sandboxHtml).not.toContain(`ROOM_ID="${attack}"`);
  });

  it("renders sandbox view controls as keyboard-operable buttons with state", () => {
    const html = buildSandboxHtml(sandboxArguments());
    const tabButtons = html.match(/<button type="button" class="tab/g) ?? [];
    const harness = createBrowserHarness(true);

    expect(tabButtons).toHaveLength(4);
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-controls="html-pane"');

    runInNewContext(inlineScripts(html)[0]!, harness.context);
    harness.tabs[1]!.handlers.get("click")!();
    expect(harness.tabs[1]?.attributes["aria-pressed"]).toBe("true");
    expect(harness.tabs[0]?.attributes["aria-pressed"]).toBe("false");
  });

  it("broadcasts a local edit made after a remote sandbox update", () => {
    const html = buildSandboxHtml(sandboxArguments());
    const scripts = inlineScripts(html);
    const harness = createBrowserHarness(true);

    runInNewContext(scripts[0]!, harness.context);
    harness.listeners.get("sandbox-update")!({
      html: "remote html",
      css: "remote css",
      js: "remote js",
    });
    const editor = harness.elements.get("htmlEditor")!;
    editor.value = "local edit";
    editor.handlers.get("input")!();
    for (const [id, handler] of [...harness.pendingTimeouts]) {
      harness.pendingTimeouts.delete(id);
      handler();
    }

    const updates = harness.emitted.filter(
      (event) => event.event === "sandbox-update",
    );
    expect(updates).toHaveLength(1);
    expect(updates[0]?.payload).toMatchObject({ html: "local edit" });
  });

  it("clears an active assistant request and blocks asks when the socket disconnects", () => {
    const html = buildSandboxHtmlWithAssistant(sandboxArguments());
    const scripts = inlineScripts(html);
    const harness = createBrowserHarness(true);

    runInNewContext(scripts[0]!, harness.context);
    runInNewContext(scripts[1]!, harness.context);
    const input = harness.elements.get("assistant-input")!;
    const send = harness.elements.get("assistant-send")!;
    const retry = harness.elements.get("assistant-retry")!;
    input.value = "Explain this bug";
    harness.listeners.get("connect")!();
    send.onclick!();
    expect(
      harness.emitted.some((event) => event.event === "assistant-request"),
    ).toBe(true);

    harness.socket.connected = false;
    harness.listeners.get("disconnect")!();

    expect(harness.elements.get("assistant-status")?.textContent).toContain(
      "Connection lost",
    );
    expect(send.disabled).toBe(true);
    expect(retry.disabled).toBe(true);
  });

  it("blocks initial assistant requests after a connection error", () => {
    const html = buildSandboxHtmlWithAssistant(sandboxArguments());
    const scripts = inlineScripts(html);
    const harness = createBrowserHarness(false);

    runInNewContext(scripts[0]!, harness.context);
    runInNewContext(scripts[1]!, harness.context);
    const input = harness.elements.get("assistant-input")!;
    const send = harness.elements.get("assistant-send")!;
    const retry = harness.elements.get("assistant-retry")!;
    input.value = "Explain this bug";
    send.onclick!();
    harness.listeners.get("connect_error")!();

    expect(
      harness.emitted.some((event) => event.event === "assistant-request"),
    ).toBe(false);
    expect(harness.elements.get("assistant-status")?.textContent).toContain(
      "Secure connection failed",
    );
    expect(send.disabled).toBe(true);
    expect(retry.disabled).toBe(true);
  });
});
