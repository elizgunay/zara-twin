import { describe, expect, it } from "vitest";
import { effectiveMode, resolveCloudStt } from "./cloud";

const BUILT_IN = "built-in-key-0123456789";

describe("облакът по подразбиране", () => {
  it("с вграден ключ и без избор в настройките: облак с вградения ключ", () => {
    expect(resolveCloudStt(undefined, undefined, BUILT_IN)).toEqual({ provider: "speechmatics", apiKey: BUILT_IN });
  });

  it("въведеният в настройките ключ печели пред вградения", () => {
    expect(resolveCloudStt("speechmatics", " stored-key-0123456789 ", BUILT_IN)?.apiKey).toBe("stored-key-0123456789");
  });

  it("изричният избор „на компютъра“ печели", () => {
    expect(resolveCloudStt("local", undefined, BUILT_IN)).toBeNull();
  });

  it("без никакъв ключ остава на компютъра", () => {
    expect(resolveCloudStt(undefined, undefined, "")).toBeNull();
    expect(effectiveMode(undefined, "")).toBe("local");
    expect(resolveCloudStt("speechmatics", "", "")).toBeNull();
  });
});
