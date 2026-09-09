import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { loadUxContext } from "@/lib/ux";
import { Screen } from "@/components/states";
import { LoginForm } from "@/components/login-form";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const cookieStore = await cookies();
  const ctx = await loadUxContext(cookieStore.get("bhv_practice")?.value ?? null);
  if (ctx) redirect("/");

  return (
    <Screen title="Sign in" lede="This is a private system for authorised staff.">
      <div className="card" style={{ maxWidth: 420 }}>
        <LoginForm />
      </div>
    </Screen>
  );
}
