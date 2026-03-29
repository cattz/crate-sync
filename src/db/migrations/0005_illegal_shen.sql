CREATE TABLE `rejections` (
	`id` text PRIMARY KEY NOT NULL,
	`track_id` text NOT NULL,
	`context` text NOT NULL,
	`file_key` text NOT NULL,
	`reason` text,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`track_id`) REFERENCES `tracks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rejection_uniq` ON `rejections` (`track_id`,`context`,`file_key`);--> statement-breakpoint
ALTER TABLE `downloads` ADD `origin` text DEFAULT 'not_found' NOT NULL;--> statement-breakpoint
ALTER TABLE `matches` ADD `target_meta` text;--> statement-breakpoint
ALTER TABLE `matches` ADD `parked_at` integer;--> statement-breakpoint
ALTER TABLE `jobs` DROP COLUMN `run_after`;