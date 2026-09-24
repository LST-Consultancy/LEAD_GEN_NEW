import type { Metadata } from "next";
import { LoginForm } from "./login-form";
import { DEMO_ACCOUNT, demoAccountExists } from "@/lib/services/demo";

export const metadata: Metadata = { title: "Sign in" };

export default async function LoginPage() {
  return <LoginForm demo={(await demoAccountExists()) ? DEMO_ACCOUNT : null} />;
}
