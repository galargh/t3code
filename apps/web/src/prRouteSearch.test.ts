import { describe, expect, it } from "vitest";
import { parsePrRouteSearch, stripPrSearchParams } from "./prRouteSearch.ts";

describe("parsePrRouteSearch", () => {
  it("normalizes truthy variants to '1'", () => {
    expect(parsePrRouteSearch({ pr: "1" })).toEqual({ pr: "1" });
    expect(parsePrRouteSearch({ pr: 1 })).toEqual({ pr: "1" });
    expect(parsePrRouteSearch({ pr: true })).toEqual({ pr: "1" });
  });

  it("returns an empty object when not open", () => {
    expect(parsePrRouteSearch({})).toEqual({});
    expect(parsePrRouteSearch({ pr: "0" })).toEqual({});
    expect(parsePrRouteSearch({ pr: false })).toEqual({});
  });
});

describe("stripPrSearchParams", () => {
  it("removes only the pr key", () => {
    expect(stripPrSearchParams({ pr: "1", diff: "1", other: "x" })).toEqual({
      diff: "1",
      other: "x",
    });
  });
});
