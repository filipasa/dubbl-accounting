import { db } from "@/lib/db";
import { organization } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  SenderSnapshot,
  RecipientSnapshot,
  formatContactAddress,
  buildRecipientSnapshot,
} from "./address";

export type { SenderSnapshot, RecipientSnapshot };
export { formatContactAddress, buildRecipientSnapshot };

export async function buildSenderSnapshot(organizationId: string): Promise<SenderSnapshot> {
  const org = await db.query.organization.findFirst({
    where: eq(organization.id, organizationId),
  });

  const address = [org?.addressStreet, org?.addressCity, org?.addressState, org?.addressPostalCode, org?.addressCountry]
    .filter(Boolean)
    .join(", ");

  return {
    name: org?.name || "Company",
    address: address || null,
    taxId: org?.taxId || null,
    registrationNumber: org?.businessRegistrationNumber || null,
    phone: org?.contactPhone || null,
    email: org?.contactEmail || null,
    countryCode: org?.countryCode || null,
  };
}
