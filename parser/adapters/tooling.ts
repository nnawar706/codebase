// Conventions that hold whatever the framework: test runners find test files
// and tools find their config files by name, so nothing imports either. Knowing
// that is what keeps them out of "nothing imports this" as if it were news.

const SCRIPT = String.raw`[cm]?[jt]sx?`;
const TEST_NAME = new RegExp(String.raw`\.(test|spec)(-d)?\.${SCRIPT}$`);
const CONFIG_NAME = new RegExp(String.raw`(\.config|^\.[\w-]+rc)\.${SCRIPT}$`);

export function toolingRole(path: string): string | null {
  const segments = path.split("/");
  const name = segments[segments.length - 1];
  if (TEST_NAME.test(name) || segments.slice(0, -1).includes("__tests__")) return "test";
  if (CONFIG_NAME.test(name)) return "config";
  return null;
}
