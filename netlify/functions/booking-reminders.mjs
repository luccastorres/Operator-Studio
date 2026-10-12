import { getStore } from "@netlify/blobs";
import { processBooking } from "../lib/notify.mjs";

// Every 15 minutes: send any missing confirmation and the 24h reminder.
export default async () => {
  const store = getStore({ name: "bookings", consistency: "strong" });
  const { blobs } = await store.list();
  const out = {};
  for (const b of blobs) out[b.key] = await processBooking(store, b.key);
  console.log("booking-reminders", JSON.stringify(out));
};

export const config = { schedule: "*/15 * * * *" };
