import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Тестовете с целия пакет (стотици фрази) траят около 3 s; при паралелно пускане 5 s не стигат.
    testTimeout: 20_000,
  },
});
