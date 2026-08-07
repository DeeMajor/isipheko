-- CreateEnum
CREATE TYPE "archetype_group" AS ENUM ('union', 'bereavement', 'remembrance', 'arrival', 'achievement', 'gathering');

-- CreateEnum
CREATE TYPE "archetype_key" AS ENUM ('umshado', 'umembeso', 'umngcwabo', 'umbuyiso', 'imbeleko', 'graduation', 'itiye');

-- CreateEnum
CREATE TYPE "id_verification_status" AS ENUM ('unverified', 'pending', 'verified', 'failed');

-- CreateEnum
CREATE TYPE "bank_account_status" AS ENUM ('pending', 'active', 'failed', 'retired');

-- CreateEnum
CREATE TYPE "event_mode" AS ENUM ('ledger_only', 'hosted');

-- CreateEnum
CREATE TYPE "event_status" AS ENUM ('draft', 'published', 'closed');

-- CreateEnum
CREATE TYPE "contribution_visibility" AS ENUM ('public', 'name_only', 'anonymous');

-- CreateEnum
CREATE TYPE "contribution_type" AS ENUM ('cash', 'in_kind', 'cash_toward_item');

-- CreateEnum
CREATE TYPE "verification_source" AS ENUM ('organiser_confirmed', 'psp_webhook');

-- CreateEnum
CREATE TYPE "contribution_status" AS ENUM ('claimed', 'pending', 'confirmed', 'disputed', 'void');

-- CreateEnum
CREATE TYPE "need_claim_status" AS ENUM ('claimed', 'delivered', 'expired', 'withdrawn');

-- CreateEnum
CREATE TYPE "witness_status" AS ENUM ('invited', 'accepted', 'declined');

-- CreateEnum
CREATE TYPE "ledger_entry_type" AS ENUM ('contribution', 'collection', 'payout', 'adjustment', 'reversal');

-- CreateEnum
CREATE TYPE "ledger_direction" AS ENUM ('credit', 'debit');

-- CreateEnum
CREATE TYPE "payout_status" AS ENUM ('pending', 'submitted', 'paused', 'completed', 'reversed', 'cancelled', 'error');

-- CreateEnum
CREATE TYPE "collection_status" AS ENUM ('draft', 'open', 'closed', 'handed_over', 'abandoned');

-- CreateEnum
CREATE TYPE "handover_status" AS ENUM ('not_started', 'witness_confirmed', 'organiser_evidenced', 'host_acknowledged');

-- CreateEnum
CREATE TYPE "collection_member_status" AS ENUM ('pending', 'confirmed', 'withdrawn');

-- CreateEnum
CREATE TYPE "actor_type" AS ENUM ('organiser', 'contributor', 'witness', 'system', 'admin');

-- CreateTable
CREATE TABLE "organisers" (
    "id" TEXT NOT NULL,
    "phone_e164" TEXT NOT NULL,
    "email" TEXT,
    "display_name" TEXT NOT NULL,
    "id_number_hash" TEXT,
    "id_verification_status" "id_verification_status" NOT NULL DEFAULT 'unverified',
    "id_verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organisers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_accounts" (
    "id" TEXT NOT NULL,
    "organiser_id" TEXT NOT NULL,
    "bank_id" TEXT NOT NULL,
    "account_number_encrypted" TEXT NOT NULL,
    "account_type" TEXT NOT NULL,
    "bav_result" JSONB,
    "bav_verified_at" TIMESTAMP(3),
    "status" "bank_account_status" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" TEXT NOT NULL,
    "organiser_id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "archetype" "archetype_key" NOT NULL,
    "archetype_group" "archetype_group" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "event_date" TIMESTAMP(3),
    "target_amount_cents" BIGINT,
    "visibility_default" "contribution_visibility" NOT NULL DEFAULT 'public',
    "mode" "event_mode" NOT NULL DEFAULT 'ledger_only',
    "direct_pay_details" JSONB,
    "status" "event_status" NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMP(3),

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "need_items" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "category" TEXT,
    "quantity_required" INTEGER NOT NULL,
    "quantity_claimed" INTEGER NOT NULL DEFAULT 0,
    "unit" TEXT,
    "estimated_cost_cents" BIGINT,
    "allows_cash_toward" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "need_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "need_claims" (
    "id" TEXT NOT NULL,
    "need_item_id" TEXT NOT NULL,
    "contribution_id" TEXT,
    "quantity" INTEGER NOT NULL,
    "claimant_name" TEXT NOT NULL,
    "claimant_phone_e164" TEXT,
    "status" "need_claim_status" NOT NULL DEFAULT 'claimed',
    "expires_at" TIMESTAMP(3),
    "delivered_confirmed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "need_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "witnesses" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone_e164" TEXT NOT NULL,
    "status" "witness_status" NOT NULL DEFAULT 'invited',
    "can_approve_payouts" BOOLEAN NOT NULL DEFAULT false,
    "accepted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "witnesses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contributions" (
    "id" TEXT NOT NULL,
    "event_id" TEXT,
    "collection_id" TEXT,
    "contributor_name" TEXT NOT NULL,
    "contributor_phone_e164" TEXT,
    "type" "contribution_type" NOT NULL,
    "amount_cents" BIGINT,
    "need_item_id" TEXT,
    "message" TEXT,
    "photo_key" TEXT,
    "visibility" "contribution_visibility" NOT NULL DEFAULT 'public',
    "verification_source" "verification_source" NOT NULL,
    "psp_payment_id" TEXT,
    "status" "contribution_status" NOT NULL DEFAULT 'pending',
    "reference_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_at" TIMESTAMP(3),

    CONSTRAINT "contributions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collections" (
    "id" TEXT NOT NULL,
    "occasion_archetype" "archetype_key" NOT NULL,
    "occasion_archetype_group" "archetype_group" NOT NULL,
    "title" TEXT NOT NULL,
    "purpose" TEXT,
    "event_id" TEXT,
    "organiser_id" TEXT NOT NULL,
    "slug" TEXT,
    "organiser_bank_hint" TEXT,
    "handover_status" "handover_status" NOT NULL DEFAULT 'not_started',
    "handover_confirmed_by" TEXT,
    "handover_evidence_key" TEXT,
    "handover_at" TIMESTAMP(3),
    "need_item_id" TEXT,
    "status" "collection_status" NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "collections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collection_members" (
    "id" TEXT NOT NULL,
    "collection_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone_e164" TEXT,
    "amount_cents" BIGINT,
    "visibility" "contribution_visibility" NOT NULL DEFAULT 'public',
    "status" "collection_member_status" NOT NULL DEFAULT 'pending',
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "collection_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" TEXT NOT NULL,
    "event_id" TEXT,
    "collection_id" TEXT,
    "sequence_no" INTEGER NOT NULL,
    "entry_type" "ledger_entry_type" NOT NULL,
    "direction" "ledger_direction" NOT NULL,
    "amount_cents" BIGINT,
    "in_kind_description" TEXT,
    "reference_id" TEXT,
    "prev_hash" TEXT NOT NULL,
    "entry_hash" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "contribution_id" TEXT,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payouts" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "amount_cents" BIGINT NOT NULL,
    "bank_account_id" TEXT NOT NULL,
    "psp_disbursement_id" TEXT,
    "nonce" TEXT NOT NULL,
    "status" "payout_status" NOT NULL DEFAULT 'pending',
    "requested_by" TEXT NOT NULL,
    "approvals" JSONB NOT NULL DEFAULT '[]',
    "hold_expires_at" TIMESTAMP(3),
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "payouts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" TEXT NOT NULL,
    "actor_type" "actor_type" NOT NULL,
    "actor_id" TEXT,
    "action" TEXT NOT NULL,
    "target_type" TEXT,
    "target_id" TEXT,
    "ip_hash" TEXT,
    "user_agent_hash" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organisers_phone_e164_key" ON "organisers"("phone_e164");

-- CreateIndex
CREATE UNIQUE INDEX "organisers_id_number_hash_key" ON "organisers"("id_number_hash");

-- CreateIndex
CREATE INDEX "bank_accounts_organiser_id_idx" ON "bank_accounts"("organiser_id");

-- CreateIndex
CREATE UNIQUE INDEX "events_slug_key" ON "events"("slug");

-- CreateIndex
CREATE INDEX "events_organiser_id_idx" ON "events"("organiser_id");

-- CreateIndex
CREATE INDEX "events_status_idx" ON "events"("status");

-- CreateIndex
CREATE INDEX "need_items_event_id_sort_order_idx" ON "need_items"("event_id", "sort_order");

-- CreateIndex
CREATE UNIQUE INDEX "need_claims_contribution_id_key" ON "need_claims"("contribution_id");

-- CreateIndex
CREATE INDEX "need_claims_need_item_id_status_idx" ON "need_claims"("need_item_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "witnesses_event_id_phone_e164_key" ON "witnesses"("event_id", "phone_e164");

-- CreateIndex
CREATE UNIQUE INDEX "contributions_psp_payment_id_key" ON "contributions"("psp_payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "contributions_reference_code_key" ON "contributions"("reference_code");

-- CreateIndex
CREATE INDEX "contributions_event_id_status_idx" ON "contributions"("event_id", "status");

-- CreateIndex
CREATE INDEX "contributions_collection_id_idx" ON "contributions"("collection_id");

-- CreateIndex
CREATE UNIQUE INDEX "collections_slug_key" ON "collections"("slug");

-- CreateIndex
CREATE INDEX "collections_event_id_idx" ON "collections"("event_id");

-- CreateIndex
CREATE INDEX "collections_organiser_id_idx" ON "collections"("organiser_id");

-- CreateIndex
CREATE INDEX "collection_members_collection_id_idx" ON "collection_members"("collection_id");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_entries_entry_hash_key" ON "ledger_entries"("entry_hash");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_entries_contribution_id_key" ON "ledger_entries"("contribution_id");

-- CreateIndex
CREATE INDEX "ledger_entries_event_id_created_at_idx" ON "ledger_entries"("event_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_entries_event_id_sequence_no_key" ON "ledger_entries"("event_id", "sequence_no");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_entries_collection_id_sequence_no_key" ON "ledger_entries"("collection_id", "sequence_no");

-- CreateIndex
CREATE UNIQUE INDEX "payouts_psp_disbursement_id_key" ON "payouts"("psp_disbursement_id");

-- CreateIndex
CREATE UNIQUE INDEX "payouts_nonce_key" ON "payouts"("nonce");

-- CreateIndex
CREATE INDEX "payouts_event_id_status_idx" ON "payouts"("event_id", "status");

-- CreateIndex
CREATE INDEX "audit_log_actor_type_actor_id_idx" ON "audit_log"("actor_type", "actor_id");

-- CreateIndex
CREATE INDEX "audit_log_target_type_target_id_idx" ON "audit_log"("target_type", "target_id");

-- CreateIndex
CREATE INDEX "audit_log_created_at_idx" ON "audit_log"("created_at");

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_organiser_id_fkey" FOREIGN KEY ("organiser_id") REFERENCES "organisers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_organiser_id_fkey" FOREIGN KEY ("organiser_id") REFERENCES "organisers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "need_items" ADD CONSTRAINT "need_items_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "need_claims" ADD CONSTRAINT "need_claims_need_item_id_fkey" FOREIGN KEY ("need_item_id") REFERENCES "need_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "need_claims" ADD CONSTRAINT "need_claims_contribution_id_fkey" FOREIGN KEY ("contribution_id") REFERENCES "contributions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "witnesses" ADD CONSTRAINT "witnesses_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "collections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contributions" ADD CONSTRAINT "contributions_need_item_id_fkey" FOREIGN KEY ("need_item_id") REFERENCES "need_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collections" ADD CONSTRAINT "collections_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collections" ADD CONSTRAINT "collections_organiser_id_fkey" FOREIGN KEY ("organiser_id") REFERENCES "organisers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collections" ADD CONSTRAINT "collections_need_item_id_fkey" FOREIGN KEY ("need_item_id") REFERENCES "need_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collection_members" ADD CONSTRAINT "collection_members_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "collections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "collections"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_contribution_id_fkey" FOREIGN KEY ("contribution_id") REFERENCES "contributions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payouts" ADD CONSTRAINT "payouts_bank_account_id_fkey" FOREIGN KEY ("bank_account_id") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
