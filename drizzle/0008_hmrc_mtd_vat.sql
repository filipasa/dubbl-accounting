CREATE TABLE IF NOT EXISTS "hmrc_connection" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "vrn" text NOT NULL,
  "access_token" text NOT NULL,
  "refresh_token" text NOT NULL,
  "token_expires_at" timestamp NOT NULL,
  "scope" text DEFAULT 'read:vat write:vat' NOT NULL,
  "environment" text DEFAULT 'sandbox' NOT NULL,
  "status" text DEFAULT 'connected' NOT NULL,
  "connected_by" uuid REFERENCES "users"("id"),
  "connected_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "last_sync_at" timestamp,
  "last_error" text
);

CREATE UNIQUE INDEX IF NOT EXISTS "hmrc_connection_org_idx" ON "hmrc_connection" ("organization_id");

CREATE TABLE IF NOT EXISTS "hmrc_vat_submission" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "organization_id" uuid NOT NULL REFERENCES "organization"("id") ON DELETE CASCADE,
  "tax_period_id" uuid REFERENCES "tax_period"("id"),
  "vrn" text NOT NULL,
  "period_key" text NOT NULL,
  "box_1" integer NOT NULL,
  "box_2" integer NOT NULL,
  "box_3" integer NOT NULL,
  "box_4" integer NOT NULL,
  "box_5" integer NOT NULL,
  "box_6" integer NOT NULL,
  "box_7" integer NOT NULL,
  "box_8" integer NOT NULL,
  "box_9" integer NOT NULL,
  "form_bundle_number" text,
  "payment_indicator" text,
  "charge_ref_number" text,
  "processing_date" timestamp,
  "status" text DEFAULT 'submitted' NOT NULL,
  "submitted_by" uuid REFERENCES "users"("id"),
  "submitted_at" timestamp DEFAULT now() NOT NULL,
  "request_payload" jsonb,
  "response_payload" jsonb,
  "error_message" text
);
