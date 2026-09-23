import { describe,it,expect,vi } from "vitest";
import { validateProviderUrl } from "@/lib/providers/http";
import { encryptCredential,decryptCredential } from "@/lib/providers/credentials";
describe("provider security boundaries",()=>{
 it.each(["http://api.hunter.io/v2/account","https://127.0.0.1/","https://localhost/","https://169.254.169.254/latest/meta-data/","https://10.0.0.1/","https://[::1]/","file:///etc/passwd","ftp://api.hunter.io/","https://api.hunter.io.evil.invalid/","https://key@api.hunter.io/","https://api.hunter.io:444/"])("refuses destination %s",url=>expect(()=>validateProviderUrl(url)).toThrow());
 it("permits only exact documented HTTPS hosts",()=>expect(validateProviderUrl("https://api.hunter.io/v2/account").hostname).toBe("api.hunter.io"));
 it("binds encrypted keys to the workspace and provider",()=>{vi.stubEnv("PROVIDER_ENCRYPTION_KEY","ac".repeat(32));try{const value=encryptCredential("test-only-secret","workspace-a","hunter");expect(decryptCredential(value,"workspace-a","hunter")).toBe("test-only-secret");expect(()=>decryptCredential(value,"workspace-b","hunter")).toThrow();expect(()=>decryptCredential(value,"workspace-a","brave")).toThrow();}finally{vi.unstubAllEnvs();}});
});
