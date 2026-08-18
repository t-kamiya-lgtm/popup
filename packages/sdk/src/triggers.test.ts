// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Triggers } from "@popup/shared";
import { registerTriggers } from "./triggers.js";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  // jsdom's history object persists across tests in the same file.
  window.history.replaceState(null, "", "/");
});

describe("registerTriggers: dwell", () => {
  it("fires once the configured dwell time has elapsed", () => {
    const triggers: Triggers = { mode: "any", rules: [{ type: "dwell", seconds: 60 }] };
    const onFire = vi.fn();
    registerTriggers(triggers, Date.now(), onFire);

    vi.advanceTimersByTime(59_000);
    expect(onFire).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1_000);
    expect(onFire).toHaveBeenCalledWith("dwell");
    expect(onFire).toHaveBeenCalledTimes(1);
  });

  it("accounts for elapsed time since sessionStartedAt (not just registration time)", () => {
    const start = Date.now();
    vi.setSystemTime(start + 50_000); // 50s already elapsed in this session
    const triggers: Triggers = { mode: "any", rules: [{ type: "dwell", seconds: 60 }] };
    const onFire = vi.fn();
    registerTriggers(triggers, start, onFire);

    vi.advanceTimersByTime(9_000);
    expect(onFire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_000);
    expect(onFire).toHaveBeenCalledTimes(1);
  });

  it("pauses while the tab is hidden and resumes on visibility", () => {
    const triggers: Triggers = { mode: "any", rules: [{ type: "dwell", seconds: 60 }] };
    const onFire = vi.fn();
    registerTriggers(triggers, Date.now(), onFire);

    vi.advanceTimersByTime(30_000);
    Object.defineProperty(document, "hidden", { value: true, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));

    // Tab hidden for a long time — must not fire while hidden.
    vi.advanceTimersByTime(10 * 60_000);
    expect(onFire).not.toHaveBeenCalled();

    Object.defineProperty(document, "hidden", { value: false, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));

    // Only 30s of the 60s budget was consumed before hiding.
    vi.advanceTimersByTime(29_000);
    expect(onFire).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1_000);
    expect(onFire).toHaveBeenCalledTimes(1);
  });
});

describe("registerTriggers: exit_back", () => {
  it("fires on a popstate carrying the pushed marker", () => {
    const triggers: Triggers = { mode: "any", rules: [{ type: "exit_back" }] };
    const onFire = vi.fn();
    registerTriggers(triggers, Date.now(), onFire);

    window.dispatchEvent(new PopStateEvent("popstate", { state: { __pz: 1 } }));
    expect(onFire).toHaveBeenCalledWith("exit_back");
  });

  it("ignores a popstate that isn't ours (e.g. an SPA's own routing)", () => {
    const triggers: Triggers = { mode: "any", rules: [{ type: "exit_back" }] };
    const onFire = vi.fn();
    registerTriggers(triggers, Date.now(), onFire);

    window.dispatchEvent(new PopStateEvent("popstate", { state: { someOtherApp: true } }));
    expect(onFire).not.toHaveBeenCalled();
  });

  it("only fires once even if multiple matching popstates occur", () => {
    const triggers: Triggers = { mode: "any", rules: [{ type: "exit_back" }] };
    const onFire = vi.fn();
    registerTriggers(triggers, Date.now(), onFire);

    window.dispatchEvent(new PopStateEvent("popstate", { state: { __pz: 1 } }));
    window.dispatchEvent(new PopStateEvent("popstate", { state: { __pz: 1 } }));
    expect(onFire).toHaveBeenCalledTimes(1);
  });
});

describe("registerTriggers: image_click", () => {
  it("fires when a matching <img> is clicked directly", () => {
    const triggers: Triggers = {
      mode: "any",
      rules: [{ type: "image_click", imagePattern: "banner.jpg", imageMatchType: "contains" }],
    };
    const onFire = vi.fn();
    registerTriggers(triggers, Date.now(), onFire);

    const img = document.createElement("img");
    img.src = "https://cdn.example.com/lp/banner.jpg?v=2";
    document.body.appendChild(img);
    img.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(onFire).toHaveBeenCalledWith("image_click");
    document.body.removeChild(img);
  });

  it("fires when the click lands on a wrapper around the matching <img>", () => {
    const triggers: Triggers = {
      mode: "any",
      rules: [{ type: "image_click", imagePattern: "banner.jpg", imageMatchType: "contains" }],
    };
    const onFire = vi.fn();
    registerTriggers(triggers, Date.now(), onFire);

    const link = document.createElement("a");
    const img = document.createElement("img");
    img.src = "https://cdn.example.com/lp/banner.jpg";
    link.appendChild(img);
    document.body.appendChild(link);
    link.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(onFire).toHaveBeenCalledWith("image_click");
    document.body.removeChild(link);
  });

  it("does not fire for a click on a non-matching image", () => {
    const triggers: Triggers = {
      mode: "any",
      rules: [{ type: "image_click", imagePattern: "banner.jpg", imageMatchType: "contains" }],
    };
    const onFire = vi.fn();
    registerTriggers(triggers, Date.now(), onFire);

    const img = document.createElement("img");
    img.src = "https://cdn.example.com/lp/other.jpg";
    document.body.appendChild(img);
    img.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(onFire).not.toHaveBeenCalled();
    document.body.removeChild(img);
  });

  it("does not fire for a click that never touches an image", () => {
    const triggers: Triggers = {
      mode: "any",
      rules: [{ type: "image_click", imagePattern: "banner.jpg", imageMatchType: "contains" }],
    };
    const onFire = vi.fn();
    registerTriggers(triggers, Date.now(), onFire);

    const div = document.createElement("div");
    document.body.appendChild(div);
    div.dispatchEvent(new MouseEvent("click", { bubbles: true }));

    expect(onFire).not.toHaveBeenCalled();
    document.body.removeChild(div);
  });
});

describe("registerTriggers: mode", () => {
  it("mode 'all' waits for every rule to fire before calling onFire", () => {
    const triggers: Triggers = {
      mode: "all",
      rules: [{ type: "exit_back" }, { type: "dwell", seconds: 60 }],
    };
    const onFire = vi.fn();
    registerTriggers(triggers, Date.now(), onFire);

    window.dispatchEvent(new PopStateEvent("popstate", { state: { __pz: 1 } }));
    expect(onFire).not.toHaveBeenCalled();

    vi.advanceTimersByTime(60_000);
    expect(onFire).toHaveBeenCalledTimes(1);
  });

  it("cleans up the not-yet-fired rule's listeners once mode is satisfied", () => {
    const triggers: Triggers = {
      mode: "any",
      rules: [{ type: "exit_back" }, { type: "dwell", seconds: 60 }],
    };
    const onFire = vi.fn();
    registerTriggers(triggers, Date.now(), onFire);

    window.dispatchEvent(new PopStateEvent("popstate", { state: { __pz: 1 } }));
    expect(onFire).toHaveBeenCalledTimes(1);

    // The dwell timer should have been cancelled, not fire a second time later.
    vi.advanceTimersByTime(60_000);
    expect(onFire).toHaveBeenCalledTimes(1);
  });
});
