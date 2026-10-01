import { redirect } from "next/navigation";

export default function ApprovalsRedirect() {
  redirect("/orders?tab=approvals");
}
