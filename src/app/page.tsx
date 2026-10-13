import { redirect } from "next/navigation";
import { routes } from "@/lib/auth/routes";

export default function RootPage() {
  redirect(routes.home);
}
