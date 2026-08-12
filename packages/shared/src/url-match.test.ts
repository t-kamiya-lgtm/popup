import { describe, expect, it } from "vitest";
import { matchUrl, matchesTargets, resolvePageGroup } from "./url-match.js";

describe("matchUrl", () => {
  it("exact matches the whole path", () => {
    expect(matchUrl({ match: "exact", pattern: "/protein.html" }, "/protein.html")).toBe(true);
    expect(matchUrl({ match: "exact", pattern: "/protein.html" }, "/protein.html?x=1")).toBe(false);
  });

  it("prefix matches the start", () => {
    expect(matchUrl({ match: "prefix", pattern: "/products/" }, "/products/pm100/")).toBe(true);
    expect(matchUrl({ match: "prefix", pattern: "/products/" }, "/other/products/")).toBe(false);
  });

  it("contains matches anywhere", () => {
    expect(matchUrl({ match: "contains", pattern: "/cart" }, "/shopping/cart/confirm")).toBe(true);
  });

  it("regex matches via RegExp", () => {
    expect(matchUrl({ match: "regex", pattern: "^/products/[a-z0-9]+/$" }, "/products/pm100/")).toBe(true);
    expect(matchUrl({ match: "regex", pattern: "^/products/[a-z0-9]+/$" }, "/products/PM100/")).toBe(false);
  });

  it("treats an invalid regex as a non-match instead of throwing", () => {
    expect(() => matchUrl({ match: "regex", pattern: "(" }, "/anything")).not.toThrow();
    expect(matchUrl({ match: "regex", pattern: "(" }, "/anything")).toBe(false);
  });
});

describe("matchesTargets", () => {
  it("matches everything when include is empty and nothing is excluded", () => {
    expect(matchesTargets({ include: [], exclude: [] }, "/anything")).toBe(true);
  });

  it("exclude wins over include", () => {
    const targets = {
      include: [{ match: "prefix" as const, pattern: "/products/" }],
      exclude: [{ match: "contains" as const, pattern: "/cart" }],
    };
    expect(matchesTargets(targets, "/products/pm100/")).toBe(true);
    expect(matchesTargets(targets, "/products/pm100/cart")).toBe(false);
  });

  it("requires at least one include match when include is non-empty", () => {
    const targets = {
      include: [{ match: "exact" as const, pattern: "/protein.html" }],
      exclude: [],
    };
    expect(matchesTargets(targets, "/protein.html")).toBe(true);
    expect(matchesTargets(targets, "/other.html")).toBe(false);
  });

  it("excludes cart and shopping paths for the primedirect.jp default config", () => {
    const targets = {
      include: [],
      exclude: [
        { match: "contains" as const, pattern: "/cart" },
        { match: "contains" as const, pattern: "/shopping" },
      ],
    };
    expect(matchesTargets(targets, "/protein.html")).toBe(true);
    expect(matchesTargets(targets, "/cart/?product_id=4212")).toBe(false);
    expect(matchesTargets(targets, "/shopping/payment.php")).toBe(false);
  });
});

describe("resolvePageGroup", () => {
  const groups = [
    { id: 1, match: "prefix" as const, pattern: "/products/", priority: 10 },
    { id: 2, match: "exact" as const, pattern: "/protein.html", priority: 10 },
    { id: 3, match: "prefix" as const, pattern: "/", priority: 100 },
  ];

  it("returns null when nothing matches", () => {
    expect(resolvePageGroup(groups.slice(0, 2), "/guide.html")).toBeNull();
  });

  it("picks the lowest-priority (highest precedence) match", () => {
    // both the specific "/products/" rule and the catch-all "/" rule match;
    // priority 10 must win over priority 100.
    expect(resolvePageGroup(groups, "/products/pm100/")?.id).toBe(1);
  });
});
