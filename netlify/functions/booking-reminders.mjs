import { getStore } from "@netlify/blobs";
import { processBooking } from "../lib/notify.mjs";
import { runPayReminders } from "../lib/payremind.mjs";

// Every 15 minutes: send any missing confirmation and the 24h reminder, plus mentoring payment reminders.
export default async () => {
  const store = getStore({ name: "bookings", consistency: "strong" });
  const { blobs } = await store.list();
  const out = {};
  for (const b of blobs) out[b.key] = await processBooking(store, b.key);
  let pay = {};
  try { pay = await runPayReminders(getStore({ name: "crm", consistency: "strong" })); } catch (e) { pay = { error: e.message }; }
  console.log("booking-reminders", JSON.stringify(out), "pay", JSON.stringify(pay));
};

export const config = { schedule: "*/15 * * * *" };
