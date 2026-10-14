-- CreateEnum
CREATE TYPE "event_type" AS ENUM ('checkout_started', 'cart_abandoned');

-- CreateEnum
CREATE TYPE "sync_resource" AS ENUM ('customers', 'products', 'orders', 'events');

-- CreateEnum
CREATE TYPE "sync_trigger" AS ENUM ('manual', 'scheduler', 'webhook');

-- CreateEnum
CREATE TYPE "sync_status" AS ENUM ('running', 'success', 'failed');

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "shop_domain" TEXT,
    "shopify_access_token" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_synced_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "name" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" SERIAL NOT NULL,
    "tenant_id" UUID NOT NULL,
    "shopify_customer_id" TEXT NOT NULL,
    "email" TEXT,
    "first_name" TEXT,
    "last_name" TEXT,
    "phone" TEXT,
    "orders_count" INTEGER NOT NULL DEFAULT 0,
    "total_spent" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "synced_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" SERIAL NOT NULL,
    "tenant_id" UUID NOT NULL,
    "shopify_product_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "vendor" TEXT,
    "product_type" TEXT,
    "status" TEXT,
    "price" DECIMAL(12,2),
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "synced_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" SERIAL NOT NULL,
    "tenant_id" UUID NOT NULL,
    "shopify_order_id" TEXT NOT NULL,
    "order_number" TEXT,
    "customer_id" INTEGER,
    "email" TEXT,
    "subtotal_price" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_discounts" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_tax" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total_price" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "financial_status" TEXT,
    "fulfillment_status" TEXT,
    "cancelled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "synced_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_line_items" (
    "id" SERIAL NOT NULL,
    "tenant_id" UUID NOT NULL,
    "order_id" INTEGER NOT NULL,
    "product_id" INTEGER,
    "shopify_line_item_id" TEXT NOT NULL,
    "shopify_product_id" TEXT,
    "title" TEXT NOT NULL,
    "variant_title" TEXT,
    "sku" TEXT,
    "quantity" INTEGER NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "order_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "events" (
    "id" SERIAL NOT NULL,
    "tenant_id" UUID NOT NULL,
    "type" "event_type" NOT NULL,
    "customer_id" INTEGER,
    "shopify_checkout_id" TEXT,
    "email" TEXT,
    "total_price" DECIMAL(12,2),
    "payload" JSONB,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sync_logs" (
    "id" SERIAL NOT NULL,
    "tenant_id" UUID NOT NULL,
    "resource" "sync_resource" NOT NULL,
    "trigger" "sync_trigger" NOT NULL,
    "status" "sync_status" NOT NULL DEFAULT 'running',
    "records_synced" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),

    CONSTRAINT "sync_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_shop_domain_key" ON "tenants"("shop_domain");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_tenant_id_idx" ON "users"("tenant_id");

-- CreateIndex
CREATE INDEX "customers_tenant_id_total_spent_idx" ON "customers"("tenant_id", "total_spent");

-- CreateIndex
CREATE UNIQUE INDEX "customers_tenant_id_shopify_customer_id_key" ON "customers"("tenant_id", "shopify_customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "products_tenant_id_shopify_product_id_key" ON "products"("tenant_id", "shopify_product_id");

-- CreateIndex
CREATE INDEX "orders_tenant_id_created_at_idx" ON "orders"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "orders_customer_id_idx" ON "orders"("customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "orders_tenant_id_shopify_order_id_key" ON "orders"("tenant_id", "shopify_order_id");

-- CreateIndex
CREATE INDEX "order_line_items_order_id_idx" ON "order_line_items"("order_id");

-- CreateIndex
CREATE INDEX "order_line_items_product_id_idx" ON "order_line_items"("product_id");

-- CreateIndex
CREATE UNIQUE INDEX "order_line_items_tenant_id_shopify_line_item_id_key" ON "order_line_items"("tenant_id", "shopify_line_item_id");

-- CreateIndex
CREATE INDEX "events_tenant_id_type_occurred_at_idx" ON "events"("tenant_id", "type", "occurred_at");

-- CreateIndex
CREATE INDEX "events_customer_id_idx" ON "events"("customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "events_tenant_id_type_shopify_checkout_id_key" ON "events"("tenant_id", "type", "shopify_checkout_id");

-- CreateIndex
CREATE INDEX "sync_logs_tenant_id_started_at_idx" ON "sync_logs"("tenant_id", "started_at");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_line_items" ADD CONSTRAINT "order_line_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_line_items" ADD CONSTRAINT "order_line_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_line_items" ADD CONSTRAINT "order_line_items_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "events" ADD CONSTRAINT "events_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sync_logs" ADD CONSTRAINT "sync_logs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
