CREATE TABLE `charges` (
	`id` text PRIMARY KEY NOT NULL,
	`property_id` text NOT NULL,
	`lease_id` text NOT NULL,
	`type` text NOT NULL,
	`amount` integer NOT NULL,
	`due_date` text NOT NULL,
	`period` text NOT NULL,
	`payer` text DEFAULT 'tenant' NOT NULL,
	`source_id` text,
	`confidence` real DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `charges_lease_idx` ON `charges` (`lease_id`);--> statement-breakpoint
CREATE TABLE `column_mappings` (
	`signature` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`mapping` text NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `comps` (
	`id` text PRIMARY KEY NOT NULL,
	`property_id` text NOT NULL,
	`unit_type` text NOT NULL,
	`rent` integer NOT NULL,
	`source` text DEFAULT '' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `conflicts` (
	`id` text PRIMARY KEY NOT NULL,
	`property_id` text NOT NULL,
	`unit_number` text NOT NULL,
	`field` text NOT NULL,
	`candidates` text NOT NULL,
	`working_value` text,
	`status` text DEFAULT 'open' NOT NULL,
	`resolved_value` text
);
--> statement-breakpoint
CREATE TABLE `field_provenance` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`property_id` text NOT NULL,
	`entity` text NOT NULL,
	`entity_id` text NOT NULL,
	`field` text NOT NULL,
	`source_id` text NOT NULL,
	`staged_row_id` text,
	`confidence` real NOT NULL,
	`verified` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE INDEX `prov_entity_idx` ON `field_provenance` (`entity_id`);--> statement-breakpoint
CREATE TABLE `leases` (
	`id` text PRIMARY KEY NOT NULL,
	`property_id` text NOT NULL,
	`unit_id` text NOT NULL,
	`residents` text NOT NULL,
	`start` text NOT NULL,
	`end` text,
	`mtm` integer DEFAULT false NOT NULL,
	`contract_rent` integer NOT NULL,
	`recurring` text NOT NULL,
	`concessions` text NOT NULL,
	`deposit_held` integer DEFAULT 0 NOT NULL,
	`deposit_required` integer,
	`subsidy` text,
	`late_fee_authorized` integer,
	`mtm_premium` integer,
	`notes` text DEFAULT '' NOT NULL,
	`source_id` text,
	`confidence` real DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `notices` (
	`id` text PRIMARY KEY NOT NULL,
	`property_id` text NOT NULL,
	`unit_number` text NOT NULL,
	`resident` text NOT NULL,
	`type` text NOT NULL,
	`language` text DEFAULT 'en' NOT NULL,
	`body` text NOT NULL,
	`amount` integer,
	`status` text DEFAULT 'draft' NOT NULL,
	`method` text,
	`approved_by` text,
	`approved_at` text,
	`sent_at` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`source_id` text,
	`confidence` real DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`property_id` text NOT NULL,
	`lease_id` text,
	`amount` integer NOT NULL,
	`date` text NOT NULL,
	`payer` text DEFAULT '' NOT NULL,
	`memo` text DEFAULT '' NOT NULL,
	`method` text DEFAULT '' NOT NULL,
	`payer_type` text DEFAULT 'tenant' NOT NULL,
	`match_reason` text DEFAULT '' NOT NULL,
	`corroborated_by` text DEFAULT '[]' NOT NULL,
	`staged_row_id` text,
	`source_id` text,
	`confidence` real DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `payments_lease_idx` ON `payments` (`lease_id`);--> statement-breakpoint
CREATE TABLE `promises` (
	`id` text PRIMARY KEY NOT NULL,
	`property_id` text NOT NULL,
	`unit_number` text NOT NULL,
	`amount` integer NOT NULL,
	`promised_for` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `properties` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`address` text DEFAULT '' NOT NULL,
	`city` text DEFAULT '' NOT NULL,
	`state` text DEFAULT '' NOT NULL,
	`unit_count` integer DEFAULT 0 NOT NULL,
	`cares_covered` text DEFAULT 'unknown' NOT NULL,
	`rent_control` integer DEFAULT false NOT NULL,
	`rent_control_cap_pct` real,
	`max_increase_pct` real DEFAULT 8 NOT NULL,
	`pricing_suggestions` integer DEFAULT true NOT NULL,
	`late_fee_grace_day` integer DEFAULT 5 NOT NULL,
	`late_fee_amount` integer DEFAULT 5000 NOT NULL,
	`as_of` text,
	`settings` text DEFAULT '{}' NOT NULL,
	`source_id` text,
	`confidence` real DEFAULT 1 NOT NULL
);
--> statement-breakpoint
CREATE TABLE `resolutions` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`decided_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `source_files` (
	`id` text PRIMARY KEY NOT NULL,
	`property_id` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`mime` text DEFAULT '' NOT NULL,
	`path` text NOT NULL,
	`size` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'parsed' NOT NULL,
	`meta` text DEFAULT '{}' NOT NULL,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE `staged_rows` (
	`id` text PRIMARY KEY NOT NULL,
	`source_file_id` text NOT NULL,
	`property_id` text NOT NULL,
	`kind` text NOT NULL,
	`locator` text NOT NULL,
	`data` text NOT NULL,
	`status` text DEFAULT 'ok' NOT NULL,
	`review_reason` text,
	`ord` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE INDEX `staged_property_idx` ON `staged_rows` (`property_id`);--> statement-breakpoint
CREATE INDEX `staged_file_idx` ON `staged_rows` (`source_file_id`);--> statement-breakpoint
CREATE TABLE `units` (
	`id` text PRIMARY KEY NOT NULL,
	`property_id` text NOT NULL,
	`number` text NOT NULL,
	`unit_type` text DEFAULT '' NOT NULL,
	`beds` real DEFAULT 0 NOT NULL,
	`baths` real DEFAULT 0 NOT NULL,
	`sqft` integer DEFAULT 0 NOT NULL,
	`status` text NOT NULL,
	`market_rent` integer DEFAULT 0 NOT NULL,
	`vacant_since` text,
	`source_id` text,
	`confidence` real DEFAULT 1 NOT NULL
);
