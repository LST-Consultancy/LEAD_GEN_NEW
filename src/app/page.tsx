import { redirect } from "next/navigation";
import { getAuthContext } from "@/lib/auth/context";

export default async function RootPage() {
  const ctx = await getAuthContext();
  redirect(ctx ? "/today" : "/login");
}
